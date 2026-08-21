import { getParsers } from "./registry";
import type { BuiltInMetadataFormat, Detection } from "./types";

const objectValue = (input: unknown): Record<string, unknown> | undefined =>
  input !== null && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : undefined;

const jsonValue = (input: unknown): Record<string, unknown> | undefined => {
  if (typeof input !== "string") return objectValue(input);
  try { return objectValue(JSON.parse(input)); } catch { return undefined; }
};

export function detectMetadata(input: unknown): Detection {
  if (typeof input === "string" && /StreamTitle\s*=\s*'/i.test(input)) return { format: "icy", confidence: 1 };
  for (const parser of getParsers()) {
    const result = parser.detect?.(input);
    if (result) return { format: parser.format, confidence: typeof result === "number" ? result : 0.8 };
  }
  const value = jsonValue(input);
  if (value) {
    const keys = Object.keys(value).map((key) => key.toLowerCase());
    if (keys.some((key) => ["songtitle", "currenttrack", "servername"].includes(key))) return { format: "shoutcast", confidence: 0.95 };
    if (keys.some((key) => ["server_name", "server_description", "icestats"].includes(key))) return { format: "icecast", confidence: 0.95 };
    return { format: "json", confidence: 0.9 };
  }
  if (typeof input === "string" && /^\s*</.test(input)) return { format: "xml", confidence: 0.8 };
  return { format: "plain-text", confidence: 0.5 };
}

export const isMetadataFormat = (format: string): format is BuiltInMetadataFormat =>
  ["icy", "icecast", "shoutcast", "json", "xml", "plain-text"].includes(format);
