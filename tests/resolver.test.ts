import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { resolveMetadata } from "../src";

const audio = Buffer.from("abcd");
const icy = (metadata: string) => { const data = Buffer.from(metadata); const size = Math.ceil(data.length / 16) * 16; return Buffer.concat([audio, Buffer.from([size / 16]), data, Buffer.alloc(size - data.length)]); };
let server: Server | undefined;
const listen = (handler: Parameters<typeof createServer>[0]) => new Promise<string>((resolve) => { server = createServer(handler).listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server!.address() as { port: number }).port}`)); });
afterEach(async () => { server?.closeAllConnections(); await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve()); server = undefined; });
const stream = (response: import("node:http").ServerResponse, metadata?: string) => { response.writeHead(200, metadata ? { "content-type": "audio/mpeg", "icy-metaint": "4" } : { "content-type": "audio/mpeg" }); response.end(metadata ? icy(metadata) : audio); };

describe("metadata resolver", () => {
  it("does not attempt sources for an unsupported stream protocol", async () => {
    await expect(resolveMetadata("ftp://example.com/live", { sidecar: { url: "https://station.example/now-playing" } })).resolves.toMatchObject({ unresolved: true, attempts: [{ method: "embedded-icy", outcome: "invalid-stream" }] });
  });
  it("uses embedded ICY without requesting a sidecar", async () => {
    let sidecarRequested = false;
    const url = await listen((request, response) => { if (request.url === "/stream") stream(response, "StreamTitle='Stan Getz - Misty';"); else { sidecarRequested = true; response.end('{"artist":"Wrong"}'); } });
    const result = await resolveMetadata(`${url}/stream`, { sidecar: { url: `${url}/sidecar` } });
    expect(result).toMatchObject({ track: { artist: "Stan Getz", title: "Misty" }, resolution: { method: "embedded-icy", confidence: 1 }, attempts: [{ method: "embedded-icy", outcome: "resolved" }] }); expect(sidecarRequested).toBe(false);
  });
  it("falls back to a JSON sidecar with provenance and observation", async () => {
    const url = await listen((request, response) => { if (request.url === "/stream") return stream(response); if (request.url === "/sidecar") { response.writeHead(200, { "content-type": "application/json" }); return response.end('{"artist":"Nina Simone","title":"Sinnerman"}'); } response.writeHead(404); response.end(); });
    const result = await resolveMetadata(`${url}/stream`, { sidecar: { url: `${url}/sidecar` } });
    expect(result).toMatchObject({ track: { artist: "Nina Simone", title: "Sinnerman" }, resolution: { method: "configured-sidecar", confidence: 0.95 }, attempts: [{ method: "embedded-icy", outcome: "metadata-unavailable" }, { method: "icecast-status", outcome: "metadata-unavailable" }, { method: "shoutcast-status", outcome: "metadata-unavailable" }, { method: "configured-sidecar", outcome: "resolved" }] });
    expect("observation" in result && result.observation.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });
  it("falls back to XML and plain-text sidecars", async () => {
    const url = await listen((request, response) => { if (request.url === "/stream") return stream(response); response.writeHead(200, { "content-type": request.url === "/xml" ? "application/xml" : "text/plain" }); response.end(request.url === "/xml" ? "<metadata><artist>Bowie</artist><title>Heroes</title></metadata>" : "Miles Davis - So What"); });
    await expect(resolveMetadata(`${url}/stream`, { sidecar: { url: `${url}/xml` } })).resolves.toMatchObject({ track: { artist: "Bowie", title: "Heroes" }, resolution: { method: "configured-sidecar" } });
    await expect(resolveMetadata(`${url}/stream`, { sidecar: { url: `${url}/text` } })).resolves.toMatchObject({ track: { artist: "Miles Davis", title: "So What" }, resolution: { method: "configured-sidecar" } });
  });
  it.each([
    ["HTML", "/html", "text/html", "<html>offline</html>"],
    ["offline JSON", "/offline", "application/json", '{"status":"offline"}'],
    ["empty JSON", "/empty", "application/json", "{}"]
  ])("treats %s sidecars as metadata unavailable", async (_, path, contentType, body) => {
    const url = await listen((request, response) => { if (request.url === "/stream") return stream(response); response.writeHead(200, { "content-type": contentType }); response.end(body); });
    await expect(resolveMetadata(`${url}/stream`, { sidecar: { url: `${url}${path}` } })).resolves.toMatchObject({ unresolved: true, attempts: [{ method: "embedded-icy", outcome: "metadata-unavailable" }, { method: "icecast-status", outcome: "metadata-unavailable" }, { method: "shoutcast-status", outcome: "metadata-unavailable" }, { method: "configured-sidecar", outcome: "metadata-unavailable" }] });
  });
  it("returns unresolved with compact fallback attempts", async () => {
    const url = await listen((request, response) => { if (request.url === "/stream") return stream(response); response.writeHead(503); response.end(); });
    await expect(resolveMetadata(`${url}/stream`, { sidecar: { url: `${url}/sidecar` } })).resolves.toMatchObject({ unresolved: true, attempts: [{ method: "embedded-icy", outcome: "metadata-unavailable" }, { method: "icecast-status", outcome: "metadata-unavailable" }, { method: "shoutcast-status", outcome: "metadata-unavailable" }, { method: "configured-sidecar", outcome: "http-error" }] });
  });
  it("rejects unsupported sidecar protocols", async () => {
    const url = await listen((_, response) => stream(response));
    await expect(resolveMetadata(url, { sidecar: { url: "file:///metadata.json" } })).resolves.toMatchObject({ unresolved: true, attempts: [{ method: "embedded-icy", outcome: "metadata-unavailable" }, { method: "icecast-status", outcome: "metadata-unavailable" }, { method: "shoutcast-status", outcome: "metadata-unavailable" }, { method: "configured-sidecar", outcome: "invalid-stream" }] });
  });
  it("bounds sidecar redirects, timeouts, and response size", async () => {
    const url = await listen((request, response) => { if (request.url === "/stream") return stream(response); if (request.url === "/redirect") { response.writeHead(302, { location: "/again" }); return response.end(); } if (request.url === "/timeout") return; response.writeHead(200, { "content-type": "text/plain" }); response.end("x".repeat(128)); });
    await expect(resolveMetadata(`${url}/stream`, { sidecar: { url: `${url}/redirect`, maxRedirects: 0 } })).resolves.toMatchObject({ unresolved: true, attempts: expect.arrayContaining([{ method: "configured-sidecar", outcome: "invalid-stream" }]) });
    await expect(resolveMetadata(`${url}/stream`, { sidecar: { url: `${url}/timeout`, timeoutMs: 20 } })).resolves.toMatchObject({ unresolved: true, attempts: expect.arrayContaining([{ method: "configured-sidecar", outcome: "timeout" }]) });
    await expect(resolveMetadata(`${url}/stream`, { sidecar: { url: `${url}/large`, maxBytes: 16 } })).resolves.toMatchObject({ unresolved: true, attempts: expect.arrayContaining([{ method: "configured-sidecar", outcome: "metadata-unavailable" }]) });
  });
  it("uses a single-source Icecast status response", async () => {
    const url = await listen((request, response) => { if (request.url === "/stream") return stream(response); if (request.url === "/status-json.xsl") { response.writeHead(200, { "content-type": "application/json" }); return response.end('{"icestats":{"source":{"mount":"/stream","artist":"Bill Evans","title":"Waltz for Debby"}}}'); } response.writeHead(404); response.end(); });
    await expect(resolveMetadata(`${url}/stream`)).resolves.toMatchObject({ track: { artist: "Bill Evans", title: "Waltz for Debby" }, resolution: { method: "icecast-status", confidence: 0.98 }, attempts: [{ method: "embedded-icy", outcome: "metadata-unavailable" }, { method: "icecast-status", outcome: "resolved" }] });
  });
  it("accepts a single Icecast source with a matching mount", async () => {
    const url = await listen((request, response) => { if (request.url === "/stream") return stream(response); if (request.url === "/status-json.xsl") { response.writeHead(200, { "content-type": "application/json" }); return response.end('{"icestats":{"source":{"mount":"/stream","artist":"Bill Evans","title":"Waltz for Debby"}}}'); } response.writeHead(404); response.end(); });
    await expect(resolveMetadata(`${url}/stream`)).resolves.toMatchObject({ resolution: { method: "icecast-status" }, track: { artist: "Bill Evans", title: "Waltz for Debby" } });
  });
  it("rejects a single Icecast source with a different mount", async () => {
    const url = await listen((request, response) => { if (request.url === "/stream") return stream(response); if (request.url === "/status-json.xsl") { response.writeHead(200, { "content-type": "application/json" }); return response.end('{"icestats":{"source":{"mount":"/other","artist":"Wrong","title":"Track"}}}'); } response.writeHead(404); response.end(); });
    await expect(resolveMetadata(`${url}/stream`)).resolves.toMatchObject({ unresolved: true, attempts: [{ method: "embedded-icy", outcome: "metadata-unavailable" }, { method: "icecast-status", outcome: "metadata-unavailable" }, { method: "shoutcast-status", outcome: "metadata-unavailable" }] });
  });
  it.each([
    ["matching", "http://127.0.0.1:0/stream", true],
    ["different", "http://127.0.0.1:0/other", false]
  ])("handles a single source with a %s listenurl", async (_, listenurl, resolves) => {
    const url = await listen((request, response) => { if (request.url === "/stream") return stream(response); if (request.url === "/status-json.xsl") { const source = { listenurl: listenurl.replace("http://127.0.0.1:0", url), artist: "Bill Evans", title: "Waltz for Debby" }; response.writeHead(200, { "content-type": "application/json" }); return response.end(JSON.stringify({ icestats: { source } })); } response.writeHead(404); response.end(); });
    const result = await resolveMetadata(`${url}/stream`);
    expect(result).toMatchObject(resolves ? { resolution: { method: "icecast-status" }, track: { artist: "Bill Evans", title: "Waltz for Debby" } } : { unresolved: true, attempts: [{ method: "embedded-icy", outcome: "metadata-unavailable" }, { method: "icecast-status", outcome: "metadata-unavailable" }, { method: "shoutcast-status", outcome: "metadata-unavailable" }] });
  });
  it("accepts a single Icecast source without mount identity conservatively", async () => {
    const url = await listen((request, response) => { if (request.url === "/stream") return stream(response); if (request.url === "/status-json.xsl") { response.writeHead(200, { "content-type": "application/json" }); return response.end('{"icestats":{"source":{"artist":"Bill Evans","title":"Waltz for Debby"}}}'); } response.writeHead(404); response.end(); });
    await expect(resolveMetadata(`${url}/stream`)).resolves.toMatchObject({ resolution: { method: "icecast-status" }, track: { artist: "Bill Evans", title: "Waltz for Debby" } });
  });
  it("selects the matching mount from a multi-source Icecast response", async () => {
    const url = await listen((request, response) => { if (request.url === "/stream") return stream(response); if (request.url === "/status-json.xsl") { response.writeHead(200, { "content-type": "application/json" }); return response.end('{"icestats":{"source":[{"mount":"/other","artist":"Wrong","title":"Track"},{"mount":"/stream","artist":"Miles Davis","title":"So What"}]}}'); } response.writeHead(404); response.end(); });
    await expect(resolveMetadata(`${url}/stream`)).resolves.toMatchObject({ track: { artist: "Miles Davis", title: "So What" }, resolution: { method: "icecast-status" } });
  });
  it.each([
    ["multiple unrelated mounts", '{"icestats":{"source":[{"mount":"/one","artist":"A","title":"One"},{"mount":"/two","artist":"B","title":"Two"}]}}'],
    ["malformed JSON", "{broken"],
    ["missing track identity", '{"icestats":{"source":{"mount":"/stream","title":"Only title"}}}']
  ])("continues after Icecast %s", async (_, body) => {
    const url = await listen((request, response) => { if (request.url === "/stream") return stream(response); if (request.url === "/status-json.xsl") { response.writeHead(200, { "content-type": "application/json" }); return response.end(body); } response.writeHead(404); response.end(); });
    await expect(resolveMetadata(`${url}/stream`)).resolves.toMatchObject({ unresolved: true, attempts: [{ method: "embedded-icy", outcome: "metadata-unavailable" }, { method: "icecast-status", outcome: "metadata-unavailable" }, { method: "shoutcast-status", outcome: "metadata-unavailable" }] });
  });
  it("uses Shoutcast JSON after Icecast is unavailable", async () => {
    const url = await listen((request, response) => { if (request.url === "/stream") return stream(response); if (request.url?.startsWith("/stats")) { response.writeHead(200, { "content-type": "application/json" }); return response.end('{"songtitle":"Stan Getz - Misty"}'); } response.writeHead(404); response.end(); });
    await expect(resolveMetadata(`${url}/stream`)).resolves.toMatchObject({ track: { artist: "Stan Getz", title: "Misty" }, resolution: { method: "shoutcast-status", confidence: 0.98 }, attempts: [{ method: "embedded-icy", outcome: "metadata-unavailable" }, { method: "icecast-status", outcome: "metadata-unavailable" }, { method: "shoutcast-status", outcome: "resolved" }] });
  });
  it.each(["{broken", '{"status":"offline"}'])("treats unusable Shoutcast JSON as unavailable", async (body) => {
    const url = await listen((request, response) => { if (request.url === "/stream") return stream(response); if (request.url?.startsWith("/stats")) { response.writeHead(200, { "content-type": "application/json" }); return response.end(body); } response.writeHead(404); response.end(); });
    await expect(resolveMetadata(`${url}/stream`)).resolves.toMatchObject({ unresolved: true, attempts: [{ method: "embedded-icy", outcome: "metadata-unavailable" }, { method: "icecast-status", outcome: "metadata-unavailable" }, { method: "shoutcast-status", outcome: "metadata-unavailable" }] });
  });
  it("rejects cross-origin redirects and bounds native requests", async () => {
    const url = await listen((request, response) => { if (request.url === "/stream") return stream(response); if (request.url === "/status-json.xsl") { response.writeHead(302, { location: "http://127.0.0.1:1/status-json.xsl" }); return response.end(); } if (request.url?.startsWith("/stats")) return; response.writeHead(404); response.end(); });
    await expect(resolveMetadata(`${url}/stream`, { native: { timeoutMs: 20 } })).resolves.toMatchObject({ unresolved: true, attempts: expect.arrayContaining([{ method: "icecast-status", outcome: "metadata-unavailable" }, { method: "shoutcast-status", outcome: "timeout" }]) });
  });
  it("bounds native response size before falling back to a sidecar", async () => {
    const url = await listen((request, response) => { if (request.url === "/stream") return stream(response); if (request.url === "/status-json.xsl") { response.writeHead(200, { "content-type": "application/json" }); return response.end("x".repeat(128)); } if (request.url?.startsWith("/stats")) { response.writeHead(404); return response.end(); } response.writeHead(200, { "content-type": "application/json" }); response.end('{"artist":"Nina Simone","title":"Sinnerman"}'); });
    await expect(resolveMetadata(`${url}/stream`, { native: { maxBytes: 16 }, sidecar: { url: `${url}/sidecar` } })).resolves.toMatchObject({ track: { artist: "Nina Simone", title: "Sinnerman" }, resolution: { method: "configured-sidecar" }, attempts: expect.arrayContaining([{ method: "icecast-status", outcome: "metadata-unavailable" }, { method: "configured-sidecar", outcome: "resolved" }]) });
  });
});
