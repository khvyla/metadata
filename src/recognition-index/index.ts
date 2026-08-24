import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import initSqlJs, { type Database } from "sql.js";

export const RECOGNITION_INDEX_SCHEMA_VERSION = 1;

export const FIXED_RECOGNITION_CONFIGURATION = {
  tokenKind: "medium-frame" as const,
  offsetBucketFrames: 2,
  shortlist: 5,
  minimumAverage: 0.92,
  minimumStrongProportion: 0.60,
  minimumRun: 24,
  minimumFrames: 40,
  minimumDominantVotes: 2,
  minimumMargin: 0.03,
};

export type RecognitionIndexRecording = {
  id: string;
  artist: string | null;
  title: string | null;
  provenance?: string;
};

export type RecognitionIndexSegment = {
  id: string;
  recordingId: string;
  startSeconds: number;
  durationSeconds: number;
  frames: number[];
  algorithm?: "chromaprint";
};

export type RecognitionIndexStats = {
  schemaVersion: number;
  recordingCount: number;
  segmentCount: number;
  openLoadMs: number;
  retrievalRebuildMs: number;
};

export type RecognitionIndexResult =
  | {
    matched: true;
    recording: RecognitionIndexRecording;
    evidence: {
      bestSimilarity: number;
      strongFrameProportion: number;
      longestStrongRun: number;
      alignedFrames: number;
      dominantVotes: number;
      evidenceSpan: number;
      margin: number;
    };
  }
  | { matched: false; reason: "index-empty" | "insufficient-evidence" | "ambiguous" };

export type RecognitionIndexOpenError = {
  error: "index-unreadable" | "index-corrupt";
  message: string;
};

export type RecognitionIndex = {
  addRecording(recording: RecognitionIndexRecording): boolean;
  addSegment(segment: RecognitionIndexSegment): boolean;
  addSegments(segments: RecognitionIndexSegment[]): number;
  getRecording(recordingId: string): RecognitionIndexRecording | null;
  listSegments(recordingId: string): RecognitionIndexSegment[];
  recognize(queryFrames: number[]): RecognitionIndexResult;
  getStats(): RecognitionIndexStats;
  close(): void;
};

type StoredSegment = RecognitionIndexSegment & { algorithm: "chromaprint" };
type RetrievalCandidate = { recordingId: string; totalVotes: number; dominantVotes: number; distinctQueryPositions: number; evidenceSpan: number; score: number };
type MatchMetrics = { averageBitSimilarity: number; comparedFrames: number; strongFrameProportion: number; longestStrongRun: number };
type CandidateEvidence = { recordingId: string; retrieval: RetrievalCandidate; metrics: MatchMetrics };

