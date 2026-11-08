import { chmodSync, existsSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  PROMPT_IDS,
  type ProjectEntry,
  type PromptId,
  type PromptTemplates,
  parseRunSettings,
  type RunConfiguration,
  validatePromptTemplate,
} from "../bridge/index.js";
import {
  createPrivateFileSync,
  diagnosticMessage,
  privateDirectorySync,
} from "../platform/index.js";

/** Saved template edits; rows that cannot be used are described in `skipped`, never applied. */
export interface SavedPromptTemplates {
  templates: Partial<PromptTemplates>;
  skipped: string[];
}

/** Repository history kept in a user-selected SQLite file. */
export interface ProjectDatabase {
  readonly path: string;
  list(): ProjectEntry[];
  record(path: string, openedAt: string): void;
  remove(path: string): void;
  clear(): void;
  configurations(): RunConfiguration[];
  saveConfiguration(configuration: RunConfiguration): void;
  deleteConfiguration(id: string): void;
  useConfiguration(id: string, at: string): void;
  promptTemplates(): SavedPromptTemplates;
  savePromptTemplate(id: PromptId, template: string, at: string): void;
  deletePromptTemplate(id: PromptId): void;
  close(): void;
}

export type OpenProjectDatabase = (path: string, create: boolean) => ProjectDatabase;

const APP = "code60";
export const SCHEMA = 3;
const CONFIG_TABLE =
  "CREATE TABLE code60_run_configurations (" +
  "id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE, " +
  "settings TEXT NOT NULL, uses INTEGER NOT NULL, last_used TEXT)";
const PROMPT_TABLE =
  "CREATE TABLE code60_prompt_templates (" +
  "id TEXT PRIMARY KEY, template TEXT NOT NULL, updated_at TEXT NOT NULL)";
const HISTORY_LIMIT = 200;
const message = diagnosticMessage;

export function sqliteAvailable(): boolean {
  try {
    return process.getBuiltinModule("node:sqlite") !== undefined;
  } catch {
    return false;
  }
}

function sqlite(): typeof import("node:sqlite") {
  // Loaded lazily: Node.js 22.12 exposes node:sqlite only behind a flag, while Electron's Node.js has it.
  if (!sqliteAvailable()) throw new Error("This runtime has no built-in SQLite support");
  return process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
}

