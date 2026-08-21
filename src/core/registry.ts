import type { MetadataFormat, MetadataParser } from "./types";

const parsers = new Map<MetadataFormat, MetadataParser>();
export const registerParser = (parser: MetadataParser) => parsers.set(parser.format, parser);
export const getParser = (format: MetadataFormat) => parsers.get(format);
export const getParsers = () => parsers.values();
