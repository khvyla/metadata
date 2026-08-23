const { execFile } = require("node:child_process");
const { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { promisify } = require("node:util");

const { parseRawFingerprint } = require("./comparison");
const { buildOffsetIndex, rankOffsetCandidates } = require("./offset-retrieval");
const { candidateEvidence, decide, outcome } = require("./real-music-matcher");

const exec = promisify(execFile);
const root = resolve(__dirname);
const samples = join(root, "samples", "independent-corpus");
const source = join(samples, "source");
const generated = join(samples, "generated");
const manifest = JSON.parse(readFileSync(join(root, "independent-corpus-manifest.json"), "utf8"));
const retrievalKind = "medium-frame";
const retrievalBucketFrames = 2;
const shortlist = 5;
const fixedRule = {
  minimumAverage: 0.92,
  minimumStrongProportion: 0.60,
  minimumRun: 24,
  minimumFrames: 40,
  minimumDominantVotes: 2,
  minimumMargin: 0.03,
};

async function invoke(command, args) {
  return exec(command, args, { timeout: 45_000, maxBuffer: 256 * 1024 });
}

async function frames(file) {
  const { stdout } = await invoke("fpcalc", ["-raw", file]);
  return parseRawFingerprint(stdout);
}

async function render(name, args) {
  const output = join(generated, name);
  if (!existsSync(output) || statSync(output).size === 0) await invoke("ffmpeg", ["-y", ...args, output]);
  return output;
}

function input(recording) { return join(source, `${recording.id}.mp3`); }

async function indexSegment(recording, start) {
  return render(`${recording.id}-index-${start}.wav`, ["-ss", String(start), "-t", "20", "-i", input(recording), "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le"]);
}

async function transcode(recording, name, duration, codec, bitrate, filter) {
  const args = ["-ss", "5", "-t", String(duration), "-i", input(recording)];
  if (filter) args.push("-af", filter);
  args.push("-ar", codec === "libopus" ? "48000" : "44100", "-ac", "2", "-c:a", codec, "-b:a", bitrate);
  return render(`${recording.id}-${name}`, args);
}

async function doubleTranscode(recording) {
  const intermediate = await transcode(recording, "double-intermediate.mp3", 20, "libmp3lame", "64k");
  return render(`${recording.id}-double-transcode.mp3`, ["-ss", "0", "-t", "20", "-i", intermediate, "-ar", "44100", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "128k"]);
}

async function overlay(recording, kind) {
  const filter = kind === "tone"
    ? "[0:a]volume=1[a];sine=frequency=1000:sample_rate=44100:duration=1,volume=0.05[t];[a][t]amix=inputs=2:duration=first"
    : "[0:a]volume=1[a];anoisesrc=color=white:sample_rate=44100:duration=20,volume=0.015[n];[a][n]amix=inputs=2:duration=first";
  return render(`${recording.id}-${kind}-overlay.mp3`, ["-ss", "5", "-t", "20", "-i", input(recording), "-filter_complex", filter, "-ar", "44100", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "128k"]);
}

function number(value) { return Number(value.toFixed(6)); }

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return number(sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2);
}

function distribution(rows) {
  const values = (selector) => rows.map(selector).filter(Number.isFinite);
  const summary = (items) => ({ min: number(Math.min(...items)), median: median(items), max: number(Math.max(...items)) });
  return {
    count: rows.length,
    bestSimilarity: summary(values((row) => row.decision.best?.similarity)),
    margin: summary(values((row) => row.decision.margin)),
    dominantVotes: summary(values((row) => row.decision.best?.dominantVotes)),
    evidenceSpan: summary(values((row) => row.decision.best?.evidenceSpan)),
  };
}

function failureReason(row) {
  if (row.retrievalLost) return "retrieval-lost-correct-recording";
  if (row.decision.matched && row.decision.recordingId !== row.recordingId) return "wrong-candidate-accepted";
  if (row.decision.reason === "ambiguous") return "ambiguous-margin";
  if (row.duration === 10) return "short-sample-or-insufficient-evidence";
  return "insufficient-evidence";
}

