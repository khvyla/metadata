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
    const url = await listen((request, response) => { if (request.url === "/stream") stream(response); else { response.writeHead(200, { "content-type": "application/json" }); response.end('{"artist":"Nina Simone","title":"Sinnerman"}'); } });
    const result = await resolveMetadata(`${url}/stream`, { sidecar: { url: `${url}/sidecar` } });
    expect(result).toMatchObject({ track: { artist: "Nina Simone", title: "Sinnerman" }, resolution: { method: "configured-sidecar", confidence: 0.95 }, attempts: [{ method: "embedded-icy", outcome: "metadata-unavailable" }, { method: "configured-sidecar", outcome: "resolved" }] });
    expect("observation" in result && result.observation.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });
  it("falls back to XML and plain-text sidecars", async () => {
    const url = await listen((request, response) => { if (request.url === "/stream") return stream(response); response.writeHead(200, { "content-type": request.url === "/xml" ? "application/xml" : "text/plain" }); response.end(request.url === "/xml" ? "<metadata><artist>Bowie</artist><title>Heroes</title></metadata>" : "Miles Davis - So What"); });
    await expect(resolveMetadata(`${url}/stream`, { sidecar: { url: `${url}/xml` } })).resolves.toMatchObject({ track: { artist: "Bowie", title: "Heroes" }, resolution: { method: "configured-sidecar" } });
    await expect(resolveMetadata(`${url}/stream`, { sidecar: { url: `${url}/text` } })).resolves.toMatchObject({ track: { artist: "Miles Davis", title: "So What" }, resolution: { method: "configured-sidecar" } });
  });
  it("returns unresolved with compact fallback attempts", async () => {
    const url = await listen((request, response) => { if (request.url === "/stream") return stream(response); response.writeHead(503); response.end(); });
    await expect(resolveMetadata(`${url}/stream`, { sidecar: { url: `${url}/sidecar` } })).resolves.toMatchObject({ unresolved: true, attempts: [{ method: "embedded-icy", outcome: "metadata-unavailable" }, { method: "configured-sidecar", outcome: "http-error" }] });
  });
  it("rejects unsupported sidecar protocols", async () => {
    const url = await listen((_, response) => stream(response));
    await expect(resolveMetadata(url, { sidecar: { url: "file:///metadata.json" } })).resolves.toMatchObject({ unresolved: true, attempts: [{ method: "embedded-icy", outcome: "metadata-unavailable" }, { method: "configured-sidecar", outcome: "invalid-stream" }] });
  });
  it("bounds sidecar redirects, timeouts, and response size", async () => {
    const url = await listen((request, response) => { if (request.url === "/stream") return stream(response); if (request.url === "/redirect") { response.writeHead(302, { location: "/again" }); return response.end(); } if (request.url === "/timeout") return; response.writeHead(200, { "content-type": "text/plain" }); response.end("x".repeat(128)); });
    await expect(resolveMetadata(`${url}/stream`, { sidecar: { url: `${url}/redirect`, maxRedirects: 0 } })).resolves.toMatchObject({ unresolved: true, attempts: expect.arrayContaining([{ method: "configured-sidecar", outcome: "invalid-stream" }]) });
    await expect(resolveMetadata(`${url}/stream`, { sidecar: { url: `${url}/timeout`, timeoutMs: 20 } })).resolves.toMatchObject({ unresolved: true, attempts: expect.arrayContaining([{ method: "configured-sidecar", outcome: "timeout" }]) });
    await expect(resolveMetadata(`${url}/stream`, { sidecar: { url: `${url}/large`, maxBytes: 16 } })).resolves.toMatchObject({ unresolved: true, attempts: expect.arrayContaining([{ method: "configured-sidecar", outcome: "metadata-unavailable" }]) });
  });
});
