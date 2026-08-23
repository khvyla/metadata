import { describe, expect, it } from "vitest";
import { buildInvertedIndex, retrieve, sampledFrameTokens, shingleTokens } from "../experiments/chromaprint/retrieval";
describe("Chromaprint retrieval experiment", () => {
  it("returns the matching recording through sampled frame buckets", () => { const segments = [{ id: 0, recordingId: "a", frames: [1, 2, 3, 4, 5, 6, 7, 8] }, { id: 1, recordingId: "b", frames: [-1, -2, -3, -4, -5, -6, -7, -8] }]; const index = buildInvertedIndex(segments, sampledFrameTokens); expect(retrieve(index, segments[0].frames, sampledFrameTokens).recordingRanking[0].recordingId).toBe("a"); });
  it("uses consecutive-frame shingles", () => { expect(shingleTokens([1, 2, 3, 4, 5, 6]).length).toBeGreaterThan(0); });
});
