import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { convertMetadata, processMetadata, registerParser } from "../src";

const realWorldIcyFixtures = JSON.parse(readFileSync(resolve("tests/fixtures/real-world-icy.json"), "utf8")) as Array<{ name: string; raw: string; artist: string; title: string }>;

describe("metadata engine", () => {
  it("parses ICY and preserves raw metadata", () => { const result = processMetadata("StreamTitle=' Miles Davis - So What.mp3 '; ") as any; expect(result).toMatchObject({ track: { artist: "Miles Davis", title: "So What" }, source: { format: "icy", raw: "StreamTitle=' Miles Davis - So What.mp3 '; " } }); });
  it.each(realWorldIcyFixtures)("parses live fixture: $name", ({ raw, artist, title }) => {
    expect(processMetadata(raw)).toMatchObject({ track: { artist, title }, source: { format: "icy", raw } });
  });
  it("parses an ICY block with trailing NUL padding and preserves it raw", () => {
    const raw = "StreamTitle='Roy Ayers Ubiquity - Everybody Loves The Sunshine';\0\0\0\0";
    expect(processMetadata(raw)).toMatchObject({ track: { artist: "Roy Ayers Ubiquity", title: "Everybody Loves The Sunshine" }, source: { format: "icy", raw } });
  });
  it.each(["Artist – Title", "Artist — Title"])("accepts unicode separators", (input) => expect(processMetadata(input)).toMatchObject({ track: { artist: "Artist", title: "Title" } }));
  it("leaves unknown plain text as a title", () => expect(processMetadata("Station ident")).toMatchObject({ track: { title: "Station ident" }, source: { format: "plain-text" } }));
  it("maps generic JSON", () => expect(processMetadata('{"artist":"Nina Simone","title":"Sinnerman"}')).toMatchObject({ track: { artist: "Nina Simone", title: "Sinnerman" }, source: { format: "json" } }));
  it("maps simple XML", () => expect(processMetadata("<metadata><artist>Bowie</artist><title>Heroes</title></metadata>")).toMatchObject({ track: { artist: "Bowie", title: "Heroes" }, source: { format: "xml" } }));
  it("maps Icecast payloads", () => expect(processMetadata({ server_name: "Radio", artist: "Kate Bush", title: "Running Up That Hill" })).toMatchObject({ track: { artist: "Kate Bush", title: "Running Up That Hill" }, station: { name: "Radio" }, source: { format: "icecast" } }));
  it("maps Shoutcast payloads", () => expect(processMetadata({ servername: "Radio", songtitle: "Björk - Joga" })).toMatchObject({ track: { artist: "Björk", title: "Joga" }, station: { name: "Radio" }, source: { format: "shoutcast" } }));
  it("converts to canonical JSON and ICY", () => { const metadata = processMetadata("Miles Davis - So What") as any; expect(JSON.parse(convertMetadata(metadata, "json")).track.title).toBe("So What"); expect(convertMetadata(metadata, "icy")).toBe("StreamTitle='Miles Davis - So What';"); });
  it("uses a registered custom adapter end-to-end", () => {
    registerParser({ format: "vendor", detect: (input) => typeof input === "string" && input.startsWith("VENDOR:"), parse: (input) => ({ track: { title: String(input).slice(7) }, source: { format: "vendor", raw: input } }) });
    expect(processMetadata("VENDOR: custom track")).toMatchObject({ track: { title: "custom track" }, source: { format: "vendor" } });
  });
  it("fails gracefully for malformed JSON", () => expect(processMetadata("{broken")).toMatchObject({ track: { title: "{broken" }, source: { format: "plain-text" } }));
});
