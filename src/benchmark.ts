import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { resolveMetadata } from "./resolver";
import type { ResolutionAttempt, ResolveMetadataResult } from "./resolver";

export type BenchmarkStream = { streamUrl: string; stationName?: string; country?: string; notes?: string };
export type BenchmarkInput = { streams: BenchmarkStream[] };
export type UnresolvedReason = "stream unreachable" | "HTTP error" | "not audio" | "embedded metadata absent" | "native metadata unavailable" | "timeout" | "ambiguous native mount" | "other/unknown";
export type BenchmarkResult = {
  streamUrl: string;
  stationName?: string;
  country?: string;
  notes?: string;
  reachable: boolean;
  resolution: "resolved" | "unresolved";
  resolutionMethod: "embedded-icy" | "icecast-status" | "shoutcast-status" | "unresolved";
  artist?: string;
  title?: string;
  confidence?: number;
  observedAt?: string;
  sourceFormat?: string;
  attempts: ResolutionAttempt[];
  elapsedMs: number;
  airplayReady: boolean;
  unresolvedReason?: UnresolvedReason;
};
export type BenchmarkSummary = {
  totalStreams: number;
  resolved: number;
  unresolved: number;
  unreachable: number;
  embeddedIcy: number;
  icecastStatus: number;
  shoutcastStatus: number;
  resolutionRate: number;
  medianResolutionTimeMs: number;
};

type Resolver = (streamUrl: string) => Promise<ResolveMetadataResult>;

export async function runBenchmark(input: BenchmarkInput, resolver: Resolver = resolveMetadata): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];
  for (const stream of input.streams) {
    const startedAt = Date.now();
    try { results.push(toBenchmarkResult(stream, await resolver(stream.streamUrl), Date.now() - startedAt)); }
    catch { results.push({ ...stream, reachable: false, resolution: "unresolved", resolutionMethod: "unresolved", attempts: [], elapsedMs: Date.now() - startedAt, airplayReady: false, unresolvedReason: "other/unknown" }); }
  }
  return results;
}

export function summarizeBenchmark(results: BenchmarkResult[]): BenchmarkSummary {
  const resolved = results.filter((result) => result.resolution === "resolved");
  const times = results.map((result) => result.elapsedMs).sort((left, right) => left - right);
  const middle = Math.floor(times.length / 2);
  return {
    totalStreams: results.length,
    resolved: resolved.length,
    unresolved: results.length - resolved.length,
    unreachable: results.filter((result) => !result.reachable).length,
    embeddedIcy: resolved.filter((result) => result.resolutionMethod === "embedded-icy").length,
    icecastStatus: resolved.filter((result) => result.resolutionMethod === "icecast-status").length,
    shoutcastStatus: resolved.filter((result) => result.resolutionMethod === "shoutcast-status").length,
    resolutionRate: results.length ? resolved.length / results.length : 0,
    medianResolutionTimeMs: times.length ? times.length % 2 ? times[middle] : Math.round((times[middle - 1] + times[middle]) / 2) : 0
  };
}