function compactDecision(decision) {
  const compact = (candidate) => candidate && ({
    recordingId: candidate.recordingId,
    segmentId: candidate.segmentId,
    similarity: number(candidate.metrics.averageBitSimilarity),
    strongFrameProportion: number(candidate.metrics.strongFrameProportion),
    longestStrongRun: candidate.metrics.longestStrongRun,
    alignedFrames: candidate.metrics.comparedFrames,
    dominantVotes: candidate.retrieval.dominantVotes,
    evidenceSpan: candidate.retrieval.evidenceSpan,
  });
  return {
    matched: decision.matched,
    recordingId: decision.recordingId ?? null,
    reason: decision.reason ?? null,
    margin: decision.margin === null ? null : number(decision.margin),
    best: compact(decision.best),
    runnerUp: compact(decision.runnerUp),
  };
}

function retrievalMetrics(rows) {
  const known = rows.filter((row) => row.expectedKnown);
  return {
    recallAt1: known.length ? known.filter((row) => row.retrievalCorrectRank === 1).length / known.length : 0,
    recallAt5: known.length ? known.filter((row) => row.retrievalCorrectRank && row.retrievalCorrectRank <= 5).length / known.length : 0,
    missingRate: known.length ? known.filter((row) => !row.retrievalCorrectRank || row.retrievalCorrectRank > 5).length / known.length : 0,
  };
}

function byTransformation(rows) {
  return Object.fromEntries([...new Set(rows.filter((row) => row.expectedKnown).map((row) => row.transformation))].sort().map((name) => {
    const subset = rows.filter((row) => row.expectedKnown && row.transformation === name);
    return [name, { total: subset.length, ...outcome(subset).known, retrieval: retrievalMetrics(subset) }];
  }));
}

function pct(value) { return `${(value * 100).toFixed(1)}%`; }

