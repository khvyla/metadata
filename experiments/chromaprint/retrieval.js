function sampledFrameTokens(frames) {
  const tokens = new Set();
  for (let index = 0; index < frames.length; index += 8) tokens.add(`f:${(frames[index] >>> 12).toString(16)}`);
  return [...tokens];
}

function shingleTokens(frames) {
  const tokens = new Set();
  for (let index = 0; index + 2 < frames.length; index += 12) {
    const value = (((frames[index] >>> 16) * 31) ^ ((frames[index + 1] >>> 16) * 17) ^ (frames[index + 2] >>> 16)) >>> 0;
    tokens.add(`s:${value.toString(16)}`);
  }
  return [...tokens];
}

function buildInvertedIndex(segments, tokenise) {
  const postings = new Map();
  const tokensBySegment = [];
  for (const segment of segments) {
    const tokens = segment.tokens ?? tokenise(segment.frames);
    tokensBySegment[segment.id] = tokens;
    for (const token of tokens) { const values = postings.get(token) ?? []; values.push(segment.id); postings.set(token, values); }
  }
  return { postings, segments, tokensBySegment };
}

function retrieve(index, frames, tokenise, limit = 50) {
  const scores = new Map();
  for (const token of tokenise(frames)) for (const segmentId of index.postings.get(token) ?? []) scores.set(segmentId, (scores.get(segmentId) ?? 0) + 1);
  const segmentRanking = [...scores].map(([segmentId, score]) => ({ segmentId, score, recordingId: index.segments[segmentId].recordingId })).sort((a, b) => b.score - a.score || a.segmentId - b.segmentId);
  const recordingScores = new Map();
  for (const candidate of segmentRanking) recordingScores.set(candidate.recordingId, Math.max(recordingScores.get(candidate.recordingId) ?? 0, candidate.score));
  const recordingRanking = [...recordingScores].map(([recordingId, score]) => ({ recordingId, score })).sort((a, b) => b.score - a.score || a.recordingId.localeCompare(b.recordingId));
  return { segmentRanking: segmentRanking.slice(0, limit), recordingRanking: recordingRanking.slice(0, limit), candidateSegments: segmentRanking.length, candidateRecordings: recordingRanking.length };
}

function indexStats(index) {
  const frequencies = [...index.postings.values()].map((postings) => postings.length).sort((a, b) => a - b);
  const postingCount = frequencies.reduce((sum, value) => sum + value, 0);
  return { tokenCount: frequencies.length, postingCount, maxTokenFrequency: frequencies.at(-1) ?? 0, medianTokenFrequency: frequencies[Math.floor(frequencies.length / 2)] ?? 0, estimatedBytes: postingCount * 8 + frequencies.length * 40 };
}

module.exports = { buildInvertedIndex, indexStats, retrieve, sampledFrameTokens, shingleTokens };
