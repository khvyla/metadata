export type BuiltInMetadataFormat = "icy" | "icecast" | "shoutcast" | "json" | "xml" | "plain-text";
export type MetadataFormat = BuiltInMetadataFormat | (string & {});

export type CanonicalMetadata = {
  track?: { artist?: string; title?: string; album?: string; year?: number; genre?: string; duration?: number; isrc?: string };
  station?: { name?: string };
  program?: { title?: string; host?: string; episode?: string };
  artwork?: { url?: string };
  contentType?: string;
  startedAt?: string;
  endsAt?: string;
  source: { format: MetadataFormat; raw?: unknown };
};

export type Detection = { format: MetadataFormat; confidence: number };
export type ParseOptions = { format?: MetadataFormat };
export type ProcessOptions = ParseOptions & { output?: "json" | "xml" | "icy" };
export interface MetadataParser {
  format: MetadataFormat;
  detect?: (input: unknown) => boolean | number;
  parse(input: unknown): CanonicalMetadata;
}
