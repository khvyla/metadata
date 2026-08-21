import type { CanonicalMetadata, MetadataParser } from "../core/types";
import { parseArtistTitle } from "./plain-text";
const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}[^>]*>\\s*([^<]*?)\\s*</${name}>`, "i"))?.[1];

export const xmlParser: MetadataParser = { format: "xml", parse(input): CanonicalMetadata {
  const xml = String(input); const title = tag(xml, "title") ?? ""; const fallback = parseArtistTitle(title);
  return { track: { artist: tag(xml, "artist") ?? fallback.artist, title: fallback.title, album: tag(xml, "album"), genre: tag(xml, "genre"), year: Number(tag(xml, "year")) || undefined }, station: { name: tag(xml, "station") }, source: { format: "xml", raw: input } };
} };
