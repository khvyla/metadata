import type { CanonicalMetadata } from "../core/types";
const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[char]!));
const element = (name: string, value: string | number | undefined) => value === undefined ? "" : `<${name}>${escape(String(value))}</${name}>`;
export const toXml = (metadata: CanonicalMetadata) => `<metadata>${metadata.track ? `<track>${element("artist", metadata.track.artist)}${element("title", metadata.track.title)}${element("album", metadata.track.album)}${element("year", metadata.track.year)}${element("genre", metadata.track.genre)}</track>` : ""}${metadata.station ? `<station>${element("name", metadata.station.name)}</station>` : ""}</metadata>`;
