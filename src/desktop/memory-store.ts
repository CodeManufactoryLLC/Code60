import { randomUUID } from "node:crypto";
import { lstatSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  DEFAULT_MEMORY_SETTINGS,
  type MemoryAction,
  type MemoryBrowse,
  type MemoryCandidate,
  type MemoryDetail,
  type MemoryGeneration,
  type MemoryPage,
  type MemoryRecord,
  type MemorySettings,
  type MemorySource,
  memoryRecordSchema,
  memorySettingsSchema,
  memorySourceSchema,
  parseValue,
} from "../bridge/index.js";
import { checkpointText, validateMemoryGeneration } from "../core/index.js";
import {
  createPrivateFileSync,
  privateDirectorySync,
  verifyPrivateSync,
} from "../platform/index.js";

const normalize = (text: string) => text.toLocaleLowerCase("en").replace(/\s+/g, " ").trim();
const json = (value: unknown) => JSON.stringify(value);
const decode = <T>(value: unknown): T => JSON.parse(String(value)) as T;
const now = () => new Date().toISOString();

/** Runs only in a Node sidecar. SQLite has a separate schema from project databases. */
export class MemoryStore {
  private readonly db: DatabaseSync;
  constructor(root: string) {
    privateDirectorySync(root);
    const file = join(root, "memory.sqlite");
    try {
      createPrivateFileSync(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const info = lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)
      throw new Error("Unsafe memory database");
    if (process.platform !== "win32" && info.mode & 0o077)
      throw new Error("Memory database permissions are unsafe");
    verifyPrivateSync(file);
    const sqlite = process.getBuiltinModule("node:sqlite") as
      | typeof import("node:sqlite")
      | undefined;
    if (!sqlite) throw new Error("This runtime has no built-in SQLite support");
    this.db = new sqlite.DatabaseSync(file);
    const after = lstatSync(file);
    if (after.dev !== info.dev || after.ino !== info.ino) {
      this.db.close();
      throw new Error("Memory database changed");
    }
    this.db.exec("PRAGMA journal_mode=DELETE; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1000;");
    const version = Number(this.db.prepare("PRAGMA user_version").get()?.user_version);
    if (version > 1) {
      this.db.close();
      throw new Error("A newer Code60 created this memory database");
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, identity TEXT UNIQUE NOT NULL, label TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, project TEXT, label TEXT NOT NULL,
        remember INTEGER NOT NULL DEFAULT 1, cursor INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS sources (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, cid TEXT NOT NULL,
        turn INTEGER NOT NULL, committed INTEGER NOT NULL DEFAULT 0, value TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sources_range ON sources(cid, committed, seq);
      CREATE TABLE IF NOT EXISTS checkpoints (
        cid TEXT NOT NULL, boundary INTEGER NOT NULL, value TEXT NOT NULL,
        PRIMARY KEY(cid, boundary)
      );
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY, project TEXT, cid TEXT NOT NULL, scope TEXT NOT NULL,
        type TEXT NOT NULL, state TEXT NOT NULL, created TEXT NOT NULL, fingerprint TEXT NOT NULL,
        value TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS memory_scope ON memories(project, scope, state, created);
      CREATE INDEX IF NOT EXISTS memory_fingerprint ON memories(fingerprint);
      CREATE INDEX IF NOT EXISTS memory_subject ON memories(json_extract(value,'$.subject'));
      CREATE TABLE IF NOT EXISTS revisions (id TEXT NOT NULL, revision INTEGER NOT NULL, text TEXT NOT NULL, at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS suppressed (source TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS suppressed_capture (source TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS vectors (id TEXT NOT NULL, part INTEGER NOT NULL, model TEXT NOT NULL, value BLOB NOT NULL, PRIMARY KEY(id, part));
      CREATE TABLE IF NOT EXISTS calls (day TEXT PRIMARY KEY, count INTEGER NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(id UNINDEXED, text);
      PRAGMA user_version=1;
    `);
  }
  close() {
    this.db.close();
  }
  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  settings(): MemorySettings {
    const row = this.db.prepare("SELECT value FROM meta WHERE key='settings'").get();
    return row
      ? parseValue(memorySettingsSchema, decode(row.value))
      : structuredClone(DEFAULT_MEMORY_SETTINGS);
  }
  configure(settings: MemorySettings) {
    this.db
      .prepare("INSERT OR REPLACE INTO meta VALUES ('settings',?)")
      .run(json(parseValue(memorySettingsSchema, settings)));
  }
  register(key: string, label: string, path: string | null) {
    const project = path ? this.project(path) : null;
    const fullKey = json([key, project]);
    const previous = this.db
      .prepare("SELECT id,remember FROM conversations WHERE key=?")
      .get(fullKey);
    const id = previous ? String(previous.id) : randomUUID();
    if (!previous)
      this.db
        .prepare("INSERT INTO conversations (id,key,project,label) VALUES (?,?,?,?)")
        .run(id, fullKey, project, label.slice(0, 256));
    return { id, projectId: project, remember: previous ? Boolean(previous.remember) : true };
  }
  project(path: string, expected?: { device: bigint; inode: bigint }) {
    const canonical = realpathSync(path);
    const info = statSync(canonical, { bigint: true });
    if (
      !info.isDirectory() ||
      (expected && (info.dev !== expected.device || info.ino !== expected.inode))
    )
      throw new Error("Memory target identity changed");
    const identity = json([
      canonical,
      String(info.dev),
      String(info.ino),
      String(info.birthtimeNs),
    ]);
    const row = this.db.prepare("SELECT id FROM projects WHERE identity=?").get(identity);
    const project = row ? String(row.id) : randomUUID();
    if (!row)
      this.db.prepare("INSERT INTO projects VALUES (?,?,?)").run(project, identity, canonical);
    return project;
  }
  conversation(id: string) {
    const row = this.db.prepare("SELECT * FROM conversations WHERE id=?").get(id);
    if (!row) throw new Error("Memory conversation is unavailable");
    return row;
  }
  append(cid: string, turn: string | number, sources: MemorySource[], complete: boolean) {
    if (!this.conversation(cid).remember) return;
    if (this.bytes() > 512 * 1_048_576)
      throw new Error(
        "Memory storage reached 512 MiB. Forget derived history before capturing more.",
      );
    this.transaction(() => {
      for (const input of sources) {
        const source = parseValue(memorySourceSchema, input);
        if (source.conversationId !== cid) throw new Error("Memory source owner mismatch");
        this.db
          .prepare("INSERT OR IGNORE INTO sources(id,cid,turn,value) VALUES (?,?,?,?)")
          .run(source.id, cid, turn, json(source));
      }
      if (complete)
        this.db.prepare("UPDATE sources SET committed=1 WHERE cid=? AND turn=?").run(cid, turn);
    });
  }
  range(cid: string) {
    const conversation = this.conversation(cid);
    const checkpoint = this.db
      .prepare("SELECT value FROM checkpoints WHERE cid=? ORDER BY boundary DESC LIMIT 1")
      .get(cid);
    const rows = this.db
      .prepare(`SELECT seq,value FROM sources s WHERE cid=? AND committed=1 AND seq>?
      AND NOT EXISTS (SELECT 1 FROM suppressed WHERE source=s.id)
      AND NOT EXISTS (SELECT 1 FROM suppressed_capture WHERE source=s.id) ORDER BY seq LIMIT 64`)
      .all(cid, Number(conversation.cursor));
    const sources: MemorySource[] = [];
    let bytes = 0;
    let boundary = Number(conversation.cursor);
    for (const row of rows) {
      const source = parseValue(memorySourceSchema, decode(row.value));
      const size = Buffer.byteLength(json(source));
      if (sources.length && bytes + size > 24000) break;
      sources.push(source);
      bytes += size;
      boundary = Number(row.seq);
    }
    return {
      sources,
      boundary,
      cursor: Number(conversation.cursor),
      previous: checkpoint ? String(checkpoint.value) : "",
      projectId: conversation.project == null ? null : String(conversation.project),
      remember: Boolean(conversation.remember),
    };
  }
  publish(
    cid: string,
    cursor: number,
    boundary: number,
    value: MemoryGeneration,
    provider: string,
  ) {
    const range = this.range(cid);
    if (!range.remember || cursor !== range.cursor || boundary !== range.boundary)
      throw new Error("Memory sources changed while generating");
    const generation = validateMemoryGeneration(value, range.sources);
    const settings = this.settings();
    this.transaction(() => {
      this.db
        .prepare("INSERT OR REPLACE INTO checkpoints VALUES (?,?,?)")
        .run(cid, boundary, checkpointText(generation));
      for (const candidate of generation.memories) {
        if (!settings.generateTypes[candidate.type]) continue;
        this.saveCandidate(cid, range.projectId, candidate, range.sources, provider);
      }
      this.db.prepare("UPDATE conversations SET cursor=? WHERE id=?").run(boundary, cid);
    });
  }
  private saveCandidate(
    cid: string,
    project: string | null,
    candidate: MemoryCandidate,
    sources: MemorySource[],
    provider: string,
  ) {
    const fingerprint = normalize(candidate.text);
    const eventAt = sources.find((s) => s.id === candidate.citations[0]?.sourceId)?.at ?? now();
    const duplicate = this.db
      .prepare(
        "SELECT id FROM memories WHERE fingerprint=? AND project IS ? AND (scope='project' OR cid=?) AND type=? AND json_extract(value,'$.condition') IS ? AND json_extract(value,'$.subject')=? AND (type NOT IN ('episodic','history') OR json_extract(value,'$.eventAt')=?)",
      )
      .get(
        fingerprint,
        project,
        cid,
        candidate.type,
        candidate.condition,
        candidate.subject,
        eventAt,
      );
    if (duplicate) return;
    if (Number(this.db.prepare("SELECT count(*) AS n FROM memories").get()?.n) >= 100000)
      throw new Error("Memory record limit reached");
    const previous = this.db
      .prepare(
        "SELECT value FROM memories WHERE project IS ? AND (scope='project' OR cid=?) AND state IN ('active','disputed') AND json_extract(value,'$.subject')=? AND type=? AND json_extract(value,'$.condition') IS ? AND fingerprint<>? LIMIT 65",
      )
      .all(project, cid, candidate.subject, candidate.type, candidate.condition, fingerprint)
      .map((row) => parseValue(memoryRecordSchema, decode(row.value)));
    if (previous.length > 64) throw new Error("Too many conflicting memories for this subject");
    const human = candidate.citations.every(
      (c) => sources.find((s) => s.id === c.sourceId)?.role === "human",
    );
    const stamp = now();
    const record: MemoryRecord = {
      ...candidate,
      id: randomUUID(),
      version: 1,
      revision: 1,
      conversationId: cid,
      projectId: project,
      scope: project ? "project" : "conversation",
      evidence: human ? "user-stated" : "agent-reported",
      state: "active",
      pinned: false,
      createdAt: stamp,
      updatedAt: stamp,
      eventAt,
      provider,
      promptVersion: 1,
      supersedes: null,
      lastUsedAt: null,
    };
    if (previous.length && candidate.type !== "episodic" && candidate.type !== "history") {
      const protectedRecord = previous.some((r) => r.pinned || r.evidence === "human-edited");
      if (candidate.correction && human && !protectedRecord) {
        record.supersedes = previous[0]?.id ?? null;
        for (const r of previous)
          this.write({ ...r, state: "superseded", revision: r.revision + 1, updatedAt: stamp });
      } else {
        record.state = "disputed";
        for (const r of previous.filter((r) => !r.pinned && r.evidence !== "human-edited"))
          this.write({ ...r, state: "disputed", revision: r.revision + 1, updatedAt: stamp });
      }
    }
    this.write(record);
  }
  private write(value: MemoryRecord) {
    const record = parseValue(memoryRecordSchema, value);
    this.db
      .prepare(`INSERT INTO memories VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET project=excluded.project,cid=excluded.cid,scope=excluded.scope,
        type=excluded.type,state=excluded.state,created=excluded.created,
        fingerprint=excluded.fingerprint,value=excluded.value`)
      .run(
        record.id,
        record.projectId,
        record.conversationId,
        record.scope,
        record.type,
        record.state,
        record.createdAt,
        normalize(record.text),
        json(record),
      );
    this.db.prepare("DELETE FROM memory_fts WHERE id=?").run(record.id);
    this.db.prepare("INSERT INTO memory_fts(id,text) VALUES (?,?)").run(record.id, record.text);
    this.db
      .prepare("INSERT INTO revisions VALUES (?,?,?,?)")
      .run(record.id, record.revision, record.text, record.updatedAt);
    this.db.prepare("DELETE FROM vectors WHERE id=?").run(record.id);
  }
  browse(query: MemoryBrowse): MemoryPage {
    const clauses = ["1=1"];
    const values: (string | number)[] = [];
    for (const [field, value] of [
      ["project", query.projectId],
      ["cid", query.conversationId],
      ["type", query.type],
      ["state", query.state],
    ] as const) {
      if (value) {
        clauses.push(`${field}=?`);
        values.push(value);
      }
    }
    if (query.cursor) {
      clauses.push("rowid<(SELECT rowid FROM memories WHERE id=?)");
      values.push(query.cursor);
    }
    const rows = this.db
      .prepare(
        `SELECT value FROM memories WHERE ${clauses.join(" AND ")} ORDER BY rowid DESC LIMIT 26`,
      )
      .all(...values);
    const records = rows.slice(0, 25).map((r) => parseValue(memoryRecordSchema, decode(r.value)));
    return { records, next: rows.length > 25 ? (records.at(-1)?.id ?? null) : null };
  }
  detail(id: string): MemoryDetail {
    const row = this.db.prepare("SELECT value FROM memories WHERE id=?").get(id);
    if (!row) throw new Error("Memory was forgotten or is unavailable");
    const record = parseValue(memoryRecordSchema, decode(row.value));
    const sources = [...new Set(record.citations.map((c) => c.sourceId))].flatMap((id) => {
      const row = this.db.prepare("SELECT value FROM sources WHERE id=?").get(id);
      return row ? [parseValue(memorySourceSchema, decode(row.value))] : [];
    });
    const revisions = this.db
      .prepare("SELECT revision,text,at FROM revisions WHERE id=? ORDER BY revision DESC LIMIT 50")
      .all(id)
      .map((r) => ({ revision: Number(r.revision), text: String(r.text), at: String(r.at) }));
    return {
      record,
      sources,
      revisions,
      incomplete: sources.length !== new Set(record.citations.map((c) => c.sourceId)).size,
    };
  }
  action(action: MemoryAction) {
    if (action.type === "configure") return this.configure(action.settings);
    if (action.type === "remember") {
      this.conversation(action.conversationId);
      this.db
        .prepare("UPDATE conversations SET remember=? WHERE id=?")
        .run(Number(action.enabled), action.conversationId);
      return;
    }
    if (action.type === "forget-scope") {
      return this.transaction(() => {
        // Shared evidence retained for explicit global memories must never regenerate local ones.
        this.db
          .prepare(
            "INSERT OR IGNORE INTO suppressed_capture SELECT s.id FROM sources s JOIN conversations c ON c.id=s.cid WHERE c.project IS ?",
          )
          .run(action.projectId);
        this.db
          .prepare(
            `INSERT OR IGNORE INTO suppressed SELECT s.id FROM sources s JOIN conversations c ON c.id=s.cid WHERE c.project IS ?
            AND NOT EXISTS(SELECT 1 FROM memories m,json_each(m.value,'$.citations') citation
              WHERE m.scope='global' AND json_extract(citation.value,'$.sourceId')=s.id)`,
          )
          .run(action.projectId);
        this.db
          .prepare(
            "DELETE FROM checkpoints WHERE cid IN (SELECT id FROM conversations WHERE project IS ?)",
          )
          .run(action.projectId);
        this.db
          .prepare(
            "UPDATE conversations SET cursor=COALESCE((SELECT MAX(seq) FROM sources WHERE cid=conversations.id),cursor) WHERE project IS ?",
          )
          .run(action.projectId);
        this.db
          .prepare(
            "DELETE FROM sources WHERE cid IN (SELECT id FROM conversations WHERE project IS ?) AND id IN (SELECT source FROM suppressed)",
          )
          .run(action.projectId);
        for (;;) {
          const rows = this.db
            .prepare("SELECT id FROM memories WHERE project IS ? AND scope!='global' LIMIT 100")
            .all(action.projectId);
          if (!rows.length) break;
          for (const row of rows) this.forget(String(row.id), true);
        }
      });
    }
    if (!("id" in action)) throw new Error("Unsupported memory storage action");
    const record = this.detail(action.id).record;
    if (record.revision !== action.revision)
      throw new Error("Memory changed. Refresh before editing.");
    this.transaction(() => {
      if (action.type === "forget") return this.forget(record.id);
      const next = { ...record, revision: record.revision + 1, updatedAt: now() };
      if (action.type === "edit") {
        next.text = action.text;
        next.pinned = action.pinned;
        next.evidence = "human-edited";
        next.state = "active";
      } else if (action.type === "promote") next.scope = "global";
      else if (action.type === "resolve") {
        next.state = "active";
        next.evidence = "human-edited";
        next.pinned = true;
      }
      this.write(next);
    });
  }
  private forget(id: string, preserveGlobal = false) {
    const record = this.detail(id).record;
    const citations = record.citations.filter(
      (citation) =>
        !preserveGlobal ||
        !this.db
          .prepare(
            `SELECT 1 FROM memories m,json_each(m.value,'$.citations') c
      WHERE m.scope='global' AND json_extract(c.value,'$.sourceId')=? LIMIT 1`,
          )
          .get(citation.sourceId),
    );
    for (const citation of citations)
      this.db.prepare("INSERT OR IGNORE INTO suppressed VALUES (?)").run(citation.sourceId);
    for (const citation of citations)
      this.db.prepare("DELETE FROM sources WHERE id=?").run(citation.sourceId);
    this.db.prepare("DELETE FROM checkpoints WHERE cid=?").run(record.conversationId);
    if (!preserveGlobal)
      this.db.prepare("UPDATE conversations SET cursor=0 WHERE id=?").run(record.conversationId);
    this.db.prepare("DELETE FROM memories WHERE id=?").run(id);
    this.db.prepare("DELETE FROM revisions WHERE id=?").run(id);
    this.db.prepare("DELETE FROM vectors WHERE id=?").run(id);
    this.db.prepare("DELETE FROM memory_fts WHERE id=?").run(id);
  }
  eligible(cid: string, after = "", limit = 256, projects: readonly string[] = []): MemoryRecord[] {
    const conversation = this.conversation(cid);
    return this.db
      .prepare(`SELECT id,value FROM memories m WHERE id>? AND state='active' AND
      NOT EXISTS (SELECT 1 FROM json_each(m.value,'$.citations') c JOIN suppressed s ON s.source=json_extract(c.value,'$.sourceId')) AND
      (scope='global' OR (scope='conversation' AND cid=?) OR (scope='project' AND (project=? OR project IN (SELECT value FROM json_each(?)))))
      ORDER BY id LIMIT ?`)
      .all(
        after,
        cid,
        conversation.project == null ? null : String(conversation.project),
        json(projects),
        limit,
      )
      .map((row) => parseValue(memoryRecordSchema, decode(row.value)));
  }
  lexical(cid: string, query: string, projects: readonly string[] = []): string[] {
    const terms = query.match(/[\p{L}\p{N}_]{2,}/gu)?.slice(0, 32);
    if (!terms?.length) return [];
    const match = terms.map((s) => `"${s.replaceAll('"', '""')}"`).join(" OR ");
    const conversation = this.conversation(cid);
    const settings = this.settings();
    const cutoffs = Object.fromEntries(
      Object.entries(settings.retentionDays).map(([type, days]) => [
        type,
        days ? new Date(Date.now() - days * 86400000).toISOString() : "",
      ]),
    );
    return this.db
      .prepare(`SELECT m.id FROM memory_fts JOIN memories m ON m.id=memory_fts.id
      WHERE memory_fts MATCH ? AND m.state='active' AND
      json_extract(?, '$.' || m.type)=1 AND
      (json_extract(m.value,'$.pinned')=1 OR m.created>=json_extract(?, '$.' || m.type)) AND
      NOT EXISTS (SELECT 1 FROM json_each(m.value,'$.citations') c JOIN suppressed s ON s.source=json_extract(c.value,'$.sourceId')) AND
      (m.scope='global' OR (m.scope='conversation' AND m.cid=?) OR (m.scope='project' AND (m.project=? OR m.project IN (SELECT value FROM json_each(?)))))
      ORDER BY rank,m.id LIMIT 100`)
      .all(
        match,
        json(settings.types),
        json(cutoffs),
        cid,
        conversation.project == null ? null : String(conversation.project),
        json(projects),
      )
      .map((row) => String(row.id));
  }
  vectors(id: string, model: string): Float32Array[] {
    return this.db
      .prepare("SELECT value FROM vectors WHERE id=? AND model=? ORDER BY part")
      .all(id, model)
      .map((row) => {
        const bytes = row.value as Uint8Array;
        const copy = Uint8Array.from(bytes);
        return new Float32Array(copy.buffer);
      });
  }
  setVectors(id: string, model: string, vectors: Float32Array[]) {
    if (this.bytes() > 512 * 1_048_576) throw new Error("Memory storage quota reached");
    this.transaction(() => {
      this.db.prepare("DELETE FROM vectors WHERE id=?").run(id);
      for (const [part, vector] of vectors.entries())
        this.db
          .prepare("INSERT INTO vectors VALUES (?,?,?,?)")
          .run(
            id,
            part,
            model,
            new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength),
          );
    });
  }
  reindex() {
    this.db.exec("DELETE FROM vectors");
  }
  unindexed(model: string, limit = 8): MemoryRecord[] {
    return this.db
      .prepare(`SELECT value FROM memories m WHERE state='active' AND
      NOT EXISTS(SELECT 1 FROM vectors v WHERE v.id=m.id AND v.model=?)
      ORDER BY m.id LIMIT ?`)
      .all(model, limit)
      .map((r) => parseValue(memoryRecordSchema, decode(r.value)));
  }
  markUsed(ids: string[]) {
    const stamp = now();
    for (const id of ids.slice(0, 32))
      this.db
        .prepare("UPDATE memories SET value=json_set(value,'$.lastUsedAt',?) WHERE id=?")
        .run(stamp, id);
  }
  tail(cid: string): MemorySource[] {
    return this.db
      .prepare(`SELECT value FROM sources s WHERE cid=? AND committed=1 AND
      NOT EXISTS(SELECT 1 FROM suppressed WHERE source=s.id) AND
      NOT EXISTS(SELECT 1 FROM suppressed_capture WHERE source=s.id) ORDER BY seq DESC LIMIT 8`)
      .all(cid)
      .reverse()
      .map((row) => parseValue(memorySourceSchema, decode(row.value)));
  }
  checkpoint(cid: string): string {
    return String(
      this.db
        .prepare("SELECT value FROM checkpoints WHERE cid=? ORDER BY boundary DESC LIMIT 1")
        .get(cid)?.value ?? "",
    );
  }
  reserveCall(limit: number) {
    const day = now().slice(0, 10);
    this.transaction(() => {
      const used = Number(
        this.db.prepare("SELECT count FROM calls WHERE day=?").get(day)?.count ?? 0,
      );
      if (used >= limit) throw new Error("Memory generation reached its daily call limit");
      this.db.prepare("INSERT OR REPLACE INTO calls VALUES (?,?)").run(day, used + 1);
      this.db.prepare("DELETE FROM calls WHERE day<?").run(day);
    });
  }
  private bytes() {
    return (
      (Number(this.db.prepare("PRAGMA page_count").get()?.page_count ?? 0) -
        Number(this.db.prepare("PRAGMA freelist_count").get()?.freelist_count ?? 0)) *
      Number(this.db.prepare("PRAGMA page_size").get()?.page_size ?? 0)
    );
  }
  snapshot() {
    const settings = this.settings();
    for (const [type, days] of Object.entries(settings.retentionDays)) {
      if (!days) continue;
      const cutoff = new Date(Date.now() - days * 86400000).toISOString();
      const records = this.db
        .prepare(
          "SELECT value FROM memories WHERE type=? AND state='active' AND created<? LIMIT 256",
        )
        .all(type, cutoff);
      for (const row of records) {
        const r = parseValue(memoryRecordSchema, decode(row.value));
        if (!r.pinned) this.write({ ...r, state: "stale", revision: r.revision + 1 });
      }
    }
    return {
      settings,
      count: Number(this.db.prepare("SELECT count(*) AS n FROM memories").get()?.n),
      bytes: this.bytes(),
      dailyCalls: Number(
        this.db.prepare("SELECT count FROM calls WHERE day=?").get(now().slice(0, 10))?.count ?? 0,
      ),
      indexPending: Number(
        this.db
          .prepare(
            "SELECT count(*) AS n FROM memories m WHERE state='active' AND NOT EXISTS(SELECT 1 FROM vectors v WHERE v.id=m.id)",
          )
          .get()?.n ?? 0,
      ),
      projects: this.db.prepare("SELECT id,label FROM projects ORDER BY label LIMIT 500").all(),
      conversations: this.db
        .prepare("SELECT id,label,remember FROM conversations ORDER BY rowid DESC LIMIT 500")
        .all()
        .map((r) => ({ id: String(r.id), label: String(r.label), remember: Boolean(r.remember) })),
    };
  }
}