function prepare(db: DatabaseSync, path: string): void {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => row.name);
  if (tables.length === 0) {
    db.exec("BEGIN");
    try {
      db.exec(
        "CREATE TABLE code60_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);" +
          "CREATE TABLE code60_projects (path TEXT PRIMARY KEY, opened_at TEXT NOT NULL);",
      );
      db.exec(CONFIG_TABLE);
      db.exec(PROMPT_TABLE);
      const insert = db.prepare("INSERT INTO code60_meta (key, value) VALUES (?, ?)");
      insert.run("app", APP);
      insert.run("schema", String(SCHEMA));
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return;
  }
  if (!tables.includes("code60_meta")) throw new Error(`${path} is not a Code60 database`);
  const meta = new Map(
    db
      .prepare("SELECT key, value FROM code60_meta")
      .all()
      .map((row) => [String(row.key), String(row.value)]),
  );
  if (meta.get("app") !== APP || !tables.includes("code60_projects"))
    throw new Error(`${path} is not a Code60 database`);
  const schema = Number(meta.get("schema"));
  if (schema > SCHEMA) throw new Error(`${path} was created by a newer version of Code60`);
  if (schema === 1 || schema === 2) {
    db.exec("BEGIN");
    try {
      if (schema === 1) db.exec(CONFIG_TABLE);
      db.exec(PROMPT_TABLE);
      db.prepare("UPDATE code60_meta SET value = ? WHERE key = 'schema'").run(String(SCHEMA));
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } else if (schema !== SCHEMA)
    throw new Error(`${path} has an unsupported Code60 database format`);
}

/**
 * Opens a project database. An empty or new file is initialized; any other existing database must
 * already be a Code60 database and is never modified otherwise.
 */
export const openProjectDatabase: OpenProjectDatabase = (path, create) => {
  const existed = existsSync(path);
  if (!existed && !create) throw new Error(`Database not found: ${path}`);
  if (existed && !statSync(path).isFile()) throw new Error(`Not a database file: ${path}`);
  const { DatabaseSync } = sqlite();
  let db: DatabaseSync | undefined;
  try {
    if (!existed) createPrivateFileSync(path);
    db = new DatabaseSync(path);
    // DatabaseSync runs on the main thread. A contending writer must fail promptly,
    // not freeze cancellation and the window for the previous two-second timeout.
    db.exec(`PRAGMA busy_timeout = ${process.platform === "win32" ? 0 : 2000}`);
    prepare(db, path);
    if (!existed) chmodSync(path, 0o600);
    privateDirectorySync(join(dirname(path), ".code60_workspace"));
  } catch (error) {
    db?.close();
    if (!existed) rmSync(path, { force: true });
    const text = message(error);
    throw new Error(text.startsWith(path) ? text : `Could not open ${path}: ${text}`);
  }
  const database = db;
  const list = database.prepare(
    "SELECT path, opened_at FROM code60_projects ORDER BY opened_at DESC, path LIMIT ?",
  );
  const record = database.prepare(
    "INSERT INTO code60_projects (path, opened_at) VALUES (?, ?) " +
      "ON CONFLICT (path) DO UPDATE SET opened_at = excluded.opened_at",
  );
  const remove = database.prepare("DELETE FROM code60_projects WHERE path = ?");
  const clear = database.prepare("DELETE FROM code60_projects");
  return {
    path,
    list: () =>
      list
        .all(HISTORY_LIMIT)
        .map((row) => ({ path: String(row.path), openedAt: String(row.opened_at) })),
    record: (project, openedAt) => {
      record.run(project, openedAt);
    },
    remove: (project) => {
      remove.run(project);
    },
    clear: () => {
      clear.run();
    },
    configurations: () =>
      database
        .prepare(
          "SELECT id, name, settings, uses, last_used FROM code60_run_configurations ORDER BY name_key, id",
        )
        .all()
        .map((row) => ({
          id: String(row.id),
          name: String(row.name),
          settings: parseRunSettings(JSON.parse(String(row.settings))),
          uses: Number(row.uses),
          lastUsed: row.last_used === null ? null : String(row.last_used),
        })),
    saveConfiguration: (entry) => {
      const duplicate = database
        .prepare("SELECT id FROM code60_run_configurations WHERE name_key = ? AND id != ?")
        .get(entry.name.toLowerCase(), entry.id);
      if (duplicate) throw new Error("A run configuration with that name already exists");
      database
        .prepare(
          "INSERT INTO code60_run_configurations (id, name, name_key, settings, uses, last_used) VALUES (?, ?, ?, ?, ?, ?) " +
            "ON CONFLICT(id) DO UPDATE SET name = excluded.name, name_key = excluded.name_key, settings = excluded.settings",
        )
        .run(
          entry.id,
          entry.name,
          entry.name.toLowerCase(),
          JSON.stringify(parseRunSettings(entry.settings)),
          entry.uses,
          entry.lastUsed,
        );
    },
    deleteConfiguration: (id) => {
      database.prepare("DELETE FROM code60_run_configurations WHERE id = ?").run(id);
    },
    useConfiguration: (id, at) => {
      database
        .prepare("UPDATE code60_run_configurations SET uses = uses + 1, last_used = ? WHERE id = ?")
        .run(at, id);
    },
    promptTemplates: () => {
      const saved: SavedPromptTemplates = { templates: {}, skipped: [] };
      const rows = database
        .prepare("SELECT id, template FROM code60_prompt_templates ORDER BY id")
        .all();
      for (const row of rows) {
        const id = String(row.id);
        if (!PROMPT_IDS.some((known) => known === id)) {
          saved.skipped.push(`Ignored a saved prompt template with an unknown ID: ${id}`);
          continue;
        }
        const template = String(row.template);
        const problem = validatePromptTemplate(id as PromptId, template);
        if (problem) {
          saved.skipped.push(`Ignored the saved ${id} prompt template: it ${problem}`);
          continue;
        }
        saved.templates[id as PromptId] = template;
      }
      return saved;
    },
    savePromptTemplate: (id, template, at) => {
      const problem = validatePromptTemplate(id, template);
      if (problem) throw new Error(`The ${id} prompt template ${problem}`);
      database
        .prepare(
          "INSERT INTO code60_prompt_templates (id, template, updated_at) VALUES (?, ?, ?) " +
            "ON CONFLICT(id) DO UPDATE SET template = excluded.template, updated_at = excluded.updated_at",
        )
        .run(id, template, at);
    },
    deletePromptTemplate: (id) => {
      database.prepare("DELETE FROM code60_prompt_templates WHERE id = ?").run(id);
    },
    close: () => {
      if (database.isOpen) database.close();
    },
  };
};
