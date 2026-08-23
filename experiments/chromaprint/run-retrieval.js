const { execFile } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { promisify } = require("node:util");

const { parseRawFingerprint } = require("./comparison");
const { matcherMetrics } = require("./calibration");
const {
  buildInvertedIndex,
  indexStats,
  retrieve,
  sampledFrameTokens,
  shingleTokens,
} = require("./retrieval");

const exec = promisify(execFile);
const root = resolve(__dirname);
const samples = join(root, "samples", "calibration");
const approaches = {
  "sampled-frame-buckets": sampledFrameTokens,
  "quantized-frame-shingles": shingleTokens,
};
const ranks = [1, 5, 10, 20, 50];

function file(recording, suffix) {
  return `r${String(recording).padStart(2, "0")}-${suffix}`;
}

async function fingerprintFrames(name) {
  const { stdout } = await exec("fpcalc", ["-raw", join(samples, name)], {
    timeout: 10_000,
    maxBuffer: 128 * 1024,
  });
  return parseRawFingerprint(stdout);
}

async function loadCorpus() {
  const cache = new Map();
  const get = async (name) => {
    if (!cache.has(name)) cache.set(name, await fingerprintFrames(name));
    return cache.get(name);
  };
  const segments = [];
  for (let recording = 0; recording < 30; recording += 1) {
    for (const [start, end] of [[0, 20], [5, 25], [10, 30], [20, 40]]) {
      segments.push({
        id: segments.length,
        recordingId: `r${String(recording).padStart(2, "0")}`,
        segmentId: `${start}-${end}`,
        frames: await get(file(recording, `${start}-${end}.wav`)),
      });
    }
  }
  const queries = [];
  for (let recording = 0; recording < 30; recording += 1) {
    queries.push({ recordingId: `r${String(recording).padStart(2, "0")}`, kind: "20s-overlap-mp3", frames: await get(file(recording, "5-25-128.mp3")) });
  }
  for (let recording = 0; recording < 15; recording += 1) {
    queries.push({ recordingId: `r${String(recording).padStart(2, "0")}`, kind: "20s-codec-opus", frames: await get(file(recording, "0-20-96.opus")) });
  }
  for (let recording = 0; recording < 30; recording += 1) {
    queries.push({ recordingId: `r${String(recording).padStart(2, "0")}`, kind: "10s", frames: await get(file(recording, "0-10.wav")) });
    queries.push({ recordingId: `r${String(recording).padStart(2, "0")}`, kind: "30s", frames: await get(file(recording, "0-30.wav")) });
  }
  return { segments, queries };
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function evaluate(index, tokenise, queries) {
  const rows = [];
  const latencies = [];
  for (const query of queries) {
    const started = process.hrtime.bigint();
    const result = retrieve(index, query.frames, tokenise, 50);
    latencies.push(Number(process.hrtime.bigint() - started) / 1e6);
    const rank = result.recordingRanking.findIndex((candidate) => candidate.recordingId === query.recordingId) + 1;
    rows.push({
      kind: query.kind,
      recordingId: query.recordingId,
      correctRank: rank || null,
      candidateSegments: result.candidateSegments,
      candidateRecordings: result.candidateRecordings,
      top20SegmentIds: result.segmentRanking.slice(0, 20).map((candidate) => candidate.segmentId),
    });
  }
  const summary = (selectedRows) => ({
    recalls: Object.fromEntries(ranks.map((rank) => [rank, selectedRows.filter((row) => row.correctRank && row.correctRank <= rank).length / selectedRows.length])),
    missingRate: selectedRows.filter((row) => !row.correctRank).length / selectedRows.length,
    averageCandidateSegments: mean(selectedRows.map((row) => row.candidateSegments)),
    averageCandidateRecordings: mean(selectedRows.map((row) => row.candidateRecordings)),
    medianCandidateSegments: median(selectedRows.map((row) => row.candidateSegments)),
    medianCandidateRecordings: median(selectedRows.map((row) => row.candidateRecordings)),
  });
  const byKind = Object.fromEntries([...new Set(rows.map((row) => row.kind))].map((kind) => [kind, summary(rows.filter((row) => row.kind === kind))]));
  return { ...summary(rows), medianQueryLatencyMs: median(latencies), rows, byKind };
}

function detailedHandoff(index, segments, queries, tokenise) {
  let correctAfterTop20 = 0;
  let missingFromTop20 = 0;
  for (const query of queries) {
    const retrieved = retrieve(index, query.frames, tokenise, 20);
    if (!retrieved.segmentRanking.some((candidate) => candidate.recordingId === query.recordingId)) {
      missingFromTop20 += 1;
      continue;
    }
    const best = retrieved.segmentRanking
      .map((candidate) => ({
        recordingId: candidate.recordingId,
        score: matcherMetrics(query.frames, segments[candidate.segmentId].frames).averageBitSimilarity,
      }))
      .sort((left, right) => right.score - left.score)[0];
    if (best.recordingId === query.recordingId) correctAfterTop20 += 1;
  }
  return { queries: queries.length, correctAfterTop20, missingFromTop20 };
}

function syntheticScaleSegments(coreSegments, tokenise, segmentCount) {
  const segments = coreSegments.map((segment) => ({ ...segment }));
  const sourceTokens = coreSegments.map((segment) => tokenise(segment.frames));
  for (let id = coreSegments.length; id < segmentCount; id += 1) {
    const source = sourceTokens[id % sourceTokens.length];
    const salt = Math.floor(id / sourceTokens.length);
    segments.push({
      id,
      recordingId: `synthetic-${id}`,
      segmentId: "synthetic",
      tokens: source.map((token) => `${token}:salt:${salt}`),
    });
  }
  return segments;
}

function measureScales(coreSegments, queries, tokenise) {
  return [1_000, 10_000, 100_000].map((segmentCount) => {
    const started = process.hrtime.bigint();
    const index = buildInvertedIndex(syntheticScaleSegments(coreSegments, tokenise, segmentCount), tokenise);
    const buildMs = Number(process.hrtime.bigint() - started) / 1e6;
    const evaluation = evaluate(index, tokenise, queries.slice(0, 30));
    return {
      segmentCount,
      indexBuildMs: buildMs,
      medianQueryLatencyMs: evaluation.medianQueryLatencyMs,
      averageCandidateRecordings: evaluation.averageCandidateRecordings,
      medianCandidateRecordings: evaluation.medianCandidateRecordings,
      indexStats: indexStats(index),
      note: "Measured with salted token-level distractors for build, memory, and latency only; retrieval accuracy remains measured only on the real generated corpus.",
    };
  });
}

function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function report(results) {
  const measured = Object.values(results.measured);
  const best = [...measured].sort((left, right) => right.recalls[20] - left.recalls[20] || right.recalls[1] - left.recalls[1] || left.medianCandidateRecordings - right.medianCandidateRecordings)[0];
  const scale100k = results.scales[2];
  const lines = [
    "# Chromaprint candidate retrieval experiment",
    "",
    "## Scope",
    "",
    `- Core index: ${results.coreSegments} time-indexed 20-second segments from 30 deterministic generated recordings.`,
    `- Queries: ${results.queryCount} transformed/non-identical windows (overlapping MP3, Opus, 10-second, and 30-second samples).`,
    "- Retrieval is intentionally cheap and recall-oriented; the existing experimental detailed matcher is only applied after the Top-20 handoff.",
    "",
    "## Measured retrieval quality",
    "",
    "| Approach | Recall@1 | @5 | @10 | @20 | @50 | Missing | Avg / median candidates (recordings) | Median query ms | Build ms | Approx. index memory |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const result of measured) {
    lines.push(`| ${result.approach} | ${pct(result.recalls[1])} | ${pct(result.recalls[5])} | ${pct(result.recalls[10])} | ${pct(result.recalls[20])} | ${pct(result.recalls[50])} | ${pct(result.missingRate)} | ${result.averageCandidateRecordings.toFixed(1)} / ${result.medianCandidateRecordings} | ${result.medianQueryLatencyMs.toFixed(3)} | ${result.indexBuildMs.toFixed(3)} | ${(result.indexStats.estimatedBytes / 1024).toFixed(1)} KiB |`);
  }
  lines.push(
    "",
    "## Duration and handoff findings",
    "",
    `- Best approach: **${best.approach}**. Its Recall@20/50 is ${pct(best.recalls[20])}/${pct(best.recalls[50])}; correct recording missing rate is ${pct(best.missingRate)}.`,
    `- 10s: Recall@20 ${pct(best.byKind["10s"].recalls[20])}; 20s overlapping MP3: ${pct(best.byKind["20s-overlap-mp3"].recalls[20])}; 20s Opus: ${pct(best.byKind["20s-codec-opus"].recalls[20])}; 30s: ${pct(best.byKind["30s"].recalls[20])}.`,
    `- Top-20 → existing detailed matcher handoff on 30 transformed 20-second MP3 queries: ${best.detailedMatcherTop20.correctAfterTop20}/${best.detailedMatcherTop20.queries} correct; ${best.detailedMatcherTop20.missingFromTop20} correct recordings were absent from the retrieval shortlist.`,
    `- Collision profile: ${best.indexStats.tokenCount} unique tokens, ${best.indexStats.postingCount} postings, median token frequency ${best.indexStats.medianTokenFrequency}, maximum ${best.indexStats.maxTokenFrequency}. Highly common tokens are noisy and should be down-weighted or ignored in a future index.`,
    "",
    "## Measured scale behavior (synthetic distractor timing only)",
    "",
    "The scale indexes retain the generated ground-truth segments and add deterministically salted token-level distractors. These measurements are valid for build/memory/query-cost direction only; they do not manufacture accuracy claims.",
    "",
    "| Segments | Build ms | Median query ms | Avg / median candidates | Approx. index memory |",
    "| ---: | ---: | ---: | ---: | ---: |",
  );
  for (const scale of results.scales) {
    lines.push(`| ${scale.segmentCount.toLocaleString()} | ${scale.indexBuildMs.toFixed(1)} | ${scale.medianQueryLatencyMs.toFixed(3)} | ${scale.averageCandidateRecordings.toFixed(1)} / ${scale.medianCandidateRecordings} | ${(scale.indexStats.estimatedBytes / 1024 / 1024).toFixed(2)} MiB |`);
  }
  lines.push(
    "",
    "## Interpretation",
    "",
    `- At 100k measured token-level segments, the cheap index kept median query time at ${scale100k.medianQueryLatencyMs.toFixed(3)} ms with ${scale100k.medianCandidateRecordings} median candidate recordings. A 1M-segment estimate is roughly ${(scale100k.indexStats.estimatedBytes * 10 / 1024 / 1024).toFixed(1)} MiB index storage and ${(scale100k.indexBuildMs * 10 / 1000).toFixed(1)} s single-process build time, assuming linear growth; query latency requires a real 1M measurement before any commitment.`,
    "- The evidence supports continuing with segmented, time-indexed fingerprints and a cheap inverted-token candidate stage ahead of detailed temporal matching. It does not establish production readiness: real music, radio transcoding, station overlays, and a much more diverse corpus remain unproven.",
    "",
  );
  return lines.join("\n");
}

async function main() {
  const { segments, queries } = await loadCorpus();
  const measured = {};
  for (const [name, tokenise] of Object.entries(approaches)) {
    const started = process.hrtime.bigint();
    const index = buildInvertedIndex(segments, tokenise);
    const buildMs = Number(process.hrtime.bigint() - started) / 1e6;
    measured[name] = {
      approach: name,
      indexBuildMs: buildMs,
      indexStats: indexStats(index),
      ...evaluate(index, tokenise, queries),
      detailedMatcherTop20: detailedHandoff(index, segments, queries.filter((query) => query.kind === "20s-overlap-mp3"), tokenise),
    };
  }
  const results = {
    generatedAt: new Date().toISOString(),
    coreSegments: segments.length,
    queryCount: queries.length,
    measured,
    scales: measureScales(segments, queries, sampledFrameTokens),
  };
  writeFileSync(join(root, "retrieval-results.json"), `${JSON.stringify(results, null, 2)}\n`);
  writeFileSync(join(root, "retrieval-report.md"), report(results));
  console.log(`Wrote retrieval results for ${queries.length} queries.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
