import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  type ProjectEntry,
  type ProjectSearchIdentity,
  type ProjectSearchPage,
  type ProjectSearchQuery,
  type ProjectSearchSource,
  SEARCH_SOURCE_LIMIT,
  type SearchProject,
  searchEvidenceExcerpt,
  searchKeywords,
} from "../bridge/index.js";
import { privateDirectory } from "../platform/index.js";
import type { SearchEvidence, SearchEvidenceReader } from "./project-search-reader.js";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const PAGE_SIZE = 100;
interface Query {
  request: ProjectSearchQuery;
  root: string;
  db: DatabaseSync;
  abort: AbortController;
  done: Promise<void>;
  current(): boolean;
  warnings: Set<string>;
  partial: boolean;
  roots: Map<string, { dev: bigint; ino: bigint }>;
  cursors: Map<string, number>;
  pages: Map<number, string>;
  closed: boolean;
  cleanup: Promise<void> | undefined;
}

/** One database-scoped immutable submitted search. Only excerpts live in its private SQLite file. */
export class ProjectSearch {
  constructor(private readonly temporaryRoot = tmpdir()) {}
  private active: Query | undefined;
  private setup: Promise<void> = Promise.resolve();

  async search(
    request: ProjectSearchQuery,
    projects: readonly ProjectEntry[],
    reader: SearchEvidenceReader,
    current: () => boolean,
  ): Promise<ProjectSearchPage> {
    this.active?.abort.abort();
    const prepared = this.setup.then(async () => {
      if (this.active) await this.dispose(this.active);
      if (!current()) throw new Error("The database changed. Search again.");
      const root = await mkdtemp(join(this.temporaryRoot, "code60-project-search-"));
      let db: DatabaseSync | undefined;
      try {
        await privateDirectory(root);
        const path = join(root, "results.sqlite");
        await writeFile(path, "", { flag: "wx", mode: 0o600 });
        const sqlite = process.getBuiltinModule("node:sqlite");
        if (!sqlite) throw new Error("Search requires built-in SQLite support");
        db = new sqlite.DatabaseSync(path);
        db.exec(
          "PRAGMA journal_mode=MEMORY; CREATE TABLE sources (id TEXT PRIMARY KEY, matched INTEGER NOT NULL, score INTEGER NOT NULL, context INTEGER NOT NULL, at REAL NOT NULL, source TEXT NOT NULL); CREATE INDEX ranked ON sources(matched,score DESC,at DESC,id)",
        );
        const state: Query = {
          request,
          root,
          db,
          abort: new AbortController(),
          done: Promise.resolve(),
          current,
          warnings: new Set(),
          partial: false,
          roots: new Map(),
          cursors: new Map(),
          pages: new Map(),
          closed: false,
          cleanup: undefined,
        };
        this.active = state;
        state.done = this.scan(state, projects, reader);
        void state.done.catch(() => {});
        return state;
      } catch (error) {
        db?.close();
        await rm(root, { recursive: true, force: true });
        throw error;
      }
    });
    this.setup = prepared.then(
      () => {},
      () => {},
    );
    const state = await prepared;
    try {
      await state.done;
      this.assert(state, request);
      return this.page(request);
    } catch (error) {
      const cancelled = state.abort.signal.aborted;
      await this.dispose(state);
      if (cancelled) throw new Error("Search cancelled");
      throw error;
    }
  }

