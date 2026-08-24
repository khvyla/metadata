import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { FIXED_RECOGNITION_CONFIGURATION, createRecognitionIndex, processMetadata } from "../src";
import type { RecognitionIndex, RecognitionIndexOpenError } from "../src";

const directories: string[] = [];
const frames = (seed: number) => Array.from({ length: 100 }, (_, index) => ((seed << 16) | index) >>> 0);

function temporaryIndexPath(): string {
  const directory = mkdtempSync(join(tmpdir(), "khvyla-recognition-index-"));
  directories.push(directory);
  return join(directory, "index.sqlite");
}

function requireIndex(value: RecognitionIndex | RecognitionIndexOpenError): RecognitionIndex {
  if ("error" in value) throw new Error(`${value.error}: ${value.message}`);
  return value;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("persistent recognition index prototype", () => {
  it("creates and opens an empty schema-versioned index", async () => {
    const index = requireIndex(await createRecognitionIndex(temporaryIndexPath()));
    expect(index.getStats()).toMatchObject({ schemaVersion: 1, recordingCount: 0, segmentCount: 0 });
    expect(index.recognize(frames(1))).toEqual({ matched: false, reason: "index-empty" });
    index.close();
  });

  it("stores recordings and segments idempotently across close and reopen", async () => {
    const filePath = temporaryIndexPath();
    const index = requireIndex(await createRecognitionIndex(filePath));
    expect(index.addRecording({ id: "recording-a", artist: "Artist A", title: "Track A", provenance: "CC0 test fixture" })).toBe(true);
    expect(index.addRecording({ id: "recording-a", artist: "Artist A", title: "Track A" })).toBe(false);
    expect(index.addSegment({ id: "recording-a:0", recordingId: "recording-a", startSeconds: 0, durationSeconds: 20, frames: frames(1) })).toBe(true);
    expect(index.addSegment({ id: "recording-a:0", recordingId: "recording-a", startSeconds: 0, durationSeconds: 20, frames: frames(1) })).toBe(false);
    expect(index.addSegments([{ id: "recording-a:15", recordingId: "recording-a", startSeconds: 15, durationSeconds: 20, frames: frames(1) }])).toBe(1);
    index.close();

    const reopened = requireIndex(await createRecognitionIndex(filePath));
    expect(reopened.getRecording("recording-a")).toEqual({ id: "recording-a", artist: "Artist A", title: "Track A", provenance: "CC0 test fixture" });
    expect(reopened.listSegments("recording-a")).toHaveLength(2);
    expect(reopened.getStats()).toMatchObject({ recordingCount: 1, segmentCount: 2 });
    reopened.close();
  });

  it("recognizes a known query after reopen and rejects an unknown query", async () => {
    const filePath = temporaryIndexPath();
    const index = requireIndex(await createRecognitionIndex(filePath));
    index.addRecording({ id: "recording-a", artist: "Artist A", title: "Track A" });
    index.addRecording({ id: "recording-b", artist: "Artist B", title: "Track B" });
    index.addSegments([
      { id: "recording-a:0", recordingId: "recording-a", startSeconds: 0, durationSeconds: 20, frames: frames(1) },
      { id: "recording-b:0", recordingId: "recording-b", startSeconds: 0, durationSeconds: 20, frames: frames(2) },
    ]);
    index.close();

    const reopened = requireIndex(await createRecognitionIndex(filePath));
    expect(reopened.recognize(frames(1))).toMatchObject({ matched: true, recording: { id: "recording-a", artist: "Artist A", title: "Track A" } });
    expect(reopened.recognize(frames(9))).toEqual({ matched: false, reason: "insufficient-evidence" });
    reopened.close();
  });

  it("returns structured errors for corrupt and unreadable paths", async () => {
    const corrupt = temporaryIndexPath();
    writeFileSync(corrupt, "not a sqlite database");
    await expect(createRecognitionIndex(corrupt)).resolves.toMatchObject({ error: "index-corrupt" });
    const unreadable = temporaryIndexPath();
    mkdirSync(unreadable);
    await expect(createRecognitionIndex(unreadable)).resolves.toMatchObject({ error: "index-unreadable" });
  });

  it("keeps the frozen recognition settings and existing metadata API independent", () => {
    expect(FIXED_RECOGNITION_CONFIGURATION).toMatchObject({ tokenKind: "medium-frame", offsetBucketFrames: 2, shortlist: 5, minimumAverage: 0.92, minimumMargin: 0.03 });
    expect(processMetadata("StreamTitle='Stan Getz - Misty';").track).toEqual({ artist: "Stan Getz", title: "Misty" });
  });
});
