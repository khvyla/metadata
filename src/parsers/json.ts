import type { CanonicalMetadata, MetadataParser } from "../core/types";

export const asRecord = (input: unknown): Record<string, unknown> => {
  if (input !== null && typeof input === "object" && !Array.isArray(input)) return input as Record<string, unknown>;
  if (typeof input === "string") try { const value = JSON.parse(input); return value && typeof value === "object" ? value : {}; } catch { return {}; }
  return {};
};
const text = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value) : undefined;
const number = (value: unknown) => typeof value === "number" ? value : typeof value === "string" && !Number.isNaN(Number(value)) ? Number(value) : undefined;

export function mapGeneric(value: Record<string, unknown>, format: CanonicalMetadata["source"]["format"], raw: unknown): CanonicalMetadata {
  const track = (value.track && typeof value.track === "object" ? value.track : value) as Record<string, unknown>;
  return { track: { artist: text(track.artist ?? track.creator), title: text(track.title ?? track.name), album: text(track.album), year: number(track.year), genre: text(track.genre), duration: number(track.duration), isrc: text(track.isrc) }, station: { name: text((value.station as Record<string, unknown> | undefined)?.name ?? value.stationName) }, program: { title: text((value.program as Record<string, unknown> | undefined)?.title), host: text((value.program as Record<string, unknown> | undefined)?.host), episode: text((value.program as Record<string, unknown> | undefined)?.episode) }, artwork: { url: text((value.artwork as Record<string, unknown> | undefined)?.url ?? value.artworkUrl) }, contentType: text(value.contentType), startedAt: text(value.startedAt), endsAt: text(value.endsAt), source: { format, raw } };
}

export const jsonParser: MetadataParser = { format: "json", parse: (input) => mapGeneric(asRecord(input), "json", input) };
