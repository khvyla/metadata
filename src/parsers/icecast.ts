import type { CanonicalMetadata, MetadataParser } from "../core/types";
import { asRecord } from "./json";
import { parseArtistTitle } from "./plain-text";
const text = (value: unknown) => typeof value === "string" ? value : undefined;

export const icecastParser: MetadataParser = { format: "icecast", parse(input): CanonicalMetadata {
  const value = asRecord(input); const source = (value.icestats as Record<string, unknown> | undefined)?.source ?? value;
  const data = Array.isArray(source) ? source[0] as Record<string, unknown> : source as Record<string, unknown>;
  const fallback = parseArtistTitle(text(data.title) ?? "");
  return { track: { artist: text(data.artist) ?? fallback.artist, title: fallback.title, genre: text(data.genre) }, station: { name: text(data.server_name) }, source: { format: "icecast", raw: input } };
} };