function report(result) {
  const metrics = result.matcher;
  const retrieval = result.retrieval.metrics;
  const falseAccepts = result.rows.filter((row) => !row.expectedKnown && row.decision.matched);
  const knownCorrect = result.rows.filter((row) => row.expectedKnown && row.decision.matched && row.decision.recordingId === row.recordingId);
  const unknown = result.rows.filter((row) => !row.expectedKnown);
  const transformationRows = Object.entries(result.byTransformation).map(([name, values]) => `| ${name} | ${values.total} | ${values.correct} | ${values.wrong} | ${values.rejected} | ${pct(values.retrieval.recallAt5)} |`).join("\n");
  return [
    "# Independent corpus validation",
    "",
    "## Frozen configuration",
    "",
    "- This corpus was not used for retrieval or matcher calibration. The configuration was fixed before source audio was downloaded: medium-frame tokens, two-frame offset buckets, Top-5 retrieval shortlist, and the specified matcher thresholds.",
    `- Matcher: average similarity ≥ ${fixedRule.minimumAverage}; strong-frame proportion ≥ ${fixedRule.minimumStrongProportion}; longest strong run ≥ ${fixedRule.minimumRun}; aligned frames ≥ ${fixedRule.minimumFrames}; dominant retrieval votes ≥ ${fixedRule.minimumDominantVotes}; runner-up margin ≥ ${fixedRule.minimumMargin}.`,
    `- Corpus: ${result.corpus.indexed} indexed and ${result.corpus.unknownOnly} unknown-only CC0 recordings, across three independent OpenGameArt submissions by different creators. Downloaded audio is ignored; this repository contains only provenance, code, and results.`,
    "",
    "## Retrieval and final decisions",
    "",
    `- Retrieval Recall@1/5: ${pct(retrieval.recallAt1)} / ${pct(retrieval.recallAt5)}; correct-recording missing rate from Top-5: ${pct(retrieval.missingRate)}.`,
    `- Known queries: correct/wrong/rejected ${metrics.known.correct}/${metrics.known.wrong}/${metrics.known.rejected} of ${metrics.known.total}.`,
    `- Unknown queries: rejected/falsely accepted ${metrics.unknown.rejected}/${metrics.unknown.falselyAccepted} of ${metrics.unknown.total}.`,
    `- Precision ${pct(metrics.precision)}; recall ${pct(metrics.recall)}; unknown false-positive rate ${pct(metrics.falsePositiveRate)}; rejection rate ${pct(metrics.rejectionRate)}.`,
    "",
    "## Transformation diagnostics (descriptive; no retuning)",
    "",
    "| Transformation | Queries | Correct | Wrong | Rejected | Retrieval Recall@5 |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    transformationRows,
    "",
    "## Evidence distributions",
    "",
    `- Known correct matches (${knownCorrect.length}): ${JSON.stringify(result.evidence.knownCorrect)}.`,
    `- Unknown queries (${unknown.length}): ${JSON.stringify(result.evidence.unknown)}.`,
    "- Similarity alone is not treated as recognition: acceptance also requires sustained aligned frames, retrieval votes, and a runner-up margin.",
    "",
    "## Failure diagnosis",
    "",
    ...Object.entries(result.failureReasons).map(([reason, count]) => `- ${reason}: ${count}.`),
    ...(falseAccepts.length ? ["", "## Unknown false accepts", "", ...falseAccepts.map((row) => `- ${row.recordingId}: selected ${row.decision.recordingId}; similarity ${row.decision.best?.similarity}; margin ${row.decision.margin}; dominant votes ${row.decision.best?.dominantVotes}; evidence span ${row.decision.best?.evidenceSpan}; ${row.transformation}, ${row.duration}s.`)] : ["- No unknown query was accepted."]),
    "",
    "## Cross-corpus comparison",
    "",
    "| Corpus | Precision | Recall | Unknown FPR | Known correct/wrong/rejected |",
    "| --- | ---: | ---: | ---: | --- |",
    "| Previous Ondrosik holdout | 100.0% | 72.2% | 0.0% | 39 / 0 / 15 |",
    `| Independent CC0 corpus | ${pct(metrics.precision)} | ${pct(metrics.recall)} | ${pct(metrics.falsePositiveRate)} | ${metrics.known.correct} / ${metrics.known.wrong} / ${metrics.known.rejected} |`,
    "",
    "## Interpretation",
    "",
    `- The frozen pipeline is ${metrics.unknown.falselyAccepted === 0 && metrics.known.wrong === 0 && retrieval.missingRate < 0.2 ? "a strong continuation signal on this small independent corpus" : "a mixed/weak generalization signal on this small independent corpus"}.`,
    "- This remains R&D evidence only. Larger source diversity, real-radio stream captures, station overlays, and operational retrieval scaling remain unproven before any production Recognition Index or radio validation.",
    "",
  ].join("\n");
}

