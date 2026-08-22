import { describe, expect, it } from "vitest";
import { experimentalSimilarity, parseRawFingerprint } from "../experiments/chromaprint/comparison";
describe("Chromaprint experiment comparison", () => {
  it("parses raw fpcalc frames", () => expect(parseRawFingerprint("DURATION=10\nFINGERPRINT=1,2,3\n")).toEqual([1, 2, 3]));
  it("distinguishes identical from inverted frames", () => { expect(experimentalSimilarity([1, 2, 3, 4, 5, 6, 7, 8], [1, 2, 3, 4, 5, 6, 7, 8]).similarity).toBe(1); expect(experimentalSimilarity([0, 0, 0, 0, 0, 0, 0, 0], [-1, -1, -1, -1, -1, -1, -1, -1]).similarity).toBe(0); });
});
