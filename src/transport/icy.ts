import * as http from "node:http";
import * as https from "node:https";
import { processMetadata } from "../core/engine";
import type { CanonicalMetadata } from "../core/types";

export type StreamMetadataErrorCategory = "unreachable" | "http-error" | "not-audio" | "metadata-unavailable" | "timeout" | "invalid-stream";
export type StreamMetadataError = { error: StreamMetadataErrorCategory; message: string; status?: number };
export type StreamTransportHeaders = Partial<Record<"server" | "content-type" | "icy-name" | "icy-description" | "icy-genre" | "icy-url" | "icy-br" | "icy-metaint", string | string[]>>;
export type StreamMetadata = CanonicalMetadata & { transport: { headers: StreamTransportHeaders } };
export type StreamMetadataResult = StreamMetadata | StreamMetadataError;
export type StreamMetadataOptions = { timeoutMs?: number; maxRedirects?: number; maxBytes?: number };

const defaults = { timeoutMs: 10_000, maxRedirects: 3, maxBytes: 128 * 1024 };
const error = (category: StreamMetadataErrorCategory, message: string, status?: number): StreamMetadataError => ({ error: category, message, ...(status && { status }) });
const isAudio = (contentType: string | undefined) => !contentType || /^audio\//i.test(contentType) || /^(application\/ogg|application\/octet-stream)/i.test(contentType);
const usableTitle = (block: string) => block.match(/StreamTitle\s*=\s*'([^']*)'/i)?.[1].trim();
const isSupportedProtocol = (protocol: string) => protocol === "http:" || protocol === "https:";
const captureHeaders = (headers: http.IncomingHttpHeaders): StreamTransportHeaders => {
  const names = ["server", "content-type", "icy-name", "icy-description", "icy-genre", "icy-url", "icy-br", "icy-metaint"] as const;
  return Object.fromEntries(names.filter((name) => headers[name] !== undefined).map((name) => [name, headers[name]!])) as StreamTransportHeaders;
};

export function isStreamMetadataError(result: StreamMetadataResult): result is StreamMetadataError {
  return "error" in result;
}

export async function readStreamMetadata(url: string, options: StreamMetadataOptions = {}): Promise<StreamMetadataResult> {
  const settings = { ...defaults, ...options };
  let streamUrl: URL;
  try { streamUrl = new URL(url); } catch { return error("invalid-stream", "The stream URL is invalid."); }
  if (!isSupportedProtocol(streamUrl.protocol)) return error("invalid-stream", "Only HTTP(S) stream URLs are supported.");
  return read(streamUrl.href, settings, 0);
}

function read(url: string, settings: Required<StreamMetadataOptions>, redirects: number): Promise<StreamMetadataResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: StreamMetadataResult) => { if (!settled) { settled = true; resolve(result); } };
    const client = url.startsWith("https:") ? https : http;
    const request = client.get(url, { headers: { "Icy-MetaData": "1", "Accept-Encoding": "identity", "User-Agent": "khvyla-metadata/0.2" } }, (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if (status >= 300 && status < 400) {
        response.destroy();
        if (!location || redirects >= settings.maxRedirects) return finish(error("invalid-stream", "Redirect limit reached.", status));
        let target: URL;
        try { target = new URL(location, url); } catch { return finish(error("invalid-stream", "Redirect target is invalid.", status)); }
        if (!isSupportedProtocol(target.protocol)) return finish(error("invalid-stream", "Redirect target must use HTTP(S).", status));
        return read(target.href, settings, redirects + 1).then(finish);
      }
      if (status < 200 || status >= 300) { response.destroy(); return finish(error("http-error", `Stream returned HTTP ${status}.`, status)); }
      const contentType = response.headers["content-type"];
      if (!isAudio(contentType)) { response.destroy(); return finish(error("not-audio", "Stream response is not audio.", status)); }
      const metaint = Number(response.headers["icy-metaint"]);
      if (!Number.isInteger(metaint) || metaint <= 0) { response.destroy(); return finish(error("metadata-unavailable", "Stream did not provide icy-metaint.", status)); }
      const headers = captureHeaders(response.headers);

      let pending = Buffer.alloc(0);
      let audioRemaining = metaint;
      let metadataLength: number | undefined;
      let bytesRead = 0;
      const stop = (result: StreamMetadataResult) => { response.destroy(); finish(result); };
      response.on("data", (chunk: Buffer) => {
        if (settled) return;
        const allowed = Math.min(chunk.length, settings.maxBytes - bytesRead);
        if (allowed > 0) { pending = Buffer.concat([pending, chunk.subarray(0, allowed)]); bytesRead += allowed; }
        while (!settled) {
          if (metadataLength !== undefined) {
            if (pending.length < metadataLength) break;
            const block = pending.subarray(0, metadataLength);
            pending = pending.subarray(metadataLength);
            metadataLength = undefined;
            audioRemaining = metaint;
            const raw = block.toString("utf8");
            if (usableTitle(raw)) return stop({ ...(processMetadata(raw) as CanonicalMetadata), transport: { headers } });
            continue;
          }
          if (audioRemaining > 0) {
            const consumed = Math.min(audioRemaining, pending.length);
            pending = pending.subarray(consumed);
            audioRemaining -= consumed;
            if (audioRemaining > 0) break;
          }
          if (!pending.length) break;
          metadataLength = pending[0] * 16;
          pending = pending.subarray(1);
          if (metadataLength === 0) { metadataLength = undefined; audioRemaining = metaint; }
        }
        if (bytesRead >= settings.maxBytes) stop(error("metadata-unavailable", "No usable ICY metadata was found within the read limit.", status));
      });
      response.on("end", () => finish(error("metadata-unavailable", "Stream ended before usable ICY metadata was received.", status)));
      response.on("error", (cause) => finish(error("unreachable", cause.message, status)));
    });
    request.setTimeout(settings.timeoutMs, () => request.destroy(new Error("timeout")));
    request.on("error", (cause) => finish(error(cause.message === "timeout" ? "timeout" : "unreachable", cause.message)));
  });
}
