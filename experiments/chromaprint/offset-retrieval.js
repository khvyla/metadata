function tokenSets(frames, kind) {
  const tokens = [];
  for (let position = 0; position < frames.length; position += 1) {
    const current = frames[position] >>> 0;
    if (kind === "coarse-frame") {
      tokens.push({ token: `f:${current >>> 20}`, position });
    } else if (kind === "medium-frame") {
      tokens.push({ token: `f:${current >>> 16}`, position });
    } else if (kind === "coarse-pair" && position + 1 < frames.length) {
      const next = frames[position + 1] >>> 0;
      tokens.push({ token: `p:${current >>> 22}:${next >>> 22}`, position });
    }
  }
  return tokens;
}

function buildOffsetIndex(segments, kind) {
  const postings = new Map();
  let postingCount = 0;
  for (const segment of segments) {
    for (const value of tokenSets(segment.frames, kind)) {
      const entries = postings.get(value.token) ?? [];
      entries.push({ recordingId: segment.recordingId, segmentId: segment.segmentId, position: value.position + segment.globalFrameOffset });
      postings.set(value.token, entries);
      postingCount += 1;
    }
  }
  return { postings, kind, postingCount, segments };
}

function rankOffsetCandidates(index, queryFrames, bucketSize) {
  const votes = new Map();
  let sharedTokenHits = 0;
  for (const query of tokenSets(queryFrames, index.kind)) {
    for (const entry of index.postings.get(query.token) ?? []) {
      const bucket = Math.round((entry.position - query.position) / bucketSize);
      const key = `${entry.recordingId}|${bucket}`;
      const cluster = votes.get(key) ?? { recordingId: entry.recordingId, bucket, votes: 0, queryPositions: new Set(), minimumQueryPosition: query.position, maximumQueryPosition: query.position };
      cluster.votes += 1;
      cluster.queryPositions.add(query.position);
      cluster.minimumQueryPosition = Math.min(cluster.minimumQueryPosition, query.position);
      cluster.maximumQueryPosition = Math.max(cluster.maximumQueryPosition, query.position);
      votes.set(key, cluster);
      sharedTokenHits += 1;
    }
  }
  const recordings = new Map();
  for (const cluster of votes.values()) {
    const candidate = recordings.get(cluster.recordingId) ?? { recordingId: cluster.recordingId, totalVotes: 0, dominantVotes: 0, dominantBucket: 0, distinctQueryPositions: 0, evidenceSpan: 0 };
    candidate.totalVotes += cluster.votes;
    if (cluster.votes > candidate.dominantVotes) {
      candidate.dominantVotes = cluster.votes;
      candidate.dominantBucket = cluster.bucket;
      candidate.distinctQueryPositions = cluster.queryPositions.size;
      candidate.evidenceSpan = cluster.maximumQueryPosition - cluster.minimumQueryPosition;
    }
    recordings.set(cluster.recordingId, candidate);
  }
  const ranking = [...recordings.values()].map((candidate) => ({
    ...candidate,
    offsetConsistency: candidate.totalVotes ? candidate.dominantVotes / candidate.totalVotes : 0,
    score: candidate.dominantVotes * 3 + candidate.distinctQueryPositions + Math.min(candidate.evidenceSpan, 160) / 160,
  })).sort((left, right) => right.score - left.score || right.dominantVotes - left.dominantVotes || left.recordingId.localeCompare(right.recordingId));
  return { ranking, sharedTokenHits, candidateCount: ranking.length };
}

module.exports = { buildOffsetIndex, rankOffsetCandidates, tokenSets };
