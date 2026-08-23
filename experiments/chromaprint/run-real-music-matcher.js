const { execFile } = require("node:child_process");
const { readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { promisify } = require("node:util");

const { parseRawFingerprint } = require("./comparison");
const { buildOffsetIndex, rankOffsetCandidates } = require("./offset-retrieval");
const { candidateEvidence, decide, outcome } = require("./real-music-matcher");

const exec = promisify(execFile);
const root = resolve(__dirname);
const generated = join(root, "samples", "real-music", "generated");
const manifest = JSON.parse(readFileSync(join(root, "real-music-manifest.json"), "utf8"));
const sourceRows = JSON.parse(readFileSync(join(root, "real-music-results.json"), "utf8")).rows;
const frameRate = 8;
const retrievalKind = "medium-frame";
const retrievalBucket = 2;
const candidateLimits = [5, 10, 20];

const rules = [
  { id: "strict-a", minimumAverage: 0.97, minimumStrongProportion: 0.85, minimumRun: 70, minimumFrames: 60, minimumDominantVotes: 4, minimumMargin: 0.020 },
  { id: "strict-b", minimumAverage: 0.965, minimumStrongProportion: 0.80, minimumRun: 60, minimumFrames: 60, minimumDominantVotes: 4, minimumMargin: 0.020 },
  { id: "strict-c", minimumAverage: 0.96, minimumStrongProportion: 0.80, minimumRun: 50, minimumFrames: 60, minimumDominantVotes: 4, minimumMargin: 0.025 },
  { id: "balanced-a", minimumAverage: 0.955, minimumStrongProportion: 0.75, minimumRun: 45, minimumFrames: 50, minimumDominantVotes: 3, minimumMargin: 0.020 },
  { id: "balanced-b", minimumAverage: 0.95, minimumStrongProportion: 0.70, minimumRun: 40, minimumFrames: 50, minimumDominantVotes: 3, minimumMargin: 0.025 },
  { id: "margin-first", minimumAverage: 0.94, minimumStrongProportion: 0.65, minimumRun: 35, minimumFrames: 40, minimumDominantVotes: 3, minimumMargin: 0.040 },
  { id: "recall-a", minimumAverage: 0.94, minimumStrongProportion: 0.65, minimumRun: 32, minimumFrames: 40, minimumDominantVotes: 3, minimumMargin: 0.020 },
  { id: "recall-b", minimumAverage: 0.92, minimumStrongProportion: 0.60, minimumRun: 24, minimumFrames: 40, minimumDominantVotes: 2, minimumMargin: 0.030 },
];

async function frames(file) {
  const { stdout } = await exec("fpcalc", ["-raw", file], { timeout: 10_000, maxBuffer: 128 * 1024 });
  return parseRawFingerprint(stdout);
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function failureReason(decision, rule, duration) {
  if (decision.reason === "ambiguous") return "insufficient-margin";
  if (duration === 10 && decision.best.metrics.comparedFrames < rule.minimumFrames) return "short-sample";
  if (decision.best.metrics.comparedFrames < rule.minimumFrames || decision.best.retrieval.dominantVotes < rule.minimumDominantVotes) return "insufficient-aligned-evidence";
  return "weak-similarity";
}

function evaluateEvidence(evidenceRows, rule, topK) {
  return evidenceRows.map((row) => {
    const candidates = row.candidates.slice(0, topK);
    const decision = decide(candidates, rule);
    return {
      recordingId: row.recordingId,
      expectedKnown: row.expectedKnown,
      transformation: row.transformation,
      duration: row.duration,
      retrievalCorrectRank: row.retrievalCorrectRank,
      retrievalLost: row.expectedKnown && !row.retrievalCorrectRank,
      candidateCount: row.candidates.length,
      shortlistSize: candidates.length,
      decision: decision.matched ? { matched: true, recordingId: decision.recordingId, margin: decision.margin, best: decision.best, runnerUp: decision.runnerUp } : { matched: false, reason: failureReason(decision, rule, row.duration), margin: decision.margin, best: decision.best, runnerUp: decision.runnerUp },
    };
  });
}

function byTransformation(rows) {
  return Object.fromEntries([...new Set(rows.map((row) => row.transformation))].map((transformation) => {
    const subset = rows.filter((row) => row.transformation === transformation);
    return [transformation, outcome(subset)];
  }));
}

function selectRule(calibrationEvidence) {
  return rules.map((rule) => {
    const rows = evaluateEvidence(calibrationEvidence, rule, 20);
    const metrics = outcome(rows);
    return { rule, metrics };
  }).sort((left, right) => {
    const leftFalseAccepts = left.metrics.known.wrong + left.metrics.unknown.falselyAccepted;
    const rightFalseAccepts = right.metrics.known.wrong + right.metrics.unknown.falselyAccepted;
    return leftFalseAccepts - rightFalseAccepts || right.metrics.precision - left.metrics.precision || right.metrics.recall - left.metrics.recall;
  })[0];
}

function pct(value) { return `${(value * 100).toFixed(1)}%`; }

function report(result) {
  const best = result.best;
  const calibration = best.calibration;
  const holdout = best.holdout;
  const accepted = best.holdoutRows.filter((row) => row.decision.matched && row.expectedKnown && row.decision.recordingId === row.recordingId);
  const margins = accepted.map((row) => row.decision.margin);
  const rejections = best.holdoutRows.filter((row) => !row.decision.matched && row.expectedKnown);
  const reasons = rejections.reduce((all, row) => ({ ...all, [row.decision.reason]: (all[row.decision.reason] ?? 0) + 1 }), {});
  return [
    "# Real-music detailed matcher calibration",
    "",
    "## Pipeline and split",
    "",
    "- Fixed retrieval: medium single-frame tokens, two-frame offset buckets, then Top-K recording candidates only. The retrieval implementation was not changed.",
    "- Calibration: odd-numbered indexed recordings plus odd-numbered unknown recordings. Holdout: even-numbered indexed recordings plus even-numbered unknown recordings.",
    "- Rules were selected lexicographically on calibration outcomes: minimum false accepts, maximum precision, then recall. Holdout outcomes were not used for selection.",
    "",
    "## Selected conservative rule",
    "",
    `- ${best.rule.id}: average similarity ≥ ${best.rule.minimumAverage}; strong-frame proportion ≥ ${best.rule.minimumStrongProportion}; longest run ≥ ${best.rule.minimumRun}; aligned frames ≥ ${best.rule.minimumFrames}; dominant retrieval votes ≥ ${best.rule.minimumDominantVotes}; runner-up margin ≥ ${best.rule.minimumMargin}.`,
    `- Calibration: known correct/wrong/rejected ${calibration.known.correct}/${calibration.known.wrong}/${calibration.known.rejected}; unknown rejected/false accepted ${calibration.unknown.rejected}/${calibration.unknown.falselyAccepted}; precision ${pct(calibration.precision)}, recall ${pct(calibration.recall)}.`,
    "",
    "## End-to-end holdout (Top-20 retrieval)",
    "",
    `- Known correct/wrong/rejected: ${holdout.known.correct}/${holdout.known.wrong}/${holdout.known.rejected}; retrieval lost ${best.holdoutRows.filter((row) => row.retrievalLost).length}/${holdout.known.total} known recordings before matching.`,
    `- Unknown rejected/falsely accepted: ${holdout.unknown.rejected}/${holdout.unknown.falselyAccepted}.`,
    `- Precision ${pct(holdout.precision)}; recall ${pct(holdout.recall)}; unknown FPR ${pct(holdout.falsePositiveRate)}; overall rejection rate ${pct(holdout.rejectionRate)}.`,
    "",
    "## Shortlist size",
    "",
    "| Top-K | Known correct | Known wrong | Known rejected | Unknown false accepted | Precision | Recall | FPR |",
    "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...Object.entries(best.topK).map(([limit, values]) => `| ${limit} | ${values.known.correct} | ${values.known.wrong} | ${values.known.rejected} | ${values.unknown.falselyAccepted} | ${pct(values.precision)} | ${pct(values.recall)} | ${pct(values.falsePositiveRate)} |`),
    "",
    "## Transformation diagnostics (all queries; descriptive only)",
    "",
    ...Object.entries(best.allByTransformation).map(([name, values]) => `- ${name}: known ${values.known.correct}/${values.known.wrong}/${values.known.rejected}; unknown false accepted ${values.unknown.falselyAccepted}.`),
    `- Duration groups: 10s known correct/wrong/rejected ${best.byDuration[10].known.correct}/${best.byDuration[10].known.wrong}/${best.byDuration[10].known.rejected}; 20s ${best.byDuration[20].known.correct}/${best.byDuration[20].known.wrong}/${best.byDuration[20].known.rejected}; 30s ${best.byDuration[30].known.correct}/${best.byDuration[30].known.wrong}/${best.byDuration[30].known.rejected}.`,
    "",
    "## Margin and rejection findings",
    "",
    `- Correct accepted known matches: ${accepted.length}; median runner-up margin ${median(margins).toFixed(4)}.`,
    `- Known rejection reasons: ${Object.entries(reasons).map(([reason, count]) => `${reason} ${count}`).join(", ") || "none"}.`,
    `- Unknown false accepts: ${best.holdoutRows.filter((row) => !row.expectedKnown && row.decision.matched).length}; accepted wrong known matches: ${best.holdoutRows.filter((row) => row.expectedKnown && row.decision.matched && row.decision.recordingId !== row.recordingId).length}.`,
    "",
    "## Interpretation",
    "",
    `- On this limited CC0 holdout, the fixed retrieval plus calibrated confidence gate ${holdout.falsePositiveRate === 0 && holdout.known.wrong === 0 ? "kept false accepts at zero" : "still produced false accepts"} while achieving ${pct(holdout.recall)} known recall.`,
    "- This is encouraging but not production readiness: the corpus is small, mostly one source catalogue, and no radio stream, station overlay, or diverse commercial-music validation has been performed.",
    "",
  ].join("\n");
}

async function main() {
  const indexed = manifest.recordings.filter((recording) => recording.indexed);
  const segments = [];
  const segmentsByRecording = new Map();
  for (const recording of indexed) {
    const alternatives = [];
    for (const start of [0, 15]) {
      const segment = { recordingId: recording.id, segmentId: `${recording.id}:${start}-20`, globalFrameOffset: start * frameRate, frames: await frames(join(generated, `${recording.id}-index-${start}.wav`)) };
      segments.push(segment);
      alternatives.push(segment);
    }
    segmentsByRecording.set(recording.id, alternatives);
  }
  const index = buildOffsetIndex(segments, retrievalKind);
  const evidenceRows = [];
  for (const row of sourceRows) {
    const queryFrames = await frames(join(generated, row.sample));
    const retrieval = rankOffsetCandidates(index, queryFrames, retrievalBucket);
    const retrievalCorrectRank = row.expectedKnown ? retrieval.ranking.findIndex((candidate) => candidate.recordingId === row.recordingId) + 1 : null;
    evidenceRows.push({ recordingId: row.recordingId, expectedKnown: row.expectedKnown, transformation: row.transformation, duration: row.duration, retrievalCorrectRank: retrievalCorrectRank || null, candidates: candidateEvidence(queryFrames, retrieval.ranking.slice(0, 20), segmentsByRecording) });
  }
  const calibrationEvidence = evidenceRows.filter((row) => Number(row.recordingId.slice(2)) % 2 === 1);
  const holdoutEvidence = evidenceRows.filter((row) => Number(row.recordingId.slice(2)) % 2 === 0);
  const selected = selectRule(calibrationEvidence);
  const holdoutRows = evaluateEvidence(holdoutEvidence, selected.rule, 20);
  const allRows = evaluateEvidence(evidenceRows, selected.rule, 20);
  const topK = Object.fromEntries(candidateLimits.map((limit) => [limit, outcome(evaluateEvidence(holdoutEvidence, selected.rule, limit))]));
  const result = {
    generatedAt: new Date().toISOString(),
    corpus: { indexed: indexed.length, unknownOnly: manifest.recordings.length - indexed.length, source: manifest.source },
    retrieval: { kind: retrievalKind, offsetBucketFrames: retrievalBucket, candidateLimit: 20, indexTokens: index.postings.size, indexPostings: index.postingCount },
    split: { calibration: { indexed: indexed.filter((recording) => Number(recording.id.slice(2)) % 2 === 1).map((recording) => recording.id), unknown: manifest.recordings.filter((recording) => !recording.indexed && Number(recording.id.slice(2)) % 2 === 1).map((recording) => recording.id) }, holdout: { indexed: indexed.filter((recording) => Number(recording.id.slice(2)) % 2 === 0).map((recording) => recording.id), unknown: manifest.recordings.filter((recording) => !recording.indexed && Number(recording.id.slice(2)) % 2 === 0).map((recording) => recording.id) } },
    ruleCandidates: rules.map((rule) => ({ rule, metrics: outcome(evaluateEvidence(calibrationEvidence, rule, 20)) })),
    best: { rule: selected.rule, calibration: selected.metrics, holdout: outcome(holdoutRows), topK, holdoutByTransformation: byTransformation(holdoutRows), allByTransformation: byTransformation(allRows), byDuration: Object.fromEntries([10, 20, 30].map((duration) => [duration, outcome(allRows.filter((row) => row.expectedKnown && row.duration === duration))])), holdoutRows },
  };
  writeFileSync(join(root, "real-music-matcher-results.json"), `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(join(root, "real-music-matcher-report.md"), report(result));
  console.log(`Wrote matcher calibration results for ${holdoutRows.length} holdout queries.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
