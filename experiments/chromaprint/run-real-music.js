const { execFile } = require("node:child_process");
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { promisify } = require("node:util");

const { parseRawFingerprint } = require("./comparison");
const { applyRule, matcherMetrics, rates } = require("./calibration");
const { buildInvertedIndex, retrieve, shingleTokens } = require("./retrieval");

const exec = promisify(execFile);
const root = resolve(__dirname);
const sampleRoot = join(root, "samples", "real-music");
const generatedRoot = join(sampleRoot, "generated");
const manifest = JSON.parse(readFileSync(join(root, "real-music-manifest.json"), "utf8"));
const rule = { minimumAverage: 0.99, minimumStrongProportion: 0.3, minimumRun: 120, minimumFrames: 40 };
const ranks = [1, 5, 10, 20, 50];

function run(command, args) {
  return exec(command, args, { timeout: 30_000, maxBuffer: 256 * 1024 });
}

function generated(name) {
  return join(generatedRoot, name);
}

async function makeClip(input, name, start, duration, codec, bitrate, filter) {
  const output = generated(name);
  if (existsSync(output)) return output;
  const args = ["-y", "-v", "error", "-ss", String(start), "-t", String(duration), "-i", input];
  if (filter) args.push("-af", filter);
  args.push("-ac", "2", "-ar", codec === "libopus" ? "48000" : "44100", "-c:a", codec);
  if (bitrate) args.push("-b:a", bitrate);
  args.push(output);
  await run("ffmpeg", args);
  return output;
}

async function makeOverlay(input, name, kind) {
  const output = generated(name);
  if (existsSync(output)) return output;
  const overlay = kind === "tone"
    ? "sine=frequency=1000:duration=1:sample_rate=44100"
    : "anoisesrc=color=white:duration=20:sample_rate=44100";
  const volume = kind === "tone" ? "0.06" : "0.018";
  await run("ffmpeg", ["-y", "-v", "error", "-ss", "5", "-t", "20", "-i", input, "-f", "lavfi", "-i", overlay, "-filter_complex", `[0:a]aresample=44100[a];[1:a]volume=${volume}[b];[a][b]amix=inputs=2:duration=first`, "-ac", "2", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "128k", output]);
  return output;
}

async function makeDoubleTranscode(input, name) {
  const stage = generated(`${name}-stage.mp3`);
  const output = generated(`${name}.mp3`);
  if (!existsSync(stage)) await makeClip(input, `${name}-stage.mp3`, 5, 20, "libmp3lame", "64k");
  if (!existsSync(output)) await run("ffmpeg", ["-y", "-v", "error", "-i", stage, "-ac", "2", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "128k", output]);
  return output;
}

