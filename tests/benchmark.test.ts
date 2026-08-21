import { describe, expect, it } from "vitest";
import { renderBenchmarkReport, runBenchmark, summarizeBenchmark } from "../src/benchmark";

describe("field benchmark harness", () => {
  it("records resolver output and aggregates a compact report", async () => {
    const results = await runBenchmark({ streams: [{ streamUrl: "https://radio.example/live" }, { streamUrl: "https://offline.example/live" }] }, async (url) => url.includes("offline") ? {
      unresolved: true, observation: { observedAt: "2026-08-21T00:00:00.000Z" }, station: { streamUrl: url }, attempts: [{ method: "embedded-icy", outcome: "unreachable" }]
    } : {
      track: { artist: "Stan Getz", title: "Misty" }, source: { format: "icy", raw: "StreamTitle='Stan Getz - Misty';" }, resolution: { method: "embedded-icy", confidence: 1 }, observation: { observedAt: "2026-08-21T00:00:00.000Z" }, station: { streamUrl: url }, attempts: [{ method: "embedded-icy", outcome: "resolved" }]
    });
    expect(summarizeBenchmark(results)).toMatchObject({ totalStreams: 2, resolved: 1, unresolved: 1, unreachable: 1, embeddedIcy: 1, resolutionRate: 0.5 });
    expect(results[0]).toMatchObject({ resolutionMethod: "embedded-icy", airplayReady: true });
    expect(results[1]).toMatchObject({ unresolvedReason: "stream unreachable" });
    expect(renderBenchmarkReport(results)).toContain("## Unresolved streams");
  });
});
