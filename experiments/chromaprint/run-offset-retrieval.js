const { execFile } = require("node:child_process");
const { readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { promisify } = require("node:util");

const { matcherMetrics, applyRule } = require("./calibration");
const { parseRawFingerprint } = require("./comparison");
const { buildOffsetIndex, rankOffsetCandidates } = require("./offset-retrieval");

const exec = promisify(execFile);
const root = resolve(__dirname);
const generated = join(root, "samples", "real-music", "generated");
const manifest = JSON.parse(readFileSync(join(root, "real-music-manifest.json"), "utf8"));
const baseline = JSON.parse(readFileSync(join(root, "real-music-results.json"), "utf8"));
const frameRate = 8;
const topRanks = [1, 5, 10, 20, 50];
const rule = { minimumAverage: 0.99, minimumStrongProportion: 0.3, minimumRun: 120, minimumFrames: 40 };

async function frames(file) {
  const { stdout } = await exec("fpcalc", ["-raw", file], { timeout: 10_000, maxBuffer: 128 * 1024 });
  return parseRawFingerprint(stdout);
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function summary(rows) {
  return {
    recalls: Object.fromEntries(topRanks.map((rank) => [rank, rows.filter((row) => row.correctRank && row.correctRank <= rank).length / rows.length])),
    missingRate: rows.filter((row) => !row.correctRank).length / rows.length,
    averageCandidateCount: average(rows.map((row) => row.candidateCount)),
    medianCandidateCount: median(rows.map((row) => row.candidateCount)),
    averageTop20Size: average(rows.map((row) => Math.min(row.candidateCount, 20))),
    medianQueryLatencyMs: median(rows.map((row) => row.queryLatencyMs)),
  };
}

function byTransformation(rows) {
  return Object.fromEntries([...new Set(rows.map((row) => row.transformation))].map((transformation) => {
    const subset = rows.filter((row) => row.transformation === transformation);
    return [transformation, summary(subset)];
  }));
}

function evaluate(index, queries) {
  return queries.map((query) => {
    const started = process.hrtime.bigint();
    const result = rankOffsetCandidates(index, query.frames, query.bucketSize);
    const queryLatencyMs = Number(process.hrtime.bigint() - started) / 1e6;
    const correctRank = query.expectedKnown ? result.ranking.findIndex((candidate) => candidate.recordingId === query.recordingId) + 1 : null;
    const correct = correctRank ? result.ranking[correctRank - 1] : null;
    const first = result.ranking[0] ?? null;
    return {
      recordingId: query.recordingId,
      expectedKnown: query.expectedKnown,
      transformation: query.transformation,
      duration: query.duration,
      correctRank: correctRank || null,
      candidateCount: result.candidateCount,
      sharedTokenHits: result.sharedTokenHits,
      queryLatencyMs,
      correct: correct ? { dominantVotes: correct.dominantVotes, totalVotes: correct.totalVotes, offsetConsistency: correct.offsetConsistency, evidenceSpan: correct.evidenceSpan, offsetBucket: correct.dominantBucket } : null,
      best: first ? { recordingId: first.recordingId, dominantVotes: first.dominantVotes, totalVotes: first.totalVotes, offsetConsistency: first.offsetConsistency, evidenceSpan: first.evidenceSpan, offsetBucket: first.dominantBucket } : null,
    };
  });
}

function chooseBest(results) {
  const kindPreference = { "medium-frame": 0, "coarse-pair": 1, "coarse-frame": 2 };
  return [...results].sort((left, right) => right.calibration.recalls[20] - left.calibration.recalls[20]
    || right.calibration.recalls[50] - left.calibration.recalls[50]
    || left.calibration.medianCandidateCount - right.calibration.medianCandidateCount
    || kindPreference[left.kind] - kindPreference[right.kind]
    || Math.abs(left.bucketSize - 2) - Math.abs(right.bucketSize - 2)
    || left.bucketSize - right.bucketSize)[0];
}

function pct(value) { return `${(value * 100).toFixed(1)}%`; }

function report(result) {
  const best = result.best;
  const holdout = best.holdout;
  const knownOffset = best.holdoutRows.filter((row) => row.correct).map((row) => row.correct.offsetConsistency);
  const unknown = best.unknownRows;
  const unknownVote = unknown.map((row) => row.best?.dominantVotes ?? 0);
  const unknownConsistency = unknown.map((row) => row.best?.offsetConsistency ?? 0);
  const strongestUnknown = [...unknown].sort((left, right) => (right.best?.offsetConsistency ?? 0) - (left.best?.offsetConsistency ?? 0))[0];
  const failureRows = best.holdoutRows.filter((row) => !row.correctRank);
  return [
    "# Offset-tolerant real-music retrieval experiment",
    "",
    "## Preserved baseline",
    "",
    "| Method | Recall@20 | Missing rate |",
    "| --- | ---: | ---: |",
    "| Prior exact-shingle baseline | 17.4% | 82.6% |",
    `| Best offset-aware holdout (${best.kind}, ${best.bucketSize}-frame bucket) | ${pct(holdout.recalls[20])} | ${pct(holdout.missingRate)} |`,
    "",
    "## Design and split",
    "",
    "- Position-aware tokens vote for `recordingId + quantized(indexedFrame - queryFrame)`; ranking rewards the dominant offset cluster, distinct query positions, and evidence span.",
    "- Deterministic split by recording ID: odd-numbered indexed recordings calibration; even-numbered indexed recordings holdout. Queries remain non-identical transformed windows.",
    "",
    "## Calibration versus holdout approaches",
    "",
    "| Token kind | Bucket frames | Calibration R@20 | Holdout R@1 | @5 | @10 | @20 | @50 | Holdout missing | Median ms | Tokens / postings |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...result.approaches.map((entry) => `| ${entry.kind} | ${entry.bucketSize} | ${pct(entry.calibration.recalls[20])} | ${pct(entry.holdout.recalls[1])} | ${pct(entry.holdout.recalls[5])} | ${pct(entry.holdout.recalls[10])} | ${pct(entry.holdout.recalls[20])} | ${pct(entry.holdout.recalls[50])} | ${pct(entry.holdout.missingRate)} | ${entry.holdout.medianQueryLatencyMs.toFixed(3)} | ${entry.index.tokenCount} / ${entry.index.postingCount} |`),
    "",
    "## Transformation diagnostics (all known queries; not used to select the approach)",
    "",
    ...Object.entries(best.fullByTransformation).map(([name, values]) => `- ${name}: Recall@20 ${pct(values.recalls[20])}; missing ${pct(values.missingRate)} (${values.averageCandidateCount.toFixed(1)} average candidates).`),
    `- Duration groups: 10s ${pct(best.durationGroups[10].recalls[20])}; 20s ${pct(best.durationGroups[20].recalls[20])}; 30s ${pct(best.durationGroups[30].recalls[20])}.`,
    "",
    "## Offset and unknown-query evidence",
    "",
    `- Correct holdout candidates: median dominant-offset consistency ${median(knownOffset).toFixed(3)} across ${knownOffset.length} retrieved matches; dominant clusters come from sustained matching query positions rather than shared tokens anywhere.`,
    `- Unknown-only queries: ${unknown.length}; median ${median(unknown.map((row) => row.candidateCount))} candidate recordings, dominant-cluster votes ${median(unknownVote).toFixed(1)}, consistency ${median(unknownConsistency).toFixed(3)}. They can retrieve candidates but their vote patterns are retained only as future confidence-gate signals, not recognition decisions.`,
    `- The strongest unknown cluster reached consistency ${(strongestUnknown.best?.offsetConsistency ?? 0).toFixed(3)} but only ${strongestUnknown.best?.dominantVotes ?? 0} dominant votes over span ${strongestUnknown.best?.evidenceSpan ?? 0}; offset consistency alone is therefore not a recognition gate.`,
    "",
    "## Retrieval miss sample",
    "",
    ...(failureRows.length ? failureRows.slice(0, 10).map((row) => `- ${row.recordingId}: ${row.transformation}, ${row.duration}s; ${row.sharedTokenHits} shared token hits; best cluster ${row.best?.dominantVotes ?? 0} votes; ${row.best ? `best ${row.best.recordingId}` : "no candidate"}.`) : ["- No holdout retrieval misses."]),
    "",
    "## Conclusion",
    "",
    `- Temporal offset voting ${holdout.recalls[20] > 0.174 ? "materially improves" : "does not materially improve"} the real-music shortlist over the preserved 17.4% baseline on the separated holdout.`,
    "- The detailed matcher was intentionally not recalibrated. The next bottleneck, if retrieval becomes high-recall, remains validation/calibration of that matcher on a separately held-out real-music corpus before real-radio testing.",
    "",
  ].join("\n");
}

async function main() {
  const indexed = manifest.recordings.filter((recording) => recording.indexed);
  const segments = [];
  for (const recording of indexed) {
    for (const start of [0, 15]) {
      segments.push({
        recordingId: recording.id,
        segmentId: `${recording.id}:${start}-20`,
        globalFrameOffset: start * frameRate,
        frames: await frames(join(generated, `${recording.id}-index-${start}.wav`)),
      });
    }
  }
  const queryFrames = new Map();
  const sourceRows = baseline.rows.map((row) => ({ ...row, frames: null }));
  for (const row of sourceRows) {
    const path = join(generated, row.sample);
    queryFrames.set(row.sample, await frames(path));
    row.frames = queryFrames.get(row.sample);
  }
  const known = sourceRows.filter((row) => row.expectedKnown);
  const calibrationQueries = known.filter((row) => Number(row.recordingId.slice(2)) % 2 === 1);
  const holdoutQueries = known.filter((row) => Number(row.recordingId.slice(2)) % 2 === 0);
  const unknownQueries = sourceRows.filter((row) => !row.expectedKnown);
  const approachSpecs = [
    ["coarse-frame", 1], ["coarse-frame", 2], ["coarse-frame", 4],
    ["medium-frame", 1], ["medium-frame", 2], ["medium-frame", 4],
    ["coarse-pair", 1], ["coarse-pair", 2], ["coarse-pair", 4],
  ];
  const approaches = [];
  for (const [kind, bucketSize] of approachSpecs) {
    const index = buildOffsetIndex(segments, kind);
    const decorate = (rows) => rows.map((row) => ({ ...row, bucketSize }));
    const calibrationRows = evaluate(index, decorate(calibrationQueries));
    const holdoutRows = evaluate(index, decorate(holdoutQueries));
    approaches.push({ kind, bucketSize, index: { tokenCount: index.postings.size, postingCount: index.postingCount }, calibration: summary(calibrationRows), holdout: summary(holdoutRows), calibrationRows, holdoutRows });
  }
  const best = chooseBest(approaches);
  const bestIndex = buildOffsetIndex(segments, best.kind);
  best.holdoutByTransformation = byTransformation(best.holdoutRows);
  best.fullRows = evaluate(bestIndex, known.map((row) => ({ ...row, bucketSize: best.bucketSize })));
  best.fullByTransformation = byTransformation(best.fullRows);
  best.durationGroups = Object.fromEntries([10, 20, 30].map((duration) => [duration, summary(best.fullRows.filter((row) => row.duration === duration))]));
  best.unknownRows = evaluate(bestIndex, unknownQueries.map((row) => ({ ...row, bucketSize: best.bucketSize })));
  const result = {
    generatedAt: new Date().toISOString(),
    corpus: { indexed: indexed.length, unknownOnly: unknownQueries.length, source: manifest.source },
    baseline: { recallAt20: 0.174, missingRate: 0.826 },
    split: { calibrationRecordings: indexed.filter((recording) => Number(recording.id.slice(2)) % 2 === 1).map((recording) => recording.id), holdoutRecordings: indexed.filter((recording) => Number(recording.id.slice(2)) % 2 === 0).map((recording) => recording.id) },
    approaches: approaches.map(({ calibrationRows, holdoutRows, ...entry }) => entry),
    best: { kind: best.kind, bucketSize: best.bucketSize, calibration: best.calibration, holdout: best.holdout, holdoutByTransformation: best.holdoutByTransformation, holdoutRows: best.holdoutRows, fullByTransformation: best.fullByTransformation, durationGroups: best.durationGroups, fullRows: best.fullRows, unknownRows: best.unknownRows },
  };
  writeFileSync(join(root, "offset-retrieval-results.json"), `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(join(root, "offset-retrieval-report.md"), report(result));
  console.log(`Wrote offset-aware results for ${holdoutQueries.length} holdout and ${unknownQueries.length} unknown queries.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