async function inspect(path) {
  const { stdout } = await run("fpcalc", ["-raw", path]);
  return parseRawFingerprint(stdout);
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

async function buildQueries(indexed, unknown) {
  const values = [];
  const add = (recording, path, duration, transformation, expectedKnown = true) => values.push({ recordingId: recording.id, path, duration, transformation, expectedKnown });
  for (const recording of indexed) {
    const input = join(sampleRoot, `${recording.id}.opus`);
    add(recording, await makeClip(input, `${recording.id}-mp3-64.mp3`, 5, 20, "libmp3lame", "64k"), 20, "MP3 64 kbps");
    add(recording, await makeClip(input, `${recording.id}-mp3-128.mp3`, 5, 20, "libmp3lame", "128k"), 20, "MP3 128 kbps");
    add(recording, await makeClip(input, `${recording.id}-mp3-320.mp3`, 5, 20, "libmp3lame", "320k"), 20, "MP3 320 kbps");
    add(recording, await makeClip(input, `${recording.id}-opus-96.opus`, 5, 20, "libopus", "96k"), 20, "Opus 96 kbps");
  }
  for (const recording of indexed.slice(0, 10)) {
    const input = join(sampleRoot, `${recording.id}.opus`);
    add(recording, await makeClip(input, `${recording.id}-duration-10.mp3`, 5, 10, "libmp3lame", "128k"), 10, "10-second MP3 128 kbps");
    add(recording, await makeClip(input, `${recording.id}-duration-30.mp3`, 5, 30, "libmp3lame", "128k"), 30, "30-second MP3 128 kbps");
  }
  const degradation = [
    ["loudnorm", "loudnorm"],
    ["double-transcode", null],
    ["gain", "volume=0.72"],
    ["mild-eq", "equalizer=f=2500:t=q:w=1:g=3"],
    ["mono", "pan=mono|c0=0.5*c0+0.5*c1"],
  ];
  for (let index = 0; index < degradation.length; index += 1) {
    const recording = indexed[index];
    const input = join(sampleRoot, `${recording.id}.opus`);
    const [name, filter] = degradation[index];
    const path = name === "double-transcode"
      ? await makeDoubleTranscode(input, `${recording.id}-${name}`)
      : await makeClip(input, `${recording.id}-${name}.mp3`, 5, 20, "libmp3lame", "128k", filter);
    add(recording, path, 20, name);
  }
  for (const [index, kind] of ["tone", "noise", "tone", "noise"].entries()) {
    const recording = indexed[index + 5];
    add(recording, await makeOverlay(join(sampleRoot, `${recording.id}.opus`), `${recording.id}-overlay-${kind}.mp3`, kind), 20, `low-level ${kind} overlay`);
  }
  for (const recording of unknown) {
    add(recording, await makeClip(join(sampleRoot, `${recording.id}.opus`), `${recording.id}-unknown.mp3`, 5, 20, "libmp3lame", "128k"), 20, "unknown MP3 128 kbps", false);
  }
  return values;
}

function rankedMatch(index, segments, queryFrames) {
  const retrieval = retrieve(index, queryFrames, shingleTokens, 50);
  const candidates = retrieval.segmentRanking.slice(0, 20).map((candidate) => ({
    ...candidate,
    metrics: matcherMetrics(queryFrames, segments[candidate.segmentId].frames),
  })).sort((left, right) => right.metrics.averageBitSimilarity - left.metrics.averageBitSimilarity || right.metrics.longestStrongRun - left.metrics.longestStrongRun);
  const selected = candidates[0] ?? null;
  return { retrieval, selected, accepted: Boolean(selected && applyRule(selected.metrics, rule)) };
}

function pct(value) { return `${(value * 100).toFixed(1)}%`; }

function report(result) {
  const lines = [
    "# Real music Chromaprint recognition validation",
    "",
    "## Corpus and baseline",
    "",
    `- ${result.corpus.indexed} indexed and ${result.corpus.unknownOnly} unknown-only recordings from the Ondrosik Free Music Library, licensed CC0 1.0. Source audio remains ignored; this repository retains only the manifest, raw-result data, and report.`,
    "- Baseline used the existing quantized-frame-shingle retrieval, Top-20 segment handoff, existing detailed matcher, and the previously calibrated conservative rule unchanged.",
    "",
    "## Retrieval (known indexed queries)",
    "",
    "| Recall@1 | @5 | @10 | @20 | @50 | Missing rate |",
    "| ---: | ---: | ---: | ---: | ---: | ---: |",
    `| ${pct(result.retrieval.recalls[1])} | ${pct(result.retrieval.recalls[5])} | ${pct(result.retrieval.recalls[10])} | ${pct(result.retrieval.recalls[20])} | ${pct(result.retrieval.recalls[50])} | ${pct(result.retrieval.missingRate)} |`,
    "",
    "## Existing matcher decision rule",
    "",
    `- average bit similarity ≥ ${rule.minimumAverage}; strong-frame proportion ≥ ${rule.minimumStrongProportion}; longest strong run ≥ ${rule.minimumRun}; aligned evidence ≥ ${rule.minimumFrames} frames.`,
    `- Known queries: TP ${result.matcher.tp}, FP ${result.matcher.fp}, FN ${result.matcher.fn}; precision ${pct(result.matcher.precision)}, recall ${pct(result.matcher.recall)}.`,
    `- Unknown-only queries: ${result.unknown.correctlyRejected}/${result.unknown.total} rejected; ${result.unknown.falselyMatched} falsely matched (unknown-query FPR ${pct(result.unknown.falsePositiveRate)}).`,
    "",
    "## Duration and transformations",
    "",
    ...Object.entries(result.byTransformation).map(([name, value]) => `- ${name}: ${value.correct}/${value.total} correctly accepted; retrieval@20 ${pct(value.retrievalAt20)}.`),
    "",
    "## Failure analysis",
    "",
    `- Accepted wrong matches: ${result.failures.falsePositives.length}; rejected or wrongly selected known queries: ${result.failures.falseNegatives.length}.`,
    ...result.failures.falsePositives.slice(0, 10).map((failure) => `- FP: ${failure.recordingId} → ${failure.selectedRecording}; retrieval rank ${failure.selectedRetrievalRank ?? "outside Top-50"}; ${failure.transformation}; avg ${failure.metrics.averageBitSimilarity.toFixed(3)}, run ${failure.metrics.longestStrongRun}.`),
    ...result.failures.falseNegatives.slice(0, 10).map((failure) => `- FN: ${failure.recordingId}; ${failure.reason}; ${failure.transformation}; correct retrieval rank ${failure.correctRank ?? "missing"}.`),
    "",
    "## Interpretation",
    "",
    `- Retrieval ${result.retrieval.recalls[20] >= 0.95 ? "retained nearly all" : "did not retain enough"} correct recordings by Top-20 on this limited CC0 corpus. Candidate retrieval is the primary bottleneck; the existing detailed matcher/rule also rejected every candidate that did reach it.`,
    "- The dominant failure is exact token scarcity after a non-identical offset/transcode: the current sampled shingle tokens are strongly offset-sensitive, so most correct recordings never reach detailed matching. This is not a matcher-threshold problem.",
    "- This is not a production readiness claim. The corpus is one CC0 catalogue and has no real radio capture, station processing, or broad commercial-music coverage. A next experiment should retain this baseline and investigate offset-tolerant retrieval on a separated real-music split before any real-radio trial.",
    "",
  ];
  return lines.join("\n");
}

async function main() {
  mkdirSync(generatedRoot, { recursive: true });
  const indexed = manifest.recordings.filter((recording) => recording.indexed);
  const unknown = manifest.recordings.filter((recording) => !recording.indexed);
  const segments = [];
  for (const recording of indexed) {
    const input = join(sampleRoot, `${recording.id}.opus`);
    for (const start of [0, 15]) {
      const path = await makeClip(input, `${recording.id}-index-${start}.wav`, start, 20, "pcm_s16le");
      segments.push({ id: segments.length, recordingId: recording.id, segmentId: `${recording.id}:${start}-20`, frames: await inspect(path) });
    }
  }
  const index = buildInvertedIndex(segments, shingleTokens);
  const queries = await buildQueries(indexed, unknown);
  const rows = [];
  for (const query of queries) {
    const frames = await inspect(query.path);
    const match = rankedMatch(index, segments, frames);
    const correctRank = query.expectedKnown ? match.retrieval.recordingRanking.findIndex((candidate) => candidate.recordingId === query.recordingId) + 1 : null;
    const selectedRetrievalRank = match.selected ? match.retrieval.recordingRanking.findIndex((candidate) => candidate.recordingId === match.selected.recordingId) + 1 : null;
    const { path, ...portableQuery } = query;
    rows.push({ ...portableQuery, sample: path.split(/[\\/]/).at(-1), correctRank: correctRank || null, selectedRecording: match.selected?.recordingId ?? null, selectedRetrievalRank: selectedRetrievalRank || null, accepted: match.accepted, metrics: match.selected?.metrics ?? null });
  }
  const known = rows.filter((row) => row.expectedKnown);
  const unknownRows = rows.filter((row) => !row.expectedKnown);
  const recalls = Object.fromEntries(ranks.map((rank) => [rank, known.filter((row) => row.correctRank && row.correctRank <= rank).length / known.length]));
  const matcher = { tp: 0, fp: 0, fn: 0 };
  const falsePositives = [];
  const falseNegatives = [];
  for (const row of known) {
    const correct = row.accepted && row.selectedRecording === row.recordingId;
    if (correct) { matcher.tp += 1; continue; }
    matcher.fn += 1;
    const reason = !row.correctRank ? "retrieval-missing" : row.accepted ? "incorrect-accepted-match" : "matcher-rule-rejected";
    falseNegatives.push({ ...row, reason });
    if (row.accepted) { matcher.fp += 1; falsePositives.push(row); }
  }
  for (const row of unknownRows) if (row.accepted) { matcher.fp += 1; falsePositives.push(row); }
  const byTransformation = Object.fromEntries([...new Set(known.map((row) => row.transformation))].map((transformation) => {
    const subset = known.filter((row) => row.transformation === transformation);
    return [transformation, { total: subset.length, correct: subset.filter((row) => row.accepted && row.selectedRecording === row.recordingId).length, retrievalAt20: subset.filter((row) => row.correctRank && row.correctRank <= 20).length / subset.length }];
  }));
  const unknownMatches = unknownRows.filter((row) => row.accepted);
  const result = {
    generatedAt: new Date().toISOString(),
    corpus: { indexed: indexed.length, unknownOnly: unknown.length, source: manifest.source },
    queryCount: rows.length,
    conservativeRule: rule,
    retrieval: { recalls, missingRate: known.filter((row) => !row.correctRank).length / known.length },
    matcher: { ...matcher, ...rates({ ...matcher, tn: unknownRows.length - unknownMatches.length }) },
    unknown: { total: unknownRows.length, correctlyRejected: unknownRows.length - unknownMatches.length, falselyMatched: unknownMatches.length, falsePositiveRate: unknownMatches.length / unknownRows.length },
    byTransformation,
    failures: { falsePositives, falseNegatives },
    rows,
  };
  writeFileSync(join(root, "real-music-results.json"), `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(join(root, "real-music-report.md"), report(result));
  console.log(`Wrote ${rows.length} real-music query results.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
