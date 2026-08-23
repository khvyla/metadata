import { describe, expect, it } from "vitest";
import { decide, outcome } from "../experiments/chromaprint/real-music-matcher";

const rule = { minimumAverage: 0.95, minimumStrongProportion: 0.8, minimumRun: 20, minimumFrames: 40, minimumDominantVotes: 3, minimumMargin: 0.02 };
const candidate = (recordingId: string, average: number) => ({ recordingId, retrieval: { dominantVotes: 5 }, metrics: { averageBitSimilarity: average, strongFrameProportion: 0.9, longestStrongRun: 30, comparedFrames: 80 } });

describe("real-music matcher confidence experiment", () => {
  it("rejects an otherwise strong candidate with too little runner-up margin", () => {
    expect(decide([candidate("a", 0.98), candidate("b", 0.97)], rule).reason).toBe("ambiguous");
  });

  it("reports known and unknown decision outcomes separately", () => {
    const match = { matched: true, recordingId: "a" };
    const rejected = { matched: false, reason: "insufficient-evidence" };
    const result = outcome([{ recordingId: "a", expectedKnown: true, decision: match }, { recordingId: "b", expectedKnown: true, decision: rejected }, { recordingId: "u", expectedKnown: false, decision: rejected }]);
    expect(result.known).toEqual({ total: 2, correct: 1, wrong: 0, rejected: 1 });
    expect(result.unknown).toEqual({ total: 1, rejected: 1, falselyAccepted: 0 });
  });
});