export async function createRecognitionIndex(filePath: string): Promise<RecognitionIndex | RecognitionIndexOpenError> {
  const startedAt = performance.now();
  let storedDatabase: Buffer | undefined;
  if (existsSync(filePath)) {
    try {
      storedDatabase = readFileSync(filePath);
    } catch (error) {
      return { error: "index-unreadable", message: error instanceof Error ? error.message : "Unable to read recognition index." };
    }
  }
  let database: Database;
  try {
    const SQL = await initSqlJs({ locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm") });
    database = storedDatabase ? new SQL.Database(storedDatabase) : new SQL.Database();
    initializeSchema(database);
  } catch (error) {
    return { error: "index-corrupt", message: error instanceof Error ? error.message : "Unable to open recognition index." };
  }
  try {
    return new PersistentRecognitionIndex(database, filePath, performance.now() - startedAt);
  } catch (error) {
    database.close();
    return { error: "index-corrupt", message: error instanceof Error ? error.message : "Recognition index data is invalid." };
  }
}

class PersistentRecognitionIndex implements RecognitionIndex {
  private readonly segmentsByRecording = new Map<string, StoredSegment[]>();
  private retrieval: Map<string, Array<{ recordingId: string; position: number }>> = new Map();
  private retrievalRebuildMs = 0;
  private closed = false;
  private dirty = false;

  constructor(private readonly database: Database, private readonly filePath: string, private readonly openLoadMs: number) {
    this.rebuildRetrieval();
  }

  addRecording(recording: RecognitionIndexRecording): boolean {
    this.assertOpen();
    this.database.run("INSERT OR IGNORE INTO recordings (recording_id, artist, title, provenance, created_at) VALUES (?, ?, ?, ?, ?)", [recording.id, recording.artist, recording.title, recording.provenance ?? null, new Date().toISOString()]);
    const added = this.database.getRowsModified() > 0;
    this.dirty ||= added;
    return added;
  }

  addSegment(segment: RecognitionIndexSegment): boolean {
    return this.addSegments([segment]) > 0;
  }

  addSegments(segments: RecognitionIndexSegment[]): number {
    this.assertOpen();
    this.database.run("BEGIN TRANSACTION");
    try {
      let inserted = 0;
      for (const segment of segments) {
        validateSegment(segment);
        this.database.run("INSERT OR IGNORE INTO fingerprint_segments (segment_id, recording_id, start_seconds, duration_seconds, raw_frames, algorithm, frame_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [segment.id, segment.recordingId, segment.startSeconds, segment.durationSeconds, JSON.stringify(segment.frames.map((frame) => frame >>> 0)), segment.algorithm ?? "chromaprint", segment.frames.length, new Date().toISOString()]);
        inserted += this.database.getRowsModified();
      }
      this.database.run("COMMIT");
      if (inserted) {
        this.dirty = true;
        this.rebuildRetrieval();
      }
      return inserted;
    } catch (error) {
      this.database.run("ROLLBACK");
      throw error;
    }
  }

  getRecording(recordingId: string): RecognitionIndexRecording | null {
    this.assertOpen();
    const row = this.rows("SELECT recording_id, artist, title, provenance FROM recordings WHERE recording_id = ?", [recordingId])[0];
    return row ? recordingFromRow(row) : null;
  }

  listSegments(recordingId: string): RecognitionIndexSegment[] {
    this.assertOpen();
    return (this.segmentsByRecording.get(recordingId) ?? []).map(({ algorithm: _algorithm, ...segment }) => segment);
  }

  recognize(queryFrames: number[]): RecognitionIndexResult {
    this.assertOpen();
    if (!this.segmentsByRecording.size) return { matched: false, reason: "index-empty" };
    const candidates = rankCandidates(this.retrieval, queryFrames).slice(0, FIXED_RECOGNITION_CONFIGURATION.shortlist);
    const evidence = candidates.map((candidate) => bestCandidateEvidence(queryFrames, candidate, this.segmentsByRecording)).filter((value): value is CandidateEvidence => value !== null)
      .sort((left, right) => right.metrics.averageBitSimilarity - left.metrics.averageBitSimilarity || right.metrics.longestStrongRun - left.metrics.longestStrongRun);
    const best = evidence[0];
    const runnerUp = evidence[1];
    if (!best) return { matched: false, reason: "insufficient-evidence" };
    const margin = best.metrics.averageBitSimilarity - (runnerUp?.metrics.averageBitSimilarity ?? 0);
    const insufficient = best.metrics.averageBitSimilarity < FIXED_RECOGNITION_CONFIGURATION.minimumAverage
      || best.metrics.strongFrameProportion < FIXED_RECOGNITION_CONFIGURATION.minimumStrongProportion
      || best.metrics.longestStrongRun < FIXED_RECOGNITION_CONFIGURATION.minimumRun
      || best.metrics.comparedFrames < FIXED_RECOGNITION_CONFIGURATION.minimumFrames
      || best.retrieval.dominantVotes < FIXED_RECOGNITION_CONFIGURATION.minimumDominantVotes;
    if (insufficient) return { matched: false, reason: "insufficient-evidence" };
    if (margin < FIXED_RECOGNITION_CONFIGURATION.minimumMargin) return { matched: false, reason: "ambiguous" };
    const recording = this.getRecording(best.recordingId);
    if (!recording) return { matched: false, reason: "insufficient-evidence" };
    return { matched: true, recording, evidence: { bestSimilarity: best.metrics.averageBitSimilarity, strongFrameProportion: best.metrics.strongFrameProportion, longestStrongRun: best.metrics.longestStrongRun, alignedFrames: best.metrics.comparedFrames, dominantVotes: best.retrieval.dominantVotes, evidenceSpan: best.retrieval.evidenceSpan, margin } };
  }

  getStats(): RecognitionIndexStats {
    this.assertOpen();
    return { schemaVersion: RECOGNITION_INDEX_SCHEMA_VERSION, recordingCount: count(this.database, "recordings"), segmentCount: count(this.database, "fingerprint_segments"), openLoadMs: round(this.openLoadMs), retrievalRebuildMs: round(this.retrievalRebuildMs) };
  }

  close(): void {
    if (this.closed) return;
    if (this.dirty || !existsSync(this.filePath)) {
      mkdirSync(dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.tmp`;
      writeFileSync(temporaryPath, this.database.export());
      renameSync(temporaryPath, this.filePath);
    }
    this.database.close();
    this.closed = true;
  }

  private rebuildRetrieval(): void {
    const startedAt = performance.now();
    this.segmentsByRecording.clear();
    this.retrieval = new Map();
    for (const row of this.rows("SELECT segment_id, recording_id, start_seconds, duration_seconds, raw_frames, algorithm FROM fingerprint_segments ORDER BY segment_id")) {
      const segment = segmentFromRow(row);
      const alternatives = this.segmentsByRecording.get(segment.recordingId) ?? [];
      alternatives.push(segment);
      this.segmentsByRecording.set(segment.recordingId, alternatives);
      for (const token of frameTokens(segment.frames)) {
        const entries = this.retrieval.get(token.token) ?? [];
        entries.push({ recordingId: segment.recordingId, position: token.position + Math.round(segment.startSeconds * 8) });
        this.retrieval.set(token.token, entries);
      }
    }
    this.retrievalRebuildMs = performance.now() - startedAt;
  }

  private rows(sql: string, params: Array<string | number | null> = []): Record<string, unknown>[] {
    const result = this.database.exec(sql, params);
    if (!result[0]) return [];
    return result[0].values.map((values) => Object.fromEntries(result[0].columns.map((column, index) => [column, values[index]])));
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Recognition index is closed.");
  }
}

function initializeSchema(database: Database): void {
  database.run("PRAGMA foreign_keys = ON");
  database.run("CREATE TABLE IF NOT EXISTS schema_info (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  database.run("INSERT OR IGNORE INTO schema_info (key, value) VALUES ('schema_version', ?)", [String(RECOGNITION_INDEX_SCHEMA_VERSION)]);
  const version = Number(database.exec("SELECT value FROM schema_info WHERE key = 'schema_version'")[0]?.values[0]?.[0]);
  if (version !== RECOGNITION_INDEX_SCHEMA_VERSION) throw new Error(`Unsupported recognition index schema version: ${version}.`);
  database.run("CREATE TABLE IF NOT EXISTS recordings (recording_id TEXT PRIMARY KEY, artist TEXT, title TEXT, provenance TEXT, created_at TEXT NOT NULL)");
  database.run("CREATE TABLE IF NOT EXISTS fingerprint_segments (segment_id TEXT PRIMARY KEY, recording_id TEXT NOT NULL, start_seconds REAL NOT NULL, duration_seconds REAL NOT NULL, raw_frames TEXT NOT NULL, algorithm TEXT NOT NULL, frame_count INTEGER NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY (recording_id) REFERENCES recordings(recording_id))");
  database.run("CREATE INDEX IF NOT EXISTS fingerprint_segments_recording_id ON fingerprint_segments(recording_id)");
}

function validateSegment(segment: RecognitionIndexSegment): void {
  if (!segment.id || !segment.recordingId || !Number.isFinite(segment.startSeconds) || segment.startSeconds < 0 || !Number.isFinite(segment.durationSeconds) || segment.durationSeconds <= 0 || !segment.frames.length || segment.frames.some((frame) => !Number.isInteger(frame) || frame < 0 || frame > 0xffffffff)) throw new Error("Recognition index segment is invalid.");
}

function recordingFromRow(row: Record<string, unknown>): RecognitionIndexRecording {
  return { id: String(row.recording_id), artist: row.artist === null ? null : String(row.artist), title: row.title === null ? null : String(row.title), provenance: row.provenance === null ? undefined : String(row.provenance) };
}

function segmentFromRow(row: Record<string, unknown>): StoredSegment {
  const frames = JSON.parse(String(row.raw_frames));
  if (!Array.isArray(frames) || frames.some((frame) => !Number.isInteger(frame))) throw new Error("Stored fingerprint segment contains invalid frame data.");
  if (row.algorithm !== "chromaprint") throw new Error(`Unsupported stored fingerprint algorithm: ${String(row.algorithm)}.`);
  return { id: String(row.segment_id), recordingId: String(row.recording_id), startSeconds: Number(row.start_seconds), durationSeconds: Number(row.duration_seconds), frames, algorithm: "chromaprint" };
}

function count(database: Database, table: string): number { return Number(database.exec(`SELECT COUNT(*) AS count FROM ${table}`)[0]?.values[0]?.[0] ?? 0); }
function frameTokens(frames: number[]): Array<{ token: string; position: number }> { return frames.map((frame, position) => ({ token: `f:${(frame >>> 0) >>> 16}`, position })); }

function rankCandidates(postings: Map<string, Array<{ recordingId: string; position: number }>>, queryFrames: number[]): RetrievalCandidate[] {
  const clusters = new Map<string, { recordingId: string; votes: number; positions: Set<number>; minimum: number; maximum: number }>();
  for (const query of frameTokens(queryFrames)) {
    for (const entry of postings.get(query.token) ?? []) {
      const bucket = Math.round((entry.position - query.position) / FIXED_RECOGNITION_CONFIGURATION.offsetBucketFrames);
      const key = `${entry.recordingId}|${bucket}`;
      const cluster = clusters.get(key) ?? { recordingId: entry.recordingId, votes: 0, positions: new Set<number>(), minimum: query.position, maximum: query.position };
      cluster.votes += 1;
      cluster.positions.add(query.position);
      cluster.minimum = Math.min(cluster.minimum, query.position);
      cluster.maximum = Math.max(cluster.maximum, query.position);
      clusters.set(key, cluster);
    }
  }
  const candidates = new Map<string, RetrievalCandidate>();
  for (const cluster of clusters.values()) {
    const candidate = candidates.get(cluster.recordingId) ?? { recordingId: cluster.recordingId, totalVotes: 0, dominantVotes: 0, distinctQueryPositions: 0, evidenceSpan: 0, score: 0 };
    candidate.totalVotes += cluster.votes;
    if (cluster.votes > candidate.dominantVotes) {
      candidate.dominantVotes = cluster.votes;
      candidate.distinctQueryPositions = cluster.positions.size;
      candidate.evidenceSpan = cluster.maximum - cluster.minimum;
    }
    candidates.set(cluster.recordingId, candidate);
  }
  return [...candidates.values()].map((candidate) => ({ ...candidate, score: candidate.dominantVotes * 3 + candidate.distinctQueryPositions + Math.min(candidate.evidenceSpan, 160) / 160 }))
    .sort((left, right) => right.score - left.score || right.dominantVotes - left.dominantVotes || left.recordingId.localeCompare(right.recordingId));
}

function bestCandidateEvidence(queryFrames: number[], retrieval: RetrievalCandidate, segmentsByRecording: Map<string, StoredSegment[]>): CandidateEvidence | null {
  const metrics = (segmentsByRecording.get(retrieval.recordingId) ?? []).map((segment) => matcherMetrics(queryFrames, segment.frames))
    .sort((left, right) => right.averageBitSimilarity - left.averageBitSimilarity || right.longestStrongRun - left.longestStrongRun)[0];
  return metrics ? { recordingId: retrieval.recordingId, retrieval, metrics } : null;
}

function matcherMetrics(left: number[], right: number[]): MatchMetrics {
  const minimumFrames = Math.max(16, Math.ceil(Math.min(left.length, right.length) * 0.6));
  let best: MatchMetrics = { averageBitSimilarity: 0, comparedFrames: 0, strongFrameProportion: 0, longestStrongRun: 0 };
  for (let shift = -180; shift <= 180; shift += 1) {
    const leftStart = Math.max(0, -shift); const rightStart = Math.max(0, shift); const length = Math.min(left.length - leftStart, right.length - rightStart);
    if (length < minimumFrames) continue;
    let total = 0; let strong = 0; let run = 0; let longest = 0;
    for (let index = 0; index < length; index += 1) {
      const similarity = (32 - popcount((left[leftStart + index] ^ right[rightStart + index]) >>> 0)) / 32;
      total += similarity;
      if (similarity >= 0.9) { strong += 1; run += 1; longest = Math.max(longest, run); } else run = 0;
    }
    const candidate = { averageBitSimilarity: total / length, comparedFrames: length, strongFrameProportion: strong / length, longestStrongRun: longest };
    if (candidate.averageBitSimilarity > best.averageBitSimilarity || candidate.averageBitSimilarity === best.averageBitSimilarity && candidate.longestStrongRun > best.longestStrongRun) best = candidate;
  }
  return best;
}

function popcount(value: number): number { let count = 0; while (value) { value &= value - 1; count += 1; } return count; }
function round(value: number): number { return Math.round(value * 1000) / 1000; }
