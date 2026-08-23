const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { createAudioFingerprint } = require("../../dist/recognition");
const { applyRule, distribution, evaluate, matcherMetrics, rates } = require("./calibration");
const { parseRawFingerprint } = require("./comparison");

const exec = promisify(execFile); const root = resolve(__dirname); const samples = join(root, "samples", "calibration");
const recording = (index, suffix) => `r${String(index).padStart(2, "0")}-${suffix}`;

async function inspect(file) {
  const canonical = await createAudioFingerprint(join(samples, file));
  if ("error" in canonical) throw new Error(`${file}: ${canonical.error}`);
  const { stdout } = await exec("fpcalc", ["-raw", join(samples, file)], { timeout: 10_000, maxBuffer: 128 * 1024 });
  return { ...canonical, raw: parseRawFingerprint(stdout) };
}

function descriptors() {
  const values = []; const add = (a, b, relationship, scenario, expectedMatch) => values.push({ a, b, relationship, scenario, expectedMatch });
  for (let index = 0; index < 30; index += 1) {
    const r = (suffix) => recording(index, suffix);
    add(r("0-20.wav"), r("5-25.wav"), "same-recording", "overlap-5s", true); add(r("0-20.wav"), r("10-30.wav"), "same-recording", "overlap-10s", true); add(r("5-25.wav"), r("10-30.wav"), "same-recording", "overlap-15s", true); add(r("10-30.wav"), r("20-40.wav"), "same-recording", "overlap-10s-late", true); add(r("0-10.wav"), r("0-20.wav"), "same-recording", "duration-10-vs-20", true); add(r("0-20.wav"), r("0-30.wav"), "same-recording", "duration-20-vs-30", true); add(r("0-20.wav"), r("20-40.wav"), "same-recording", "non-overlap", false);
    if (index < 15) for (const variant of ["64.mp3", "128.mp3", "320.mp3", "96.opus"]) add(r("0-20.wav"), r(`0-20-${variant}`), "same-recording", `transcode-${variant}`, true);
  }
  const negatives = []; for (let a = 0; a < 30; a += 1) for (let b = 0; b < 30; b += 1) if (a !== b) negatives.push([a, b]);
  for (let index = negatives.length - 1; index > 0; index -= 1) { const swap = (index * 17 + 23) % (index + 1); [negatives[index], negatives[swap]] = [negatives[swap], negatives[index]]; }
  for (const [a, b] of negatives.slice(0, 600)) add(recording(a, "0-20.wav"), recording(b, "0-20.wav"), "different-recording", "different-recording", false);
  return values;
}

function selectRule(pairs) {
  const rules = [];
  for (const minimumAverage of [.80, .84, .88, .90, .92, .94, .96, .98, .99, .995]) for (const minimumStrongProportion of [.30, .50, .70, .85, .95]) for (const minimumRun of [8, 16, 32, 48, 80, 120]) for (const minimumFrames of [40, 80]) rules.push({ minimumAverage, minimumStrongProportion, minimumRun, minimumFrames });
  return rules.map((rule) => ({ rule, counts: evaluate(pairs, rule) })).sort((a, b) => a.counts.fp - b.counts.fp || b.counts.tp - a.counts.tp || b.rule.minimumRun - a.rule.minimumRun)[0];
}

async function main() {
  const cache = new Map(); const get = async (file) => { if (!cache.has(file)) cache.set(file, await inspect(file)); return cache.get(file); };
  const pairs = [];
  for (const descriptor of descriptors()) { const left = await get(descriptor.a); const right = await get(descriptor.b); pairs.push({ ...descriptor, durationSeconds: [left.durationSeconds, right.durationSeconds], exactFingerprintEquality: left.fingerprint === right.fingerprint, metrics: matcherMetrics(left.raw, right.raw) }); }
  const calibration = pairs.filter((_, index) => index % 5 !== 0); const holdoutPairs = pairs.filter((_, index) => index % 5 === 0); const best = selectRule(calibration); const holdoutCounts = evaluate(holdoutPairs, best.rule);
  const indexSegments = await Promise.all(Array.from({ length: 30 }, (_, index) => get(recording(index, "0-20.wav")))); const queries = [];
  for (let index = 15; index < 30; index += 1) { const query = await get(recording(index, "5-25-128.mp3")); const candidates = indexSegments.map((candidate, candidateId) => ({ candidateId, metrics: matcherMetrics(query.raw, candidate.raw) })).sort((a, b) => b.metrics.averageBitSimilarity - a.metrics.averageBitSimilarity); const top = candidates[0]; const accepted = applyRule(top.metrics, best.rule); queries.push({ queryRecording: index, topCandidate: top.candidateId, accepted, correct: accepted && top.candidateId === index }); }
  const framesPerSegment = Math.round(indexSegments.reduce((sum, item) => sum + item.raw.length, 0) / indexSegments.length); const scales = [1000, 10000, 100000, 1000000].map((recordings) => ({ recordings, segments: recordings * 3, rawStorageBytes: recordings * 3 * framesPerSegment * 4, naiveFrameComparisonsPerQuery: recordings * 3 * framesPerSegment * framesPerSegment }));
  const results = { generatedAt: new Date().toISOString(), corpus: { recordings: 30, generatedMaterial: "deterministic multi-voice modulated rhythmic synthesis with distinct seeded noise beds", primaryWindowSeconds: 20 }, pairCounts: { total: pairs.length, positive: pairs.filter((pair) => pair.expectedMatch).length, negative: pairs.filter((pair) => !pair.expectedMatch).length, calibration: calibration.length, holdout: holdoutPairs.length }, scoreDistributions: { positive: distribution(pairs.filter((pair) => pair.expectedMatch).map((pair) => pair.metrics.averageBitSimilarity)), negative: distribution(pairs.filter((pair) => !pair.expectedMatch).map((pair) => pair.metrics.averageBitSimilarity)) }, rule: best.rule, calibrationCounts: best.counts, holdout: { counts: holdoutCounts, rates: rates(holdoutCounts) }, querySimulation: { total: queries.length, correct: queries.filter((query) => query.correct).length, incorrect: queries.filter((query) => query.accepted && !query.correct).length, rejected: queries.filter((query) => !query.accepted).length }, scales, pairs };
  writeFileSync(join(root, "calibration-results.json"), JSON.stringify(results, null, 2) + "\n"); writeFileSync(join(root, "calibration-report.md"), report(results)); console.log(`Wrote ${pairs.length} calibrated comparisons.`);
}

