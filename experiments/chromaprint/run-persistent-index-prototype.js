const { execFile } = require("node:child_process");
const { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { performance } = require("node:perf_hooks");
const { promisify } = require("node:util");

const { createRecognitionIndex } = require("../../dist/recognition-index");
const { parseRawFingerprint } = require("./comparison");

const exec = promisify(execFile);
const root = resolve(__dirname);
const corpusRoot = join(root, "samples", "independent-corpus", "generated");
const outputRoot = join(root, "samples", "persistent-index");
const indexPath = join(outputRoot, "prototype.sqlite");
const manifest = JSON.parse(readFileSync(join(root, "independent-corpus-manifest.json"), "utf8"));
const indexed = manifest.recordings.filter((recording) => recording.indexed).slice(0, 10);
const unknown = manifest.recordings.filter((recording) => !recording.indexed).slice(0, 3);

async function frames(name) {
  const { stdout } = await exec("fpcalc", ["-raw", join(corpusRoot, name)], { timeout: 10_000, maxBuffer: 128 * 1024 });
  return parseRawFingerprint(stdout);
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function pct(value) { return `${(value * 100).toFixed(1)}%`; }

function report(result) {
  return [
    "# Persistent Recognition Index prototype acceptance",
    "",
    "- Corpus: 10 indexed and 3 unknown-only recordings from the already documented CC0 independent-corpus fixtures. Audio and the SQLite file are ignored; only this measurement is committed.",
    "- Frozen pipeline: medium-frame tokens, two-frame offset buckets, Top-5 candidates; average ≥0.92, strong-frame proportion ≥0.60, longest run ≥24, aligned frames ≥40, dominant votes ≥2, margin ≥0.03.",
    "",
    "## Persistence",
    "",
    `- SQLite file size: ${result.indexFileSizeBytes} bytes.`,
    `- Recording count / segment count after reopen: ${result.reopenedStats.recordingCount} / ${result.reopenedStats.segmentCount}.`,
    `- Open/load time: ${result.reopenedStats.openLoadMs.toFixed(3)} ms; in-memory retrieval rebuild: ${result.reopenedStats.retrievalRebuildMs.toFixed(3)} ms.`,
    "",
    "## Recognition",
    "",
    `- Known transformed queries matched: ${result.known.matched}/${result.known.total}.`,
    `- Unknown queries rejected: ${result.unknown.rejected}/${result.unknown.total}.`,
    `- Median recognition query time: ${result.medianRecognitionQueryMs.toFixed(3)} ms.`,
    `- Known query record IDs: ${result.known.rows.map((row) => row.recordingId).join(", ")}.`,
    `- Unknown result reasons: ${result.unknown.rows.map((row) => row.reason).join(", ")}.`,
    "",
    "## Result",
    "",
    `- Persistence acceptance ${result.accepted ? "passed" : "failed"}: create → ingest → close → reopen → count verification → known recognition → unknown rejection → close.`,
    "- This is a local persistence prototype, not a production Recognition Index or real-radio validation.",
    "",
  ].join("\n");
}

async function main() {
  const required = [...indexed.map((recording) => `${recording.id}-index-0.wav`), ...indexed.map((recording) => `${recording.id}-index-15.wav`), ...indexed.map((recording) => `${recording.id}-mp3-128.mp3`), ...unknown.map((recording) => `${recording.id}-unknown-mp3-128.mp3`)];
  if (required.some((name) => !existsSync(join(corpusRoot, name)))) throw new Error("Independent corpus fixtures are missing. Run npm run experiment:independent-corpus after preparing its documented CC0 sources.");
  mkdirSync(outputRoot, { recursive: true });
  rmSync(indexPath, { force: true });
  const sourceById = new Map(manifest.sources.map((source) => [source.id, source]));
  const opened = await createRecognitionIndex(indexPath);
  if ("error" in opened) throw new Error(`${opened.error}: ${opened.message}`);
  for (const recording of indexed) {
    const source = sourceById.get(recording.sourceId);
    opened.addRecording({ id: recording.id, artist: source?.creator ?? null, title: recording.title, provenance: source?.source });
    opened.addSegments([
      { id: `${recording.id}:0`, recordingId: recording.id, startSeconds: 0, durationSeconds: 20, frames: await frames(`${recording.id}-index-0.wav`) },
      { id: `${recording.id}:15`, recordingId: recording.id, startSeconds: 15, durationSeconds: 20, frames: await frames(`${recording.id}-index-15.wav`) },
    ]);
  }
  opened.close();
  const reopened = await createRecognitionIndex(indexPath);
  if ("error" in reopened) throw new Error(`${reopened.error}: ${reopened.message}`);
  const queryTimes = [];
  const knownRows = [];
  for (const recording of indexed) {
    const query = await frames(`${recording.id}-mp3-128.mp3`);
    const startedAt = performance.now();
    const result = reopened.recognize(query);
    queryTimes.push(performance.now() - startedAt);
    knownRows.push({ recordingId: recording.id, matched: result.matched && result.recording.id === recording.id });
  }
  const unknownRows = [];
  for (const recording of unknown) {
    const result = reopened.recognize(await frames(`${recording.id}-unknown-mp3-128.mp3`));
    unknownRows.push({ recordingId: recording.id, rejected: !result.matched, reason: result.matched ? "matched" : result.reason });
  }
  const result = {
    generatedAt: new Date().toISOString(),
    indexFileSizeBytes: statSync(indexPath).size,
    reopenedStats: reopened.getStats(),
    medianRecognitionQueryMs: median(queryTimes),
    known: { total: knownRows.length, matched: knownRows.filter((row) => row.matched).length, rows: knownRows },
    unknown: { total: unknownRows.length, rejected: unknownRows.filter((row) => row.rejected).length, rows: unknownRows },
  };
  result.accepted = result.reopenedStats.recordingCount === indexed.length && result.reopenedStats.segmentCount === indexed.length * 2 && result.known.matched > 0 && result.unknown.rejected === result.unknown.total;
  reopened.close();
  writeFileSync(join(root, "persistent-index-prototype-results.json"), `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(join(root, "persistent-index-prototype-report.md"), report(result));
  console.log(`Persistent index acceptance ${result.accepted ? "passed" : "failed"}: ${result.known.matched}/${result.known.total} known, ${result.unknown.rejected}/${result.unknown.total} unknown rejected (${pct(result.unknown.rejected / result.unknown.total)}).`);
  if (!result.accepted) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
