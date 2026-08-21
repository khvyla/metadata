import * as http from "node:http";
import * as https from "node:https";
import { processMetadata } from "../core/engine";
import type { CanonicalMetadata } from "../core/types";
import { isStreamMetadataError, readStreamMetadata } from "../transport/icy";
import type { StreamMetadataErrorCategory, StreamMetadataOptions } from "../transport/icy";

export type BuiltInResolutionMethod = "embedded-icy" | "configured-sidecar" | "icecast-status" | "shoutcast-status" | "station-api" | "audio-recognition";
export type ResolutionMethod = BuiltInResolutionMethod | (string & {});
export type ResolutionAttempt = { method: ResolutionMethod; outcome: "resolved" | StreamMetadataErrorCategory };
export type SidecarSource = { url: string; timeoutMs?: number; maxRedirects?: number; maxBytes?: number };
export type NativeDiscoveryOptions = { timeoutMs?: number; maxRedirects?: number; maxBytes?: number };
export type ResolveMetadataOptions = { sidecar?: SidecarSource; stream?: StreamMetadataOptions; native?: NativeDiscoveryOptions };
export type ResolvedMetadata = CanonicalMetadata & {
  resolution: { method: ResolutionMethod; confidence: number };
  observation: { observedAt: string };
  station: { streamUrl: string; name?: string };
  attempts: ResolutionAttempt[];
};
export type UnresolvedMetadata = { unresolved: true; observation: { observedAt: string }; station: { streamUrl: string }; attempts: ResolutionAttempt[] };
export type ResolveMetadataResult = ResolvedMetadata | UnresolvedMetadata;

type StrategyResult = { metadata?: CanonicalMetadata; outcome: ResolutionAttempt["outcome"] };
type ResolverContext = { streamUrl: string; options: ResolveMetadataOptions };
interface ResolverStrategy { method: ResolutionMethod; enabled(context: ResolverContext): boolean; resolve(context: ResolverContext): Promise<StrategyResult>; }

const sidecarDefaults = { timeoutMs: 10_000, maxRedirects: 3, maxBytes: 64 * 1024 };
const nativeDefaults = { timeoutMs: 5_000, maxRedirects: 2, maxBytes: 64 * 1024 };
const invalid = (outcome: StreamMetadataErrorCategory): StrategyResult => ({ outcome });
const supportedProtocol = (protocol: string) => protocol === "http:" || protocol === "https:";
const html = (contentType: string | undefined) => /html/i.test(contentType ?? "");

const embeddedIcy: ResolverStrategy = {
  method: "embedded-icy",
  enabled: () => true,
  async resolve({ streamUrl, options }) {
    const result = await readStreamMetadata(streamUrl, options.stream);
    return isStreamMetadataError(result) ? invalid(result.error) : { metadata: result, outcome: "resolved" };
  }
};

const icecastStatus: ResolverStrategy = {
  method: "icecast-status",
  enabled: () => true,
  async resolve({ streamUrl, options }) {
    const data = await fetchNativeJson(new URL("/status-json.xsl", streamUrl), new URL(streamUrl).origin, options.native);
    if (!data.value) return invalid(data.outcome);
    const source = selectIcecastSource(data.value, new URL(streamUrl));
    if (!source) return invalid("metadata-unavailable");
    return validMetadata(processMetadata({ server_name: source.server_name ?? "native-icecast", ...source }) as CanonicalMetadata);
  }
};

const shoutcastStatus: ResolverStrategy = {
  method: "shoutcast-status",
  enabled: () => true,
  async resolve({ streamUrl, options }) {
    const data = await fetchNativeJson(new URL("/stats?sid=1&json=1", streamUrl), new URL(streamUrl).origin, options.native);
    if (!data.value) return invalid(data.outcome);
    const source = selectShoutcastMetadata(data.value);
    if (!source) return invalid("metadata-unavailable");
    return validMetadata(processMetadata({ servername: source.servername ?? "native-shoutcast", ...source }) as CanonicalMetadata);
  }
};

