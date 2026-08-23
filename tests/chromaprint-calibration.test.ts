import { describe, expect, it } from "vitest";
import { applyRule, evaluate, matcherMetrics, rates } from "../experiments/chromaprint/calibration";
describe("Chromaprint calibration metrics", () => {
  it("rewards sustained aligned evidence", () => { const metrics = matcherMetrics(Array(100).fill(123), Array(100).fill(123)); expect(metrics.averageBitSimilarity).toBe(1); expect(metrics.longestStrongRun).toBe(100); });
  it("requires more than an average score", () => { const rule = { minimumAverage: .9, minimumStrongProportion: .8, minimumRun: 16, minimumFrames: 40 }; expect(applyRule({ averageBitSimilarity: .95, strongFrameProportion: .1, longestStrongRun: 2, comparedFrames: 100 }, rule)).toBe(false); });
  it("reports conservative classification rates", () => { const pairs = [{ expectedMatch: true, metrics: { averageBitSimilarity: 1, strongFrameProportion: 1, longestStrongRun: 50, comparedFrames: 50 } }, { expectedMatch: false, metrics: { averageBitSimilarity: .5, strongFrameProportion: 0, longestStrongRun: 0, comparedFrames: 50 } }]; const counts = evaluate(pairs, { minimumAverage: .9, minimumStrongProportion: .8, minimumRun: 16, minimumFrames: 40 }); expect(counts).toEqual({ tp: 1, tn: 1, fp: 0, fn: 0 }); expect(rates(counts).falsePositiveRate).toBe(0); });
});