async function main() {
  mkdirSync(generated, { recursive: true });
  const missing = manifest.recordings.filter((recording) => !existsSync(input(recording)));
  if (missing.length) throw new Error(`Missing ${missing.length} local source files. Run node experiments/chromaprint/download-independent-corpus.js first.`);
  const indexed = manifest.recordings.filter((recording) => recording.indexed);
  const segments = [];
  const segmentsByRecording = new Map();
  for (const recording of indexed) {
    const alternatives = [];
    for (const start of [0, 15]) {
      const segment = { recordingId: recording.id, segmentId: `${recording.id}:${start}-20`, globalFrameOffset: start * 8, frames: await frames(await indexSegment(recording, start)) };
      segments.push(segment);
      alternatives.push(segment);
    }
    segmentsByRecording.set(recording.id, alternatives);
  }
  const index = buildOffsetIndex(segments, retrievalKind);
  const queries = [];
  for (const recording of indexed) {
    queries.push({ recording, expectedKnown: true, transformation: "mp3-64", duration: 20, file: await transcode(recording, "mp3-64.mp3", 20, "libmp3lame", "64k") });
    queries.push({ recording, expectedKnown: true, transformation: "mp3-128", duration: 20, file: await transcode(recording, "mp3-128.mp3", 20, "libmp3lame", "128k") });
    queries.push({ recording, expectedKnown: true, transformation: "mp3-320", duration: 20, file: await transcode(recording, "mp3-320.mp3", 20, "libmp3lame", "320k") });
    queries.push({ recording, expectedKnown: true, transformation: "opus-96", duration: 20, file: await transcode(recording, "opus-96.opus", 20, "libopus", "96k") });
    queries.push({ recording, expectedKnown: true, transformation: "duration-10", duration: 10, file: await transcode(recording, "duration-10.mp3", 10, "libmp3lame", "128k") });
    queries.push({ recording, expectedKnown: true, transformation: "duration-30", duration: 30, file: await transcode(recording, "duration-30.mp3", 30, "libmp3lame", "128k") });
  }
  const degraded = [
    [indexed[0], "loudnorm", () => transcode(indexed[0], "loudnorm.mp3", 20, "libmp3lame", "128k", "loudnorm=I=-16:LRA=11:TP=-1.5")],
    [indexed[1], "double-transcode", () => doubleTranscode(indexed[1])],
    [indexed[2], "gain", () => transcode(indexed[2], "gain.mp3", 20, "libmp3lame", "128k", "volume=0.75")],
    [indexed[3], "mild-eq", () => transcode(indexed[3], "mild-eq.mp3", 20, "libmp3lame", "128k", "equalizer=f=2000:t=q:w=1:g=3")],
    [indexed[4], "mono", () => render(`${indexed[4].id}-mono.mp3`, ["-ss", "5", "-t", "20", "-i", input(indexed[4]), "-ar", "44100", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "128k"])],
    [indexed[5], "tone-overlay", () => overlay(indexed[5], "tone")],
    [indexed[6], "noise-overlay", () => overlay(indexed[6], "noise")],
  ];
  for (const [recording, transformation, create] of degraded) queries.push({ recording, expectedKnown: true, transformation, duration: 20, file: await create() });
  for (const recording of manifest.recordings.filter((recording) => !recording.indexed)) {
    queries.push({ recording, expectedKnown: false, transformation: "unknown-mp3-128", duration: 20, file: await transcode(recording, "unknown-mp3-128.mp3", 20, "libmp3lame", "128k") });
  }
  const rows = [];
  for (const query of queries) {
    const queryFrames = await frames(query.file);
    const retrieval = rankOffsetCandidates(index, queryFrames, retrievalBucketFrames);
    const correctRank = query.expectedKnown ? retrieval.ranking.findIndex((candidate) => candidate.recordingId === query.recording.id) + 1 : null;
    const decision = decide(candidateEvidence(queryFrames, retrieval.ranking.slice(0, shortlist), segmentsByRecording), fixedRule);
    const row = { recordingId: query.recording.id, expectedKnown: query.expectedKnown, transformation: query.transformation, duration: query.duration, retrievalCorrectRank: correctRank || null, retrievalLost: query.expectedKnown && (!correctRank || correctRank > shortlist), candidateCount: retrieval.candidateCount, decision: compactDecision(decision) };
    row.failureReason = query.expectedKnown ? failureReason(row) : null;
    rows.push(row);
  }
  const matcher = outcome(rows);
  const knownCorrect = rows.filter((row) => row.expectedKnown && row.decision.matched && row.decision.recordingId === row.recordingId);
  const unknown = rows.filter((row) => !row.expectedKnown);
  const failureReasons = rows.filter((row) => row.expectedKnown && !(row.decision.matched && row.decision.recordingId === row.recordingId)).reduce((all, row) => ({ ...all, [row.failureReason]: (all[row.failureReason] ?? 0) + 1 }), {});
  const result = {
    generatedAt: new Date().toISOString(),
    frozenPipeline: { retrieval: { tokenKind: retrievalKind, offsetBucketFrames: retrievalBucketFrames, shortlist }, matcher: fixedRule },
    corpus: { indexed: indexed.length, unknownOnly: manifest.recordings.length - indexed.length, sourceManifest: "independent-corpus-manifest.json" },
    retrieval: { indexTokens: index.postings.size, indexPostings: index.postingCount, metrics: retrievalMetrics(rows) },
    matcher,
    byTransformation: byTransformation(rows),
    evidence: { knownCorrect: distribution(knownCorrect), unknown: distribution(unknown) },
    failureReasons,
    rows,
  };
  writeFileSync(join(root, "independent-corpus-results.json"), `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(join(root, "independent-corpus-report.md"), report(result));
  console.log(`Wrote independent-corpus results for ${rows.length} queries.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