const configuredSidecar: ResolverStrategy = {
  method: "configured-sidecar",
  enabled: ({ options }) => Boolean(options.sidecar),
  async resolve({ options }) { return fetchSidecar(options.sidecar!); }
};

const strategies: ResolverStrategy[] = [embeddedIcy, icecastStatus, shoutcastStatus, configuredSidecar];

export async function resolveMetadata(streamUrl: string, options: ResolveMetadataOptions = {}): Promise<ResolveMetadataResult> {
  const context = { streamUrl, options };
  const observation = { observedAt: new Date().toISOString() };
  const attempts: ResolutionAttempt[] = [];
  try {
    if (!supportedProtocol(new URL(streamUrl).protocol)) return { unresolved: true, observation, station: { streamUrl }, attempts: [{ method: "embedded-icy", outcome: "invalid-stream" }] };
  } catch { return { unresolved: true, observation, station: { streamUrl }, attempts: [{ method: "embedded-icy", outcome: "invalid-stream" }] }; }
  for (const strategy of strategies.filter((candidate) => candidate.enabled(context))) {
    const result = await strategy.resolve(context);
    attempts.push({ method: strategy.method, outcome: result.outcome });
    if (result.metadata) {
      const confidence = strategy.method === "embedded-icy" ? 1 : strategy.method === "configured-sidecar" ? 0.95 : 0.98;
      return { ...result.metadata, resolution: { method: strategy.method, confidence }, observation, station: { streamUrl, ...(result.metadata.station?.name && { name: result.metadata.station.name }) }, attempts };
    }
  }
  return { unresolved: true, observation, station: { streamUrl }, attempts };
}

function fetchSidecar(source: SidecarSource): Promise<StrategyResult> {
  const settings = { ...sidecarDefaults, ...source };
  let url: URL;
  try { url = new URL(source.url); } catch { return Promise.resolve(invalid("invalid-stream")); }
  if (!supportedProtocol(url.protocol)) return Promise.resolve(invalid("invalid-stream"));
  return requestSidecar(url.href, settings, 0);
}

type NativeResult = { value: Record<string, unknown>; outcome: "resolved" } | { value?: undefined; outcome: StreamMetadataErrorCategory };

function fetchNativeJson(url: URL, origin: string, options: NativeDiscoveryOptions = {}): Promise<NativeResult> {
  const settings = { ...nativeDefaults, ...options };
  return requestNativeJson(url.href, origin, settings, 0);
}

function requestNativeJson(url: string, origin: string, settings: Required<NativeDiscoveryOptions>, redirects: number): Promise<NativeResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: NativeResult) => { if (!settled) { settled = true; resolve(result); } };
    const client = url.startsWith("https:") ? https : http;
    const request = client.get(url, { headers: { "Accept": "application/json" } }, (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if (status >= 300 && status < 400) {
        response.destroy();
        if (!location || redirects >= settings.maxRedirects) return finish({ outcome: "metadata-unavailable" });
        let target: URL;
        try { target = new URL(location, url); } catch { return finish({ outcome: "metadata-unavailable" }); }
        if (!supportedProtocol(target.protocol) || target.origin !== origin) return finish({ outcome: "metadata-unavailable" });
        return requestNativeJson(target.href, origin, settings, redirects + 1).then(finish);
      }
      if (status < 200 || status >= 300) { response.destroy(); return finish({ outcome: "metadata-unavailable" }); }
      let bytesRead = 0;
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => {
        if (settled) return;
        const allowed = Math.min(chunk.length, settings.maxBytes - bytesRead);
        if (allowed > 0) { chunks.push(chunk.subarray(0, allowed)); bytesRead += allowed; }
        if (bytesRead >= settings.maxBytes) { response.destroy(); finish({ outcome: "metadata-unavailable" }); }
      });
      response.on("end", () => {
        if (settled) return;
        try {
          const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          finish(value && typeof value === "object" && !Array.isArray(value) ? { value: value as Record<string, unknown>, outcome: "resolved" } : { outcome: "metadata-unavailable" });
        } catch { finish({ outcome: "metadata-unavailable" }); }
      });
      response.on("error", () => finish({ outcome: "unreachable" }));
    });
    request.setTimeout(settings.timeoutMs, () => request.destroy(new Error("timeout")));
    request.on("error", (cause) => finish({ outcome: cause.message === "timeout" ? "timeout" : "unreachable" }));
  });
}