export function renderBenchmarkReport(results: BenchmarkResult[], generatedAt = new Date().toISOString()): string {
  const summary = summarizeBenchmark(results);
  const lines = [
    "# khvyla. metadata field benchmark",
    "",
    `Generated: ${generatedAt}`,
    "",
    "## Summary",
    "",
    "| Metric | Value |",
    "| --- | ---: |",
    `| Total streams | ${summary.totalStreams} |`,
    `| Resolved | ${summary.resolved} |`,
    `| Unresolved | ${summary.unresolved} |`,
    `| Unreachable | ${summary.unreachable} |`,
    `| embedded-icy | ${summary.embeddedIcy} |`,
    `| icecast-status | ${summary.icecastStatus} |`,
    `| shoutcast-status | ${summary.shoutcastStatus} |`,
    `| Resolution rate | ${(summary.resolutionRate * 100).toFixed(1)}% |`,
    `| Median resolution time | ${summary.medianResolutionTimeMs} ms |`,
    "",
    "## Results",
    "",
    "| Stream URL | Result | Method | Artist | Title | Confidence | Elapsed | Airplay-ready |",
    "| --- | --- | --- | --- | --- | ---: | ---: | --- |",
    ...results.map((result) => `| ${escapeCell(result.streamUrl)} | ${result.resolution} | ${result.resolutionMethod} | ${escapeCell(result.artist)} | ${escapeCell(result.title)} | ${result.confidence ?? ""} | ${result.elapsedMs} ms | ${result.airplayReady ? "yes" : "no"} |`),
    "",
    "## Unresolved streams",
    "",
    "| Stream URL | Reason | Attempts |",
    "| --- | --- | --- |",
    ...results.filter((result) => result.resolution === "unresolved").map((result) => `| ${escapeCell(result.streamUrl)} | ${result.unresolvedReason ?? "other/unknown"} | ${escapeCell(result.attempts.map((attempt) => `${attempt.method}: ${attempt.outcome}`).join(", "))} |`)
  ];
  return lines.join("\n") + "\n";
}

function toBenchmarkResult(stream: BenchmarkStream, result: ResolveMetadataResult, elapsedMs: number): BenchmarkResult {
  if ("unresolved" in result) {
    return { ...stream, reachable: !result.attempts.some((attempt) => attempt.outcome === "unreachable"), resolution: "unresolved", resolutionMethod: "unresolved", attempts: result.attempts, elapsedMs, airplayReady: false, unresolvedReason: classifyUnresolved(result.attempts) };
  }
  const airplayReady = Boolean(result.track?.artist?.trim() && result.track?.title?.trim() && result.resolution?.method && result.resolution.confidence !== undefined && result.observation?.observedAt);
  return { ...stream, reachable: true, resolution: "resolved", resolutionMethod: result.resolution.method as BenchmarkResult["resolutionMethod"], artist: result.track?.artist, title: result.track?.title, confidence: result.resolution.confidence, observedAt: result.observation.observedAt, sourceFormat: result.source.format, attempts: result.attempts, elapsedMs, airplayReady };
}

function classifyUnresolved(attempts: ResolutionAttempt[]): UnresolvedReason {
  const outcomes = attempts.map((attempt) => attempt.outcome);
  if (outcomes.includes("unreachable")) return "stream unreachable";
  if (outcomes.includes("http-error")) return "HTTP error";
  if (outcomes.includes("not-audio")) return "not audio";
  if (outcomes.includes("timeout")) return "timeout";
  if (attempts.some((attempt) => (attempt.method === "icecast-status" || attempt.method === "shoutcast-status") && attempt.outcome === "metadata-unavailable")) return "native metadata unavailable";
  if (attempts.some((attempt) => attempt.method === "embedded-icy" && attempt.outcome === "metadata-unavailable")) return "embedded metadata absent";
  return "other/unknown";
}

const escapeCell = (value: string | undefined) => (value ?? "").replace(/\|/g, "\\|");

function readInput(path: string): BenchmarkInput {
  const value = JSON.parse(readFileSync(path, "utf8")) as BenchmarkInput;
  if (!Array.isArray(value.streams)) throw new Error("Benchmark input must contain a streams array.");
  return value;
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name: string, fallback: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] || fallback : fallback; };
  const inputPath = resolve(option("--input", "benchmark/streams.json"));
  const resultsPath = resolve(option("--results", "benchmark/results.json"));
  const reportPath = resolve(option("--report", "benchmark/report.md"));
  const results = await runBenchmark(readInput(inputPath));
  mkdirSync(dirname(resultsPath), { recursive: true });
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(resultsPath, JSON.stringify({ generatedAt: new Date().toISOString(), summary: summarizeBenchmark(results), results }, null, 2) + "\n");
  writeFileSync(reportPath, renderBenchmarkReport(results));
  console.log(`Wrote ${results.length} benchmark results to ${resultsPath}`);
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
