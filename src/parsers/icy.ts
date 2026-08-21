import type { CanonicalMetadata, MetadataParser } from "../core/types";
import { parseArtistTitle } from "./plain-text";

export const icyParser: MetadataParser = {
  format: "icy",
  parse(input): CanonicalMetadata {
    const raw = String(input); const title = raw.match(/StreamTitle\s*=\s*'([^']*)'/i)?.[1] ?? "";
    return { track: parseArtistTitle(title), source: { format: "icy", raw: input } };
  }
};
