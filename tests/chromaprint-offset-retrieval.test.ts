import { describe, expect, it } from "vitest";
import { buildOffsetIndex, rankOffsetCandidates } from "../experiments/chromaprint/offset-retrieval";

describe("offset-tolerant Chromaprint retrieval experiment", () => {
  it("ranks sustained offset-consistent evidence ahead of scattered collisions", () => {
    const index = buildOffsetIndex([
      { recordingId: "match", segmentId: "match:0", globalFrameOffset: 40, frames: [0xabc00000, 0xdef00000, 0x12300000, 0x45600000] },
      { recordingId: "scatter", segmentId: "scatter:0", globalFrameOffset: 0, frames: [0xabc00000, 0x99900000, 0x12300000, 0x88800000] },
    ], "coarse-frame");
    const result = rankOffsetCandidates(index, [0xabc00000, 0xdef00000, 0x12300000, 0x45600000], 2);
    expect(result.ranking[0].recordingId).toBe("match");
    expect(result.ranking[0].dominantVotes).toBe(4);
  });

  it("quantizes nearby relative offsets into one vote bucket", () => {
    const index = buildOffsetIndex([{ recordingId: "match", segmentId: "match:0", globalFrameOffset: 10, frames: [0xabc00000, 0xdef00000] }], "coarse-frame");
    const result = rankOffsetCandidates(index, [0xabc00000, 0xdef00000], 2);
    expect(result.ranking[0].dominantVotes).toBe(2);
  });
});
