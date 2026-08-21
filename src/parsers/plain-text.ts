import type { CanonicalMetadata, MetadataParser } from "../core/types";

export function parseArtistTitle(value: string) {
  const match = value.trim().match(/^(.+?)\s+[-–—]\s+(.+)$/);
  return match ? { artist: match[1], title: match[2] } : { title: value };
}

export const plainTextParser: MetadataParser = {
  format: "plain-text",
  parse(input): CanonicalMetadata { return { track: parseArtistTitle(String(input)), source: { format: "plain-text", raw: input } }; }
};
