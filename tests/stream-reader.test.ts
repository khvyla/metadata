import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { isStreamMetadataError, readStreamMetadata } from "../src";

const audio = Buffer.from("abcd");
const icyBlock = (metadata: string) => {
  const data = Buffer.from(metadata, "utf8");
  const size = Math.ceil(data.length / 16) * 16;
  return Buffer.concat([audio, Buffer.from([size / 16]), data, Buffer.alloc(size - data.length)]);
};
let server: Server | undefined;
const listen = (handler: Parameters<typeof createServer>[0]) => new Promise<string>((resolve) => {
  server = createServer(handler).listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server!.address() as { port: number }).port}`));
});
afterEach(async () => { server?.closeAllConnections(); await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve()); server = undefined; });
const stream = (response: import("node:http").ServerResponse, chunks: Buffer[]) => { response.writeHead(200, { "content-type": "audio/mpeg", "icy-metaint": "4" }); response.end(Buffer.concat(chunks)); };

describe("live ICY stream reader", () => {
  it("rejects an unsupported initial URL protocol", async () => {
    const result = await readStreamMetadata("ftp://example.com/live"); expect(isStreamMetadataError(result) && result.error).toBe("invalid-stream");
  });
  it("requests and parses a direct ICY stream through the existing engine", async () => {
    const url = await listen((request, response) => { expect(request.headers["icy-metadata"]).toBe("1"); expect(request.headers["user-agent"]).toBe("khvyla-metadata/0.2"); stream(response, [icyBlock("StreamTitle='Stan Getz - Misty';")]); });
    await expect(readStreamMetadata(url)).resolves.toMatchObject({ track: { artist: "Stan Getz", title: "Misty" }, source: { format: "icy", raw: "StreamTitle='Stan Getz - Misty';" }, transport: { headers: { "icy-metaint": "4", "content-type": "audio/mpeg" } } });
  });
  it("follows a bounded HTTP redirect", async () => {
    const url = await listen((request, response) => { if (request.url === "/start") { response.writeHead(302, { location: "/live" }); response.end(); } else stream(response, [icyBlock("StreamTitle='Anden - Youth';")]); });
    await expect(readStreamMetadata(`${url}/start`)).resolves.toMatchObject({ track: { artist: "Anden", title: "Youth" } });
  });
  it("retains NUL-padded raw ICY metadata", async () => {
    const url = await listen((_, response) => stream(response, [icyBlock("StreamTitle='Roy Ayers - Sunshine';")]));
    const result = await readStreamMetadata(url);
    expect(result).toMatchObject({ track: { artist: "Roy Ayers", title: "Sunshine" }, source: { raw: expect.stringContaining("\0") } });
  });
  it("skips an empty metadata block before a valid block", async () => {
    const url = await listen((_, response) => stream(response, [audio, Buffer.from([0]), icyBlock("StreamTitle='Stan Getz - Misty';")]));
    await expect(readStreamMetadata(url)).resolves.toMatchObject({ track: { title: "Misty" } });
  });
  it("rejects HTML responses", async () => {
    const url = await listen((_, response) => { response.writeHead(200, { "content-type": "text/html" }); response.end("<html>"); });
    const result = await readStreamMetadata(url); expect(isStreamMetadataError(result) && result.error).toBe("not-audio");
  });
  it("reports streams without ICY metadata", async () => {
    const url = await listen((_, response) => { response.writeHead(200, { "content-type": "audio/mpeg" }); response.end(audio); });
    const result = await readStreamMetadata(url); expect(isStreamMetadataError(result) && result.error).toBe("metadata-unavailable");
  });
  it("stops at the configured read limit", async () => {
    const url = await listen((_, response) => { response.writeHead(200, { "content-type": "audio/mpeg", "icy-metaint": "100" }); response.end(Buffer.alloc(100)); });
    const result = await readStreamMetadata(url, { maxBytes: 16 }); expect(isStreamMetadataError(result) && result.error).toBe("metadata-unavailable");
  });
  it("returns a timeout error", async () => {
    const url = await listen(() => undefined);
    const result = await readStreamMetadata(url, { timeoutMs: 20 }); expect(isStreamMetadataError(result) && result.error).toBe("timeout");
  });
  it("stops at the configured redirect limit", async () => {
    const url = await listen((_, response) => { response.writeHead(302, { location: "/again" }); response.end(); });
    const result = await readStreamMetadata(url, { maxRedirects: 0 }); expect(isStreamMetadataError(result) && result.error).toBe("invalid-stream");
  });
  it("rejects redirects to unsupported protocols", async () => {
    const url = await listen((_, response) => { response.writeHead(302, { location: "ftp://example.com/live" }); response.end(); });
    const result = await readStreamMetadata(url); expect(isStreamMetadataError(result) && result.error).toBe("invalid-stream");
  });
});
