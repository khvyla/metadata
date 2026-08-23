const { matcherMetrics } = require("./calibration");

function candidateEvidence(queryFrames, retrievalCandidates, segmentsByRecording) {
  return retrievalCandidates.map((candidate) => {
    const alternatives = segmentsByRecording.get(candidate.recordingId) ?? [];
    const best = alternatives.map((segment) => ({ segmentId: segment.segmentId, metrics: matcherMetrics(queryFrames, segment.frames) }))
      .sort((left, right) => right.metrics.averageBitSimilarity - left.metrics.averageBitSimilarity || right.metrics.longestStrongRun - left.metrics.longestStrongRun)[0];
    return { recordingId: candidate.recordingId, retrieval: candidate, segmentId: best?.segmentId ?? null, metrics: best?.metrics ?? null };
  }).filter((candidate) => candidate.metrics).sort((left, right) => right.metrics.averageBitSimilarity - left.metrics.averageBitSimilarity || right.metrics.longestStrongRun - left.metrics.longestStrongRun);
}

function decide(candidates, rule) {
  const best = candidates[0] ?? null;
  const runnerUp = candidates[1] ?? null;
  if (!best) return { matched: false, reason: "insufficient-evidence", best: null, runnerUp: null, margin: null };
  const margin = best.metrics.averageBitSimilarity - (runnerUp?.metrics.averageBitSimilarity ?? 0);
  const insufficient = best.metrics.averageBitSimilarity < rule.minimumAverage
    || best.metrics.strongFrameProportion < rule.minimumStrongProportion
    || best.metrics.longestStrongRun < rule.minimumRun
    || best.metrics.comparedFrames < rule.minimumFrames
    || best.retrieval.dominantVotes < rule.minimumDominantVotes;
  if (insufficient) return { matched: false, reason: "insufficient-evidence", best, runnerUp, margin };
  if (margin < rule.minimumMargin) return { matched: false, reason: "ambiguous", best, runnerUp, margin };
  return { matched: true, recordingId: best.recordingId, best, runnerUp, margin };
}

function outcome(rows) {
  const known = rows.filter((row) => row.expectedKnown);
  const unknown = rows.filter((row) => !row.expectedKnown);
  const knownCorrect = known.filter((row) => row.decision.matched && row.decision.recordingId === row.recordingId).length;
  const knownWrong = known.filter((row) => row.decision.matched && row.decision.recordingId !== row.recordingId).length;
  const knownRejected = known.length - knownCorrect - knownWrong;
  const unknownFalseAccepted = unknown.filter((row) => row.decision.matched).length;
  const unknownRejected = unknown.length - unknownFalseAccepted;
  const accepted = knownCorrect + knownWrong + unknownFalseAccepted;
  return {
    known: { total: known.length, correct: knownCorrect, wrong: knownWrong, rejected: knownRejected },
    unknown: { total: unknown.length, rejected: unknownRejected, falselyAccepted: unknownFalseAccepted },
    precision: accepted ? knownCorrect / accepted : 0,
    recall: known.length ? knownCorrect / known.length : 0,
    falsePositiveRate: unknown.length ? unknownFalseAccepted / unknown.length : 0,
    rejectionRate: rows.length ? (knownRejected + unknownRejected) / rows.length : 0,
  };
}

module.exports = { candidateEvidence, decide, outcome };
