import { spawn } from "node:child_process";

export type AudioFingerprint = {
  algorithm: "chromaprint";
  fingerprint: string;
  durationSeconds: number;
};

export type FingerprintErrorCategory = "fpcalc-unavailable" | "timeout" | "fingerprint-failed" | "invalid-fingerprint";
export type FingerprintError = { error: FingerprintErrorCategory; message?: string };
export type AudioFingerprintResult = AudioFingerprint | FingerprintError;
export type FingerprintCapability =
  | { available: true; algorithm: "chromaprint" }
  | { available: false; reason: "fpcalc-unavailable" };

export type FingerprintCommandResult = { code: number; stdout: string; stderr: string };
export type FingerprintCommandRunner = (command: string, args: string[], options: { timeoutMs: number; maxOutputBytes: number }) => Promise<FingerprintCommandResult>;
export type FingerprintOptions = {
  timeoutMs?: number;
  maxOutputBytes?: number;
  runner?: FingerprintCommandRunner;
};

export type RecognitionResult =
  | { matched: true; recording: { id: string; artist: string; title: string }; confidence: number }
  | { matched: false };

export interface RecognitionProvider {
  recognize(fingerprint: AudioFingerprint): Promise<RecognitionResult>;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;

export async function getFingerprintCapability(options: FingerprintOptions = {}): Promise<FingerprintCapability> {
  const runner = options.runner ?? runCommand;
  try {
    const result = await runner("fpcalc", ["-version"], commandOptions(options));
    return result.code === 0 ? { available: true, algorithm: "chromaprint" } : { available: false, reason: "fpcalc-unavailable" };
  } catch {
    return { available: false, reason: "fpcalc-unavailable" };
  }
}

/** Generates a Chromaprint fingerprint from a local audio file path. */
export async function createAudioFingerprint(audioFilePath: string, options: FingerprintOptions = {}): Promise<AudioFingerprintResult> {
  const runner = options.runner ?? runCommand;
  try {
    const result = await runner("fpcalc", ["-length", "120", audioFilePath], commandOptions(options));
    if (result.code !== 0) return { error: "fingerprint-failed", message: result.stderr || "fpcalc exited unsuccessfully." };
    return parseFpcalcOutput(result.stdout);
  } catch (error) {
    if (error instanceof CommandTimeoutError || error instanceof Error && /timed out/i.test(error.message)) return { error: "timeout", message: error.message };
    if (isMissingCommand(error)) return { error: "fpcalc-unavailable" };
    return { error: "fingerprint-failed", message: error instanceof Error ? error.message : "fpcalc failed." };
  }
}

export function parseFpcalcOutput(output: string): AudioFingerprintResult {
  const values = new Map(output.split(/\r?\n/).map((line) => {
    const separator = line.indexOf("=");
    return separator < 0 ? ["", ""] : [line.slice(0, separator), line.slice(separator + 1)];
  }));
  const durationSeconds = Number(values.get("DURATION"));
  const fingerprint = values.get("FINGERPRINT")?.trim();
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || !fingerprint) return { error: "invalid-fingerprint", message: "fpcalc output did not contain a usable duration and fingerprint." };
  return { algorithm: "chromaprint", fingerprint, durationSeconds };
}

function commandOptions(options: FingerprintOptions) {
  return { timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS, maxOutputBytes: options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES };
}

class CommandTimeoutError extends Error {}

async function runCommand(command: string, args: string[], options: { timeoutMs: number; maxOutputBytes: number }): Promise<FingerprintCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    const timeout = setTimeout(() => {
      child.kill();
      reject(new CommandTimeoutError(`fpcalc timed out after ${options.timeoutMs} ms.`));
    }, options.timeoutMs);
    const append = (chunk: Buffer, target: "stdout" | "stderr") => {
      outputBytes += chunk.length;
      if (outputBytes > options.maxOutputBytes) {
        child.kill();
        reject(new Error("fpcalc output exceeded the configured limit."));
        return;
      }
      if (target === "stdout") stdout += chunk.toString("utf8"); else stderr += chunk.toString("utf8");
    };
    child.stdout.on("data", (chunk: Buffer) => append(chunk, "stdout"));
    child.stderr.on("data", (chunk: Buffer) => append(chunk, "stderr"));
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("close", (code) => { clearTimeout(timeout); resolve({ code: code ?? 1, stdout, stderr }); });
  });
}

function isMissingCommand(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
