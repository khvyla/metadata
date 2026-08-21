export { detectMetadata } from "./core/detect";
export { normalizeMetadata } from "./core/normalize";
export { convertMetadata, parseMetadata, processMetadata, registerParser } from "./core/engine";
export { isStreamMetadataError, readStreamMetadata } from "./transport/icy";
export { resolveMetadata } from "./resolver";
export type { BuiltInMetadataFormat, CanonicalMetadata, Detection, MetadataFormat, MetadataParser, ParseOptions, ProcessOptions } from "./core/types";
export type { StreamMetadata, StreamMetadataError, StreamMetadataErrorCategory, StreamMetadataOptions, StreamMetadataResult, StreamTransportHeaders } from "./transport/icy";
export type { BuiltInResolutionMethod, ResolutionAttempt, ResolutionMethod, ResolveMetadataOptions, ResolveMetadataResult, ResolvedMetadata, SidecarSource, UnresolvedMetadata } from "./resolver";
