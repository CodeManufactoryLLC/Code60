import { dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { CodebaseFetchStatus } from "../bridge/index.js";
import {
  CODEBASE_CHUNKER,
  CODEBASE_LIMITS,
  checkedVector,
  type LexicalCandidate,
  type VectorCandidate,
} from "../core/index.js";
import { BUNDLED_EMBEDDING_MODEL } from "./embedding-model-info.js";

export const CODEBASE_VECTOR_DIMENSIONS = BUNDLED_EMBEDDING_MODEL.dimensions;
export const CODEBASE_MODEL_IDENTITY = `jina-v2-base-code:${BUNDLED_EMBEDDING_MODEL.revision}:${BUNDLED_EMBEDDING_MODEL.dtype}:mean:normalized:${BUNDLED_EMBEDDING_MODEL.dimensions}`;
export const CODEBASE_MODEL_LABEL = "Jina Embeddings v2 Base Code · INT8 · CPU";
export const CODEBASE_CHUNKER_IDENTITY = JSON.stringify(CODEBASE_CHUNKER);

export interface StoredRepository {
  repoKey: string;
  commonDir: string;
  topLevel: string;
  branch: string;
  ref: string;
  commitSha: string | null;
  modelId: string;
  chunkerId: string;
  fileCount: number;
  chunkCount: number;
  indexedAt: string | null;
  lastSyncAt: string;
  fetchStatus: CodebaseFetchStatus;
  fetchWarning: string | null;
  status: "unindexed" | "indexing" | "ready" | "error";
  lastError: string | null;
}

export interface StoredChunkInput {
  chunkIndex: number;
  startLine: number;
  endLine: number;
  text: string;
  vector: Float32Array;
}

export interface SearchFilterOptions {
  pathPrefix?: string | undefined;
  language?: string | undefined;
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function encodeVector(vector: Float32Array): Uint8Array {
  checkedVector(vector, CODEBASE_VECTOR_DIMENSIONS);
  const buffer = Buffer.allocUnsafe(CODEBASE_VECTOR_DIMENSIONS * 4);
  for (let i = 0; i < CODEBASE_VECTOR_DIMENSIONS; i++) {
    buffer.writeFloatLE(vector[i] ?? 0, i * 4);
  }
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

function dotProduct(query: Float32Array, blob: Uint8Array): number {
  if (blob.byteLength !== CODEBASE_VECTOR_DIMENSIONS * 4) return -1;
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  let score = 0;
  for (let i = 0; i < CODEBASE_VECTOR_DIMENSIONS; i++) {
    score += (query[i] ?? 0) * view.getFloat32(i * 4, true);
  }
  return Number.isFinite(score) ? score : -1;
}

function mapRepository(row: Record<string, unknown>): StoredRepository {
  return {
    repoKey: String(row.repo_key),
    commonDir: String(row.common_dir),
    topLevel: String(row.top_level),
    branch: String(row.branch),
    ref: String(row.ref),
    commitSha: row.commit_sha === null ? null : String(row.commit_sha),
    modelId: String(row.model_id),
    chunkerId: String(row.chunker_id),
    fileCount: Number(row.file_count),
    chunkCount: Number(row.chunk_count),
    indexedAt: row.indexed_at === null ? null : String(row.indexed_at),
    lastSyncAt: String(row.last_sync_at),
    fetchStatus: String(row.fetch_status) as CodebaseFetchStatus,
    fetchWarning: row.fetch_warning === null ? null : String(row.fetch_warning),
    status: String(row.status) as StoredRepository["status"],
    lastError: row.last_error === null ? null : String(row.last_error),
  };
}

/** Private SQLite + FTS5 vector index store, owned exclusively by the codebase sidecar. */
export class CodebaseStore {
  private readonly db: DatabaseSync;

  constructor(readonly path: string) {
    const sqlite = process.getBuiltinModule("node:sqlite");
    if (!sqlite) throw new Error("Codebase vector search requires built-in SQLite support");
    this.db = new sqlite.DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS repositories (
        repo_key TEXT PRIMARY KEY,
        common_dir TEXT NOT NULL,
        top_level TEXT NOT NULL,
        branch TEXT NOT NULL,
        ref TEXT NOT NULL,
        commit_sha TEXT,
        model_id TEXT NOT NULL,
        chunker_id TEXT NOT NULL,
        file_count INTEGER NOT NULL DEFAULT 0,
        chunk_count INTEGER NOT NULL DEFAULT 0,
        indexed_at TEXT,
        last_sync_at TEXT NOT NULL,
        fetch_status TEXT NOT NULL,
        fetch_warning TEXT,
        status TEXT NOT NULL,
        last_error TEXT
      );
      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_key TEXT NOT NULL REFERENCES repositories(repo_key) ON DELETE CASCADE,
        path TEXT NOT NULL,
        blob_oid TEXT NOT NULL,
        language TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        text TEXT NOT NULL,
        vector BLOB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS chunks_repo_path ON chunks(repo_key, path);
      CREATE INDEX IF NOT EXISTS chunks_repo_oid ON chunks(repo_key, blob_oid);
      CREATE INDEX IF NOT EXISTS chunks_repo_lang ON chunks(repo_key, language);
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        path,
        text,
        content='chunks',
        content_rowid='id',
        tokenize="unicode61 tokenchars '_'"
      );
      CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
        INSERT INTO chunks_fts(rowid, path, text) VALUES (new.id, new.path, new.text);
      END;
      CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
        INSERT INTO chunks_fts(chunks_fts, rowid, path, text) VALUES ('delete', old.id, old.path, old.text);
      END;
      CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
        INSERT INTO chunks_fts(chunks_fts, rowid, path, text) VALUES ('delete', old.id, old.path, old.text);
        INSERT INTO chunks_fts(rowid, path, text) VALUES (new.id, new.path, new.text);
      END;
    `);
  }

  get root(): string {
    return dirname(this.path);
  }

  getRepository(repoKey: string): StoredRepository | null {
    const row = this.db.prepare("SELECT * FROM repositories WHERE repo_key = ?").get(repoKey) as
      | Record<string, unknown>
      | undefined;
    return row ? mapRepository(row) : null;
  }

  isCompatible(repo: StoredRepository): boolean {
    return repo.modelId === CODEBASE_MODEL_IDENTITY && repo.chunkerId === CODEBASE_CHUNKER_IDENTITY;
  }

  upsertRepository(input: {
    repoKey: string;
    commonDir: string;
    topLevel: string;
    branch: string;
    ref: string;
    commitSha?: string | null;
    lastSyncAt: string;
    fetchStatus: CodebaseFetchStatus;
    fetchWarning?: string | null;
    status: StoredRepository["status"];
    lastError?: string | null;
  }): void {
    const existing = this.getRepository(input.repoKey);
    const incompatible = existing !== null && !this.isCompatible(existing);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (incompatible) {
        this.db.prepare("DELETE FROM chunks WHERE repo_key = ?").run(input.repoKey);
      }
      this.db
        .prepare(`
          INSERT INTO repositories (
            repo_key, common_dir, top_level, branch, ref, commit_sha,
            model_id, chunker_id, file_count, chunk_count, indexed_at,
            last_sync_at, fetch_status, fetch_warning, status, last_error
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, ?, ?, ?, ?, ?)
          ON CONFLICT(repo_key) DO UPDATE SET
            common_dir = excluded.common_dir,
            top_level = excluded.top_level,
            branch = excluded.branch,
            ref = excluded.ref,
            commit_sha = CASE
              WHEN excluded.commit_sha IS NOT NULL THEN excluded.commit_sha
              WHEN repositories.model_id != excluded.model_id OR repositories.chunker_id != excluded.chunker_id THEN NULL
              ELSE repositories.commit_sha
            END,
            model_id = excluded.model_id,
            chunker_id = excluded.chunker_id,
            file_count = CASE
              WHEN repositories.model_id != excluded.model_id OR repositories.chunker_id != excluded.chunker_id THEN 0
              ELSE repositories.file_count
            END,
            chunk_count = CASE
              WHEN repositories.model_id != excluded.model_id OR repositories.chunker_id != excluded.chunker_id THEN 0
              ELSE repositories.chunk_count
            END,
            indexed_at = CASE
              WHEN repositories.model_id != excluded.model_id OR repositories.chunker_id != excluded.chunker_id THEN NULL
              ELSE repositories.indexed_at
            END,
            last_sync_at = excluded.last_sync_at,
            fetch_status = excluded.fetch_status,
            fetch_warning = excluded.fetch_warning,
            status = excluded.status,
            last_error = excluded.last_error
        `)
        .run(
          input.repoKey,
          input.commonDir,
          input.topLevel,
          input.branch,
          input.ref,
          input.commitSha ?? null,
          CODEBASE_MODEL_IDENTITY,
          CODEBASE_CHUNKER_IDENTITY,
          input.lastSyncAt,
          input.fetchStatus,
          input.fetchWarning ?? null,
          input.status,
          input.lastError ?? null,
        );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  indexedFiles(repoKey: string): Map<string, string> {
    const repo = this.getRepository(repoKey);
    if (!repo || !this.isCompatible(repo)) return new Map();
    const rows = this.db
      .prepare("SELECT DISTINCT path, blob_oid FROM chunks WHERE repo_key = ?")
      .all(repoKey) as Array<{ path: string; blob_oid: string }>;
    const map = new Map<string, string>();
    for (const row of rows) map.set(row.path, row.blob_oid);
    return map;
  }

  chunkCount(repoKey: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS count FROM chunks WHERE repo_key = ?")
      .get(repoKey) as { count: number } | undefined;
    return Number(row?.count ?? 0);
  }

  replaceFiles(
    repoKey: string,
    files: ReadonlyArray<{
      path: string;
      blobOid: string;
      language: string;
      chunks: readonly StoredChunkInput[];
    }>,
  ): number {
    if (files.length === 0) return this.chunkCount(repoKey);
    const del = this.db.prepare("DELETE FROM chunks WHERE repo_key = ? AND path = ?");
    const insert = this.db.prepare(`
      INSERT INTO chunks (
        repo_key, path, blob_oid, language, chunk_index, start_line, end_line, text, vector
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const file of files) {
        del.run(repoKey, file.path);
        for (const chunk of file.chunks) {
          insert.run(
            repoKey,
            file.path,
            file.blobOid,
            file.language,
            chunk.chunkIndex,
            chunk.startLine,
            chunk.endLine,
            chunk.text,
            encodeVector(chunk.vector),
          );
        }
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.chunkCount(repoKey);
  }

  finalizeCommit(input: {
    repoKey: string;
    commonDir: string;
    topLevel: string;
    branch: string;
    ref: string;
    commitSha: string;
    indexedAt: string;
    lastSyncAt: string;
    fetchStatus: CodebaseFetchStatus;
    fetchWarning?: string | null;
    deletedPaths: readonly string[];
  }): StoredRepository {
    const del = this.db.prepare("DELETE FROM chunks WHERE repo_key = ? AND path = ?");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const path of input.deletedPaths) {
        del.run(input.repoKey, path);
      }
      const stats = this.db
        .prepare(
          "SELECT COUNT(DISTINCT path) AS files, COUNT(*) AS chunks FROM chunks WHERE repo_key = ?",
        )
        .get(input.repoKey) as { files: number; chunks: number };
      this.db
        .prepare(`
          UPDATE repositories
          SET common_dir = ?,
              top_level = ?,
              branch = ?,
              ref = ?,
              commit_sha = ?,
              model_id = ?,
              chunker_id = ?,
              file_count = ?,
              chunk_count = ?,
              indexed_at = ?,
              last_sync_at = ?,
              fetch_status = ?,
              fetch_warning = ?,
              status = 'ready',
              last_error = NULL
          WHERE repo_key = ?
        `)
        .run(
          input.commonDir,
          input.topLevel,
          input.branch,
          input.ref,
          input.commitSha,
          CODEBASE_MODEL_IDENTITY,
          CODEBASE_CHUNKER_IDENTITY,
          Number(stats.files ?? 0),
          Number(stats.chunks ?? 0),
          input.indexedAt,
          input.lastSyncAt,
          input.fetchStatus,
          input.fetchWarning ?? null,
          input.repoKey,
        );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    this.pruneLruRepositories(CODEBASE_LIMITS.maxRepositories);
    const updated = this.getRepository(input.repoKey);
    if (!updated) throw new Error("Repository metadata disappeared after indexing");
    return updated;
  }

  markSync(input: {
    repoKey: string;
    commonDir: string;
    topLevel: string;
    branch: string;
    ref: string;
    lastSyncAt: string;
    fetchStatus: CodebaseFetchStatus;
    fetchWarning?: string | null;
  }): StoredRepository | null {
    this.db
      .prepare(`
        UPDATE repositories
        SET common_dir = ?,
            top_level = ?,
            branch = ?,
            ref = ?,
            last_sync_at = ?,
            fetch_status = ?,
            fetch_warning = ?
        WHERE repo_key = ?
      `)
      .run(
        input.commonDir,
        input.topLevel,
        input.branch,
        input.ref,
        input.lastSyncAt,
        input.fetchStatus,
        input.fetchWarning ?? null,
        input.repoKey,
      );
    return this.getRepository(input.repoKey);
  }

  private filterClause(
    filters: SearchFilterOptions,
    prefix = "",
  ): { sql: string; params: string[] } {
    const clauses: string[] = [];
    const params: string[] = [];
    if (filters.pathPrefix) {
      const normalized = filters.pathPrefix.replace(/\/+$/, "");
      clauses.push(`(${prefix}path = ? OR ${prefix}path LIKE ? ESCAPE '\\')`);
      params.push(normalized, `${escapeLike(normalized)}/%`);
    }
    if (filters.language) {
      clauses.push(`${prefix}language = ?`);
      params.push(filters.language);
    }
    return { sql: clauses.length ? ` AND ${clauses.join(" AND ")}` : "", params };
  }

  lexicalSearch(
    repoKey: string,
    ftsQuery: string,
    filters: SearchFilterOptions = {},
    limit = 100,
  ): LexicalCandidate[] {
    const extra = this.filterClause(filters, "c.");
    try {
      const rows = this.db
        .prepare(`
          SELECT c.id, c.path, c.start_line, c.end_line, c.language, c.text, bm25(chunks_fts) AS rank
          FROM chunks_fts
          JOIN chunks c ON c.id = chunks_fts.rowid
          WHERE chunks_fts MATCH ? AND c.repo_key = ?${extra.sql}
          ORDER BY rank ASC, c.path ASC, c.start_line ASC
          LIMIT ?
        `)
        .all(ftsQuery, repoKey, ...extra.params, limit) as Array<{
        id: number;
        path: string;
        start_line: number;
        end_line: number;
        language: string;
        text: string;
        rank: number;
      }>;
      return rows.map((row) => ({
        id: Number(row.id),
        path: row.path,
        startLine: Number(row.start_line),
        endLine: Number(row.end_line),
        language: row.language,
        text: row.text,
        lexicalRank: Number(row.rank),
      }));
    } catch {
      return [];
    }
  }

  vectorSearch(
    repoKey: string,
    queryVector: Float32Array,
    filters: SearchFilterOptions = {},
    limit = 100,
  ): VectorCandidate[] {
    checkedVector(queryVector, CODEBASE_VECTOR_DIMENSIONS);
    const extra = this.filterClause(filters);
    const stmt = this.db.prepare(`
      SELECT id, path, start_line, end_line, language, text, vector
      FROM chunks
      WHERE repo_key = ?${extra.sql}
    `);
    const best: VectorCandidate[] = [];
    for (const row of stmt.iterate(repoKey, ...extra.params) as Iterable<{
      id: number;
      path: string;
      start_line: number;
      end_line: number;
      language: string;
      text: string;
      vector: Uint8Array;
    }>) {
      const score = dotProduct(queryVector, row.vector);
      if (score <= 0) continue;
      const tail = best.at(-1);
      if (best.length >= limit && tail && score <= tail.vectorScore) continue;
      const candidate: VectorCandidate = {
        id: Number(row.id),
        path: row.path,
        startLine: Number(row.start_line),
        endLine: Number(row.end_line),
        language: row.language,
        text: row.text,
        vectorScore: score,
      };
      let at = best.findIndex(
        (existing) =>
          existing.vectorScore < score ||
          (existing.vectorScore === score && existing.path.localeCompare(candidate.path) > 0),
      );
      if (at < 0) at = best.length;
      best.splice(at, 0, candidate);
      if (best.length > limit) best.pop();
    }
    return best;
  }

  pruneLruRepositories(maxRepos: number): void {
    const rows = this.db
      .prepare("SELECT repo_key FROM repositories ORDER BY last_sync_at DESC")
      .all() as Array<{ repo_key: string }>;
    if (rows.length <= maxRepos) return;
    const del = this.db.prepare("DELETE FROM repositories WHERE repo_key = ?");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of rows.slice(maxRepos)) del.run(row.repo_key);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }
}
