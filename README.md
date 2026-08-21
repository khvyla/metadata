# khvyla. metadata

`@khvyla/metadata` is a small, adapter-based engine for bringing common radio and audio metadata into one canonical shape. Its v0.1 flow is: detect → parse → normalize → convert.

## Supported in v0.1

Inputs: ICY `StreamTitle`, Icecast objects, Shoutcast objects, `Artist - Title` plain text, generic JSON, and simple XML. Outputs: canonical JSON, simple XML, and ICY `StreamTitle`.

## Install and use

```bash
npm install @khvyla/metadata
```

```ts
import { processMetadata } from "@khvyla/metadata";

const metadata = processMetadata("StreamTitle='Miles Davis - So What';");
// { track: { artist: "Miles Davis", title: "So What" }, source: { format: "icy", raw: ... } }
```

Public API: `detectMetadata`, `parseMetadata`, `normalizeMetadata`, `convertMetadata`, `processMetadata`, and `registerParser`. `processMetadata(input, { output: "icy" })` converts directly.

Run the small CLI with `npm run cli -- "Miles Davis - So What"`, or pipe input to it.

## Architecture

The core selects a format adapter, then normalizes its canonical result. Adding a format means registering one parser; existing core and output code need not change.

## Current limitations

v0.1 does not poll streams, call external services, enrich artwork, persist data, or expose a server. XML parsing intentionally handles only simple flat metadata tags.

## Live-stream transport notes

Live validation found transport concerns outside this parser-only v0.1.1 scope: HTTP redirects can lead to tokenized stream URLs; some HTTP clients decode Cyrillic or other non-ASCII ICY headers incorrectly; a URL can return HTML/404 instead of audio; a host can refuse its TCP connection; and ICY blocks can include trailing NUL padding. These conditions belong to a future stream client or transport layer, not the metadata parsers.

## Roadmap

Add richer format adapters, stronger XML support, streaming integration, and optional enrichment only after the core format contract has proved stable.
Open-source audio metadata engine by khvyla. Detect, parse, normalize, and convert metadata from any source.
