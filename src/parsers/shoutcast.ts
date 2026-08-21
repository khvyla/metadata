import type { CanonicalMetadata, MetadataParser } from "../core/types";
import { asRecord } from "./json";
import { parseArtistTitle } from "./plain-text";
const text = (value: unknown) => typeof value === "string" ? value : undefined;

export const shoutcastParser: MetadataParser = { format: "shoutcast", parse(input): CanonicalMetadata {
  const value = asRecord(input); const fallback = parseArtistTitle(text(value.songtitle ?? value.currenttrack ?? value.title) ?? "");
  return { track: { artist: text(value.artist) ?? fallback.artist, title: fallback.title, album: text(value.album) }, station: { name: text(value.servername ?? value.station) }, source: { format: "shoutcast", raw: input } };
} };