function selectIcecastSource(value: Record<string, unknown>, streamUrl: URL): Record<string, unknown> | undefined {
  const source = (value.icestats as Record<string, unknown> | undefined)?.source;
  const sources = (Array.isArray(source) ? source : source ? [source] : []).filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  if (sources.length === 1) return sources[0];
  const matches = sources.filter((item) => matchesMount(item, streamUrl));
  return matches.length === 1 ? matches[0] : undefined;
}

function matchesMount(source: Record<string, unknown>, streamUrl: URL) {
  if (source.mount === streamUrl.pathname) return true;
  if (typeof source.listenurl !== "string") return false;
  try { const listenUrl = new URL(source.listenurl); return listenUrl.origin === streamUrl.origin && listenUrl.pathname === streamUrl.pathname; } catch { return false; }
}

function selectShoutcastMetadata(value: Record<string, unknown>): Record<string, unknown> | undefined {
  const nowPlaying = value.nowplaying && typeof value.nowplaying === "object" ? value.nowplaying as Record<string, unknown> : value;
  const songtitle = nowPlaying.songtitle ?? nowPlaying.currenttrack ?? nowPlaying.title;
  return typeof songtitle === "string" || typeof nowPlaying.artist === "string" ? nowPlaying : undefined;
}

function validMetadata(metadata: CanonicalMetadata): StrategyResult {
  return metadata.track?.artist?.trim() && metadata.track?.title?.trim() ? { metadata, outcome: "resolved" } : invalid("metadata-unavailable");
}

function requestSidecar(url: string, settings: Required<SidecarSource>, redirects: number): Promise<StrategyResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: StrategyResult) => { if (!settled) { settled = true; resolve(result); } };
    const client = url.startsWith("https:") ? https : http;
    const request = client.get(url, { headers: { "Accept": "application/json, application/xml, text/xml, text/plain" } }, (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if (status >= 300 && status < 400) {
        response.destroy();
        if (!location || redirects >= settings.maxRedirects) return finish(invalid("invalid-stream"));
        let target: URL;
        try { target = new URL(location, url); } catch { return finish(invalid("invalid-stream")); }
        if (!supportedProtocol(target.protocol)) return finish(invalid("invalid-stream"));
        return requestSidecar(target.href, settings, redirects + 1).then(finish);
      }
      if (status < 200 || status >= 300) { response.destroy(); return finish(invalid("http-error")); }
      if (html(response.headers["content-type"])) { response.destroy(); return finish(invalid("metadata-unavailable")); }
      let bytesRead = 0;
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => {
        if (settled) return;
        const allowed = Math.min(chunk.length, settings.maxBytes - bytesRead);
        if (allowed > 0) { chunks.push(chunk.subarray(0, allowed)); bytesRead += allowed; }
        if (bytesRead >= settings.maxBytes) { response.destroy(); finish(invalid("metadata-unavailable")); }
      });
      response.on("end", () => {
        if (settled) return;
        const raw = Buffer.concat(chunks).toString("utf8");
        if (!raw.trim()) return finish(invalid("metadata-unavailable"));
        const metadata = processMetadata(raw) as CanonicalMetadata;
        if (!metadata.track?.artist?.trim() || !metadata.track?.title?.trim()) return finish(invalid("metadata-unavailable"));
        finish({ metadata, outcome: "resolved" });
      });
      response.on("error", () => finish(invalid("unreachable")));
    });
    request.setTimeout(settings.timeoutMs, () => request.destroy(new Error("timeout")));
    request.on("error", (cause) => finish(invalid(cause.message === "timeout" ? "timeout" : "unreachable")));
  });
}
