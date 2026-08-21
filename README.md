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

### Live stream reading

Parser-only usage accepts metadata you already have. To read one embedded ICY metadata block from an HTTP(S) stream, use the async reader:

```ts
import { readStreamMetadata } from "@khvyla/metadata";

const metadata = await readStreamMetadata("https://example.com/live");
```

The reader follows a small number of redirects, uses bounded reads, and returns canonical metadata on success. If a station sends no embedded metadata, it returns `{ error: "metadata-unavailable", ... }`. v0.2 reads embedded ICY metadata only; it does not recover or enrich missing track data. The CLI also supports `npm run cli -- --stream "https://example.com/live"`.

### Metadata resolution

Use the resolver when you want khvyla. to try available sources in order: embedded ICY → same-origin native Icecast status → same-origin native Shoutcast status → an explicitly configured sidecar → unresolved.

```ts
import { resolveMetadata } from "@khvyla/metadata";

const embedded = await resolveMetadata("https://example.com/live");
const fallback = await resolveMetadata("https://example.com/live", {
  sidecar: { url: "https://station.example/now-playing" }
});
```

Native discovery is conservative and bounded: it uses only Icecast `/status-json.xsl` and Shoutcast `/stats?sid=1&json=1` on the stream origin, and redirects cannot leave that origin. Successful native results must safely match the stream mount when multiple Icecast sources exist. Audio recognition and metadata recovery are not part of v0.4. Future strategies may include station APIs and audio recognition. Hosted deployments must add network-level private-address protections before accepting arbitrary public URLs.

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