const pct = (value) => `${(value * 100).toFixed(2)}%`;
function report(result) { const h = result.holdout; return ["# Chromaprint matcher calibration", "", "## Corpus and split", "", "- 30 deterministic synthetic, multi-voice/rhythmic recordings with distinct seeded noise beds; generated audio is ignored.", `- ${result.pairCounts.positive} expected-match pairs and ${result.pairCounts.negative} expected-non-match pairs (${result.pairCounts.total} total).`, `- Deterministic split: ${result.pairCounts.calibration} calibration pairs / ${result.pairCounts.holdout} untouched holdout pairs.`, "", "## Score distributions", "", "| Group | Min | Median | Max |", "| --- | ---: | ---: | ---: |", `| Expected match | ${result.scoreDistributions.positive.min.toFixed(3)} | ${result.scoreDistributions.positive.median.toFixed(3)} | ${result.scoreDistributions.positive.max.toFixed(3)} |`, `| Expected non-match | ${result.scoreDistributions.negative.min.toFixed(3)} | ${result.scoreDistributions.negative.median.toFixed(3)} | ${result.scoreDistributions.negative.max.toFixed(3)} |`, "", "## Most conservative tested rule", "", `Accept only when average bit similarity ≥ ${result.rule.minimumAverage}, strong-frame proportion ≥ ${result.rule.minimumStrongProportion}, longest strong run ≥ ${result.rule.minimumRun} frames, and aligned evidence ≥ ${result.rule.minimumFrames} frames. It was selected by minimum calibration false positives, then maximum true positives.`, "", "## Holdout", "", "| TP | TN | FP | FN | Precision | Recall | Specificity | FPR |", "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |", `| ${h.counts.tp} | ${h.counts.tn} | ${h.counts.fp} | ${h.counts.fn} | ${pct(h.rates.precision)} | ${pct(h.rates.recall)} | ${pct(h.rates.specificity)} | ${pct(h.rates.falsePositiveRate)} |`, "", "## Query simulation", "", `Unknown 20-second MP3 windows queried against 30 candidate 20-second index segments: ${result.querySimulation.correct} correct top-1, ${result.querySimulation.incorrect} incorrect top-1, ${result.querySimulation.rejected} rejected/ambiguous.`, "", "## Findings", "", "- Same-recording transcoded and overlapping windows often have sustained aligned evidence, but are not reliably separated from every different synthetic recording by this matcher.", "- False positives are raw-frame collisions among structurally similar generated sources; low-level seeded noise does not reliably survive into distinct Chromaprint evidence. This corpus remains insufficiently diverse for production calibration.", "- The strict long-run requirement causes false negatives for shorter or weaker evidence, including 10-second windows (about 59 raw frames).", "- Non-overlapping portions of the same synthetic recording are intentionally treated as no confident match unless shared fingerprint evidence exists.", "- 20 seconds remains the practical initial candidate: it supplies more sustained evidence than 10 seconds while avoiding extra latency of 30 seconds, but it is not yet validated on real music/radio.", "- A future index should retain multiple time-indexed 20-second frame sequences per recording, not one complete-recording fingerprint.", "- Chromaprint is promising enough to continue R&D, but the observed false-positive rate is unsuitable for airplay use; representative music/radio captures, matcher calibration, and retrieval design remain unproven before production.", "", "## Scale sanity check", "", "| Recordings | 20s segments (3/recording) | Raw-frame storage | Naive frame comparisons/query |", "| ---: | ---: | ---: | ---: |", ...result.scales.map((scale) => `| ${scale.recordings.toLocaleString()} | ${scale.segments.toLocaleString()} | ${(scale.rawStorageBytes / 1024 / 1024).toFixed(1)} MiB | ${scale.naiveFrameComparisonsPerQuery.toLocaleString()} |`), "", "Naive detailed comparison becomes impractical at large scale; a retrieval/indexing stage is required before production, but is not implemented here.", ""].join("\n"); }
main().catch((error) => { console.error(error); process.exitCode = 1; });
