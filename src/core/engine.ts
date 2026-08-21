import { detectMetadata } from "./detect";
import { normalizeMetadata } from "./normalize";
import type { CanonicalMetadata, MetadataFormat, MetadataParser, ParseOptions, ProcessOptions } from "./types";
import { getParser, registerParser } from "./registry";
import { icyParser } from "../parsers/icy";
import { icecastParser } from "../parsers/icecast";
import { jsonParser } from "../parsers/json";
import { plainTextParser } from "../parsers/plain-text";
import { shoutcastParser } from "../parsers/shoutcast";
import { xmlParser } from "../parsers/xml";
import { toIcy } from "../outputs/icy";
import { toJson } from "../outputs/json";
import { toXml } from "../outputs/xml";

for (const parser of [icyParser, icecastParser, shoutcastParser, jsonParser, xmlParser, plainTextParser]) registerParser(parser);
export { registerParser } from "./registry";
export function parseMetadata(input: unknown, options: ParseOptions = {}): CanonicalMetadata {
  const format = options.format ?? detectMetadata(input).format;
  const parser = getParser(format);
  if (!parser) throw new Error(`No parser registered for format: ${format}`);
  return parser.parse(input);
}
export function convertMetadata(metadata: CanonicalMetadata, format: "json" | "xml" | "icy") { return ({ json: toJson, xml: toXml, icy: toIcy }[format])(metadata); }
export function processMetadata(input: unknown, options: ProcessOptions = {}): CanonicalMetadata | string { const metadata = normalizeMetadata(parseMetadata(input, options)); return options.output ? convertMetadata(metadata, options.output) : metadata; }