  private async scan(
    state: Query,
    projects: readonly ProjectEntry[],
    reader: SearchEvidenceReader,
  ): Promise<void> {
    const { query, kind } = state.request;
    const terms = [...new Set(query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean))];
    const words = searchKeywords(query);
    const insert = state.db.prepare("INSERT OR IGNORE INTO sources VALUES (?, ?, ?, ?, ?, ?)");
    const queue = [...projects];
    const context: { source: ProjectSearchSource; score: number; at: number }[] = [];
    const names = new Map<string, number>();
    for (const project of projects) {
      const name = basename(project.path);
      names.set(name, (names.get(name) ?? 0) + 1);
    }
    state.db.exec("BEGIN");
    try {
      const worker = async () => {
        for (;;) {
          this.assert(state, state.request);
          const entry = queue.shift();
          if (!entry) return;
          const name = basename(entry.path) || entry.path;
          const project: SearchProject = {
            id: digest(entry.path),
            name: (names.get(name) ?? 0) > 1 ? entry.path : name,
            path: entry.path,
          };
          const issue = (description: string) => {
            state.partial = true;
            if (state.warnings.size < 20) state.warnings.add(`${project.name}: ${description}.`);
          };
          const add = (evidence: SearchEvidence) => {
            this.assert(state, state.request, false);
            if (kind !== "all" && kind !== evidence.kind) return;
            const haystack =
              `${evidence.title}\n${evidence.text}\n${evidence.runId ?? ""}`.toLocaleLowerCase();
            const matched = terms.every((term) => haystack.includes(term));
            const title = evidence.title.toLocaleLowerCase();
            const exact = evidence.id.toLocaleLowerCase() === query.trim().toLocaleLowerCase();
            const score =
              (exact
                ? 2000
                : evidence.runId?.toLocaleLowerCase() === query.trim().toLocaleLowerCase()
                  ? 500
                  : 0) +
              terms.filter((term) => title.includes(term)).length * 10;
            const contextScore =
              words.filter((term) => haystack.includes(term)).length * 100 +
              (evidence.kind === "file" ? 20 : 0);
            const id = digest(JSON.stringify([project.id, evidence.id]));
            const source: ProjectSearchSource = {
              ...evidence,
              id,
              title: evidence.title.slice(0, 512),
              text: searchEvidenceExcerpt(evidence.text, query),
              project,
            };
            const at = Date.parse(evidence.at) || 0;
            if (matched) insert.run(id, 1, score, contextScore, at, JSON.stringify(source));
            else {
              context.push({ source, score: contextScore, at });
              context.sort(
                (a, b) =>
                  b.score - a.score || b.at - a.at || a.source.id.localeCompare(b.source.id),
              );
              context.length = Math.min(context.length, SEARCH_SOURCE_LIMIT);
            }
          };
          add({ id: entry.path, kind: "project", title: name, text: entry.path, at: "" });
          try {
            const canonical = await realpath(entry.path);
            const info = await lstat(entry.path, { bigint: true });
            if (!info.isDirectory() || info.isSymbolicLink() || canonical !== entry.path)
              throw new Error("Unavailable project");
            state.roots.set(entry.path, { dev: info.dev, ino: info.ino });
            await reader(
              entry.path,
              query,
              kind === "all" || kind === "file",
              state.abort.signal,
              add,
              issue,
            );
          } catch {
            this.assert(state, state.request);
            issue("Project could not be completely searched");
          }
        }
      };
      // Each worker reads one source at a time, including bounded file evidence retrieval.
      const results = await Promise.allSettled(
        Array.from({ length: Math.min(4, queue.length) }, worker),
      );
      const failed = results.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
      this.assert(state, state.request);
      for (const entry of context)
        insert.run(entry.source.id, 0, 0, entry.score, entry.at, JSON.stringify(entry.source));
      state.db.exec("COMMIT");
    } catch (error) {
      state.db.exec("ROLLBACK");
      throw error;
    }
  }

  private assert(state: Query, identity: ProjectSearchIdentity, scope = true) {
    state.abort.signal.throwIfAborted();
    if (
      state.closed ||
      this.active !== state ||
      state.request.requestId !== identity.requestId ||
      state.request.databaseEpoch !== identity.databaseEpoch ||
      (scope && !state.current())
    )
      throw new Error("Search is no longer current. Search again.");
  }
  private query(identity: ProjectSearchIdentity): Query {
    const state = this.active;
    if (!state) throw new Error("Search expired. Search again.");
    this.assert(state, identity);
    return state;
  }
  page(identity: ProjectSearchIdentity, cursor?: string): ProjectSearchPage {
    const state = this.query(identity);
    const offset = cursor === undefined ? 0 : state.cursors.get(cursor);
    if (offset === undefined) throw new Error("Invalid search cursor");
    const order = state.request.sort === "newest" ? "at DESC,id" : "score DESC,at DESC,id";
    const results = state.db
      .prepare(`SELECT source FROM sources WHERE matched=1 ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(PAGE_SIZE, offset)
      .map((row) => JSON.parse(String(row.source)) as ProjectSearchSource);
    const total = Number(
      state.db.prepare("SELECT COUNT(*) AS n FROM sources WHERE matched=1").get()?.n,
    );
    const next = offset + results.length;
    let nextCursor: string | null = null;
    if (next < total) {
      nextCursor = state.pages.get(next) ?? randomUUID();
      state.pages.set(next, nextCursor);
      state.cursors.set(nextCursor, next);
    }
    return {
      requestId: identity.requestId,
      results,
      nextCursor,
      total,
      partial: state.partial,
      warnings: [...state.warnings],
    };
  }
  evidence(identity: ProjectSearchIdentity): { query: string; sources: ProjectSearchSource[] } {
    const state = this.query(identity);
    const rows = state.db
      .prepare(
        "SELECT source FROM sources ORDER BY matched DESC, CASE WHEN matched=1 THEN score ELSE context END DESC, at DESC,id LIMIT ?",
      )
      .all(SEARCH_SOURCE_LIMIT);
    return {
      query: state.request.query,
      sources: rows.map((row) => JSON.parse(String(row.source)) as ProjectSearchSource),
    };
  }
  async source(identity: ProjectSearchIdentity, id: string): Promise<ProjectSearchSource> {
    const state = this.query(identity);
    const row = state.db.prepare("SELECT source FROM sources WHERE id=?").get(id);
    if (!row) throw new Error("Unknown search source");
    const source = JSON.parse(String(row.source)) as ProjectSearchSource;
    const captured = state.roots.get(source.project.path);
    const info = await lstat(source.project.path, { bigint: true });
    if (
      !captured ||
      (await realpath(source.project.path)) !== source.project.path ||
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      info.dev !== captured.dev ||
      info.ino !== captured.ino
    )
      throw new Error("The project directory changed. Search again.");
    this.assert(state, identity);
    return source;
  }
  async cancel(identity?: ProjectSearchIdentity): Promise<void> {
    await this.setup;
    const state = this.active;
    if (
      !state ||
      (identity &&
        (state.request.requestId !== identity.requestId ||
          state.request.databaseEpoch !== identity.databaseEpoch))
    )
      return;
    await this.dispose(state);
  }
  private dispose(state: Query): Promise<void> {
    if (state.cleanup) return state.cleanup;
    state.abort.abort();
    state.cleanup = (async () => {
      await state.done.catch(() => {});
      state.closed = true;
      state.db.close();
      await rm(state.root, { recursive: true, force: true });
      if (this.active === state) this.active = undefined;
    })();
    return state.cleanup;
  }
}
