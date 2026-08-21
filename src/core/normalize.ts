import type { CanonicalMetadata } from "./types";

const clean = (value: string | undefined) => value?.trim().replace(/\s+/g, " ") || undefined;
const cleanTitle = (value: string | undefined) => clean(value)?.replace(/\.(mp3|wav|flac|aac|m4a)$/i, "") || undefined;
const compact = <T extends object>(value: T): T | undefined => {
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
  return entries.length ? Object.fromEntries(entries) as T : undefined;
};

export function normalizeMetadata(metadata: CanonicalMetadata): CanonicalMetadata {
  const track = compact({
    artist: clean(metadata.track?.artist), title: cleanTitle(metadata.track?.title), album: clean(metadata.track?.album),
    year: metadata.track?.year, genre: clean(metadata.track?.genre), duration: metadata.track?.duration, isrc: clean(metadata.track?.isrc)
  });
  const station = compact({ name: clean(metadata.station?.name) });
  const program = compact({ title: clean(metadata.program?.title), host: clean(metadata.program?.host), episode: clean(metadata.program?.episode) });
  const artwork = compact({ url: clean(metadata.artwork?.url) });
  const contentType = clean(metadata.contentType);
  const startedAt = clean(metadata.startedAt);
  const endsAt = clean(metadata.endsAt);
  return {
    source: metadata.source,
    ...(track && { track }), ...(station && { station }), ...(program && { program }), ...(artwork && { artwork }),
    ...(contentType && { contentType }), ...(startedAt && { startedAt }), ...(endsAt && { endsAt })
  };
}
