import { describe, expect, it } from "vitest";
import { assessAirplayEligibility, processMetadata } from "../src";
import { createAudioFingerprint, getFingerprintCapability, parseFpcalcOutput } from "../src/recognition";
import type { AudioFingerprint, RecognitionProvider } from "../src/recognition";

const output = "DURATION=123.45\nFINGERPRINT=AQAAAA\n";
const runner = async () => ({ code: 0, stdout: output, stderr: "" });

describe("local recognition foundation", () => {
  it("reports unavailable fpcalc without throwing", async () => {
    await expect(getFingerprintCapability({ runner: async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); } })).resolves.toEqual({ available: false, reason: "fpcalc-unavailable" });
  });

  it("parses valid fpcalc output", () => {
    expect(parseFpcalcOutput(output)).toMatchObject({ fingerprint: "AQAAAA" });
  });

  it("rejects malformed fpcalc output", () => {
    expect(parseFpcalcOutput("DURATION=unknown\n")).toMatchObject({ error: "invalid-fingerprint" });
  });

  it("returns a structured timeout", async () => {
    const timeoutRunner = async () => { throw new Error("fpcalc timed out after 1 ms."); };
    await expect(createAudioFingerprint("sample.mp3", { runner: timeoutRunner })).resolves.toMatchObject({ error: "timeout" });
  });

  it("returns a structured Chromaprint fingerprint", async () => {
    await expect(createAudioFingerprint("sample.mp3", { runner })).resolves.toEqual({ algorithm: "chromaprint", fingerprint: "AQAAAA", durationSeconds: 123.45 });
  });

  it("records the Chromaprint algorithm", () => {
    expect(parseFpcalcOutput(output)).toMatchObject({ algorithm: "chromaprint" });
  });

  it("captures fpcalc duration", () => {
    expect(parseFpcalcOutput(output)).toMatchObject({ durationSeconds: 123.45 });
  });

  it("passes the file path as a discrete command argument", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    await createAudioFingerprint("file; unsafe.mp3", { runner: async (command, args) => { calls.push({ command, args }); return { code: 0, stdout: output, stderr: "" }; } });
    expect(calls).toEqual([{ command: "fpcalc", args: ["-length", "120", "file; unsafe.mp3"] }]);
  });

  it("supports a matched recognition provider result", async () => {
    const provider: RecognitionProvider = { recognize: async () => ({ matched: true, recording: { id: "recording-1", artist: "Stan Getz", title: "Misty" }, confidence: 0.99 }) };
    const fingerprint: AudioFingerprint = { algorithm: "chromaprint", fingerprint: "AQAAAA", durationSeconds: 123.45 };
    await expect(provider.recognize(fingerprint)).resolves.toMatchObject({ matched: true, recording: { id: "recording-1" } });
  });

  it("supports an unmatched recognition provider result", async () => {
    const provider: RecognitionProvider = { recognize: async () => ({ matched: false }) };
    const fingerprint: AudioFingerprint = { algorithm: "chromaprint", fingerprint: "AQAAAA", durationSeconds: 123.45 };
    await expect(provider.recognize(fingerprint)).resolves.toEqual({ matched: false });
  });

  it("leaves parser, resolver-compatible metadata, and quality APIs independent", () => {
    const metadata = processMetadata("StreamTitle='Stan Getz - Misty';");
    expect(assessAirplayEligibility(metadata)).toEqual({ eligible: true, reasons: [] });
  });
});
