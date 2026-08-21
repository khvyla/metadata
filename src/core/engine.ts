import { detectMetadata } from "./detect";
import { normalizeMetadata } from "./normalize";
import type { CanonicalMetadata, MetadataFormat, MetadataParser, ProcessOptions } from "./types";
import { icyParser } from "../parsers/icy";
import { icecastParser } from "../parsers/icecast";
import { jsonParser } from "../parsers/json";
import { plainTextParser } from "../parsers/plain-text";
import { shoutcastParser } from "../parsers/shoutcast";
import { xmlParser } from "../parsers/xml";
import { toIcy } from "../outputs/icy";
import { toJson } from "../outputs/json";
import { toXml } from "../outputs/xml";

const parsers = new Map<MetadataFormat, MetadataParser>([icyParser, icecastParser, shoutcastParser, jsonParser, xmlParser, plainTextParser].map((parser) => [parser.format, parser]));
export function registerParser(parser: MetadataParser) { parsers.set(parser.format, parser); }
export function parseMetadata(input: unknown): CanonicalMetadata { const format = detectMetadata(input).format; return parsers.get(format)!.parse(input); }
export function convertMetadata(metadata: CanonicalMetadata, format: "json" | "xml" | "icy") { return ({ json: toJson, xml: toXml, icy: toIcy }[format])(metadata); }
export function processMetadata(input: unknown, options: ProcessOptions = {}): CanonicalMetadata | string { const metadata = normalizeMetadata(parseMetadata(input)); return options.output ? convertMetadata(metadata, options.output) : metadata; }
