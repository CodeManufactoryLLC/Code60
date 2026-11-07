import { randomUUID } from "node:crypto";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { privateDirectory, verifyPrivateSync } from "../platform/index.js";
import { filePreferences } from "./preferences.js";
import { openProjectDatabase, sqliteAvailable } from "./projects.js";

async function expectPrivate(path: string, mode: number): Promise<void> {
  if (process.platform === "win32") expect(() => verifyPrivateSync(path)).not.toThrow();
  else expect((await stat(path)).mode & 0o777).toBe(mode);
}

let directory: string;
beforeEach(async () => {
  directory = join(tmpdir(), `code60-projects-${randomUUID()}`);
  await privateDirectory(directory);
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

// Node.js 22.12 needs a flag for node:sqlite; the desktop app runs on Electron's newer Node.js.
describe.skipIf(!sqliteAvailable())("project database", () => {
  const sqlite = () => process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");

  it.runIf(process.platform === "win32")(
    "bounds a real competing writer and works after the lock is released",
    () => {
      const path = join(directory, "contended.sqlite");
      const db = openProjectDatabase(path, true);
      const other = new (sqlite().DatabaseSync)(path);
      try {
        other.exec("BEGIN EXCLUSIVE");
        let error: unknown;
        const started = performance.now();
        try {
          db.record("C:\\project", "2026-01-01");
        } catch (cause) {
          error = cause;
        }
        const elapsed = performance.now() - started;
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toMatch(/locked/);
        expect(elapsed).toBeLessThan(150);
        other.exec("ROLLBACK");
        db.record("C:\\project", "2026-01-01");
        expect(db.list()).toEqual([{ path: "C:\\project", openedAt: "2026-01-01" }]);
      } finally {
        other.close();
        db.close();
      }
    },
  );

  it("migrates schema 1 without losing project history and persists configurations", () => {
    const path = join(directory, "old.sqlite");
    const old = new (sqlite().DatabaseSync)(path);
    old.exec(
      "CREATE TABLE code60_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);" +
        "INSERT INTO code60_meta VALUES ('app', 'code60'), ('schema', '1');" +
        "CREATE TABLE code60_projects (path TEXT PRIMARY KEY, opened_at TEXT NOT NULL);" +
        "INSERT INTO code60_projects VALUES ('/repo', '2026-01-01');",
    );
    old.close();
    const db = openProjectDatabase(path, false);
    expect(db.list()).toEqual([{ path: "/repo", openedAt: "2026-01-01" }]);
    expect(db.configurations()).toEqual([]);
    expect(db.promptTemplates()).toEqual({ templates: {}, skipped: [] });
    const settings = {
      agents: ["claude", "codex"],
      parallel: "2",
      allow: ["read"],
      allowAll: false,
    };
    db.saveConfiguration({ id: "team", name: "Team", settings, uses: 0, lastUsed: null });
    expect(() =>
      db.saveConfiguration({ id: "other", name: "TEAM", settings, uses: 0, lastUsed: null }),
    ).toThrow(/already exists/);
    db.useConfiguration("team", "2026-02-01T12:00:00.000Z");
    db.saveConfiguration({ id: "team", name: "Renamed", settings, uses: 0, lastUsed: null });
    db.clear();
    db.close();
    const again = openProjectDatabase(path, false);
    expect(again.configurations()).toEqual([
      { id: "team", name: "Renamed", settings, uses: 1, lastUsed: "2026-02-01T12:00:00.000Z" },
    ]);
    again.deleteConfiguration("team");
    expect(again.configurations()).toEqual([]);
    again.close();
  });

  it("upgrades schema 2 in place and keeps saved prompt template edits", () => {
    const path = join(directory, "v2.sqlite");
    const old = new (sqlite().DatabaseSync)(path);
    old.exec(
      "CREATE TABLE code60_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);" +
        "INSERT INTO code60_meta VALUES ('app', 'code60'), ('schema', '2');" +
        "CREATE TABLE code60_projects (path TEXT PRIMARY KEY, opened_at TEXT NOT NULL);" +
        "INSERT INTO code60_projects VALUES ('/repo', '2026-01-01');" +
        "CREATE TABLE code60_run_configurations (id TEXT PRIMARY KEY, name TEXT NOT NULL, " +
        "name_key TEXT NOT NULL UNIQUE, settings TEXT NOT NULL, uses INTEGER NOT NULL, last_used TEXT);",
    );
    old.close();
    const db = openProjectDatabase(path, false);
    expect(db.list()).toEqual([{ path: "/repo", openedAt: "2026-01-01" }]);
    expect(db.promptTemplates()).toEqual({ templates: {}, skipped: [] });
    db.savePromptTemplate("handoffTurn", "Hi {{message}}", "2026-02-01");
    db.savePromptTemplate("handoffTurn", "Again {{message}}", "2026-02-02");
    expect(() => db.savePromptTemplate("handoffTurn", "{{summary}}", "2026-02-03")).toThrow(
      /must include/,
    );
    db.close();
    const again = openProjectDatabase(path, false);
    expect(again.promptTemplates().templates).toEqual({ handoffTurn: "Again {{message}}" });
    again.deletePromptTemplate("handoffTurn");
    again.deletePromptTemplate("handoffSummary");
    expect(again.promptTemplates().templates).toEqual({});
    again.close();
    const check = new (sqlite().DatabaseSync)(path);
    expect(check.prepare("SELECT value FROM code60_meta WHERE key = 'schema'").get()).toEqual({
      value: "3",
    });
    check.close();
  });

  it("skips saved prompt templates that are unknown or invalid", () => {
    const path = join(directory, "prompts.sqlite");
    openProjectDatabase(path, true).close();
    const raw = new (sqlite().DatabaseSync)(path);
    raw.exec(
      "INSERT INTO code60_prompt_templates VALUES ('handoffTurn', '{{summary}}', 'x');" +
        "INSERT INTO code60_prompt_templates VALUES ('other', 'x', 'x');" +
        "INSERT INTO code60_prompt_templates VALUES ('handoffSummary', 'S {{status}}', 'x');",
    );
    raw.close();
    const db = openProjectDatabase(path, false);
    const saved = db.promptTemplates();
    db.close();
    expect(saved.templates).toEqual({ handoffSummary: "S {{status}}" });
    expect(saved.skipped).toEqual([
      "Ignored the saved handoffTurn prompt template: it must include {{message}}",
      "Ignored a saved prompt template with an unknown ID: other",
    ]);
  });

  it("creates a private database and keeps history across connections, newest first", async () => {
    const path = join(directory, "code60.sqlite");
    const first = openProjectDatabase(path, true);
    first.record("/repos/a", "2026-01-01T00:00:00.000Z");
    first.record("/repos/b", "2026-01-02T00:00:00.000Z");
    first.record("/repos/a", "2026-01-03T00:00:00.000Z");
    first.close();
    await expectPrivate(path, 0o600);
    const second = openProjectDatabase(path, false);
    expect(second.list()).toEqual([
      { path: "/repos/a", openedAt: "2026-01-03T00:00:00.000Z" },
      { path: "/repos/b", openedAt: "2026-01-02T00:00:00.000Z" },
    ]);
    second.remove("/repos/a");
    second.remove("/repos/unknown");
    expect(second.list()).toEqual([{ path: "/repos/b", openedAt: "2026-01-02T00:00:00.000Z" }]);
    second.clear();
    expect(second.list()).toEqual([]);
    second.close();
    const third = openProjectDatabase(path, false);
    expect(third.list()).toEqual([]);
    third.close();
  });

  it("creates a private sibling workspace and preserves existing contents on reconnect", async () => {
    const path = join(directory, "code60.sqlite");
    const workspace = join(directory, ".code60_workspace");
    openProjectDatabase(path, true).close();
    expect((await stat(workspace)).isDirectory()).toBe(true);
    await expectPrivate(workspace, 0o700);
    const marker = join(workspace, "keep.txt");
    await writeFile(marker, "existing workspace data");
    openProjectDatabase(path, false).close();
    expect(await readFile(marker, "utf8")).toBe("existing workspace data");
  });

  it("recreates a missing sibling workspace when opening an existing database", async () => {
    const path = join(directory, "code60.sqlite");
    const workspace = join(directory, ".code60_workspace");
    const first = openProjectDatabase(path, true);
    first.record("/repos/keep", "2026-01-01");
    first.close();
    await rm(workspace, { recursive: true });
    const again = openProjectDatabase(path, false);
    try {
      expect((await stat(workspace)).isDirectory()).toBe(true);
      expect(again.list()).toEqual([{ path: "/repos/keep", openedAt: "2026-01-01" }]);
    } finally {
      again.close();
    }
  });

  it("reports a conflicting workspace file without replacing it or damaging the database", async () => {
    const path = join(directory, "code60.sqlite");
    const workspace = join(directory, ".code60_workspace");
    openProjectDatabase(path, true).close();
    await rm(workspace, { recursive: true });
    await writeFile(workspace, "keep this file");
    expect(() => openProjectDatabase(path, false)).toThrow(/Could not open.*code60.sqlite/);
    expect(await readFile(workspace, "utf8")).toBe("keep this file");
    await rm(workspace);
    const again = openProjectDatabase(path, false);
    try {
      expect(again.list()).toEqual([]);
    } finally {
      again.close();
    }
  });

  it("never creates a missing database when opening an existing one", async () => {
    const path = join(directory, "missing.sqlite");
    expect(() => openProjectDatabase(path, false)).toThrow(/not found/);
    await expect(stat(path)).rejects.toThrow();
    await expect(stat(join(directory, ".code60_workspace"))).rejects.toThrow();
  });

  it("rejects other SQLite databases and leaves their data untouched", () => {
    const path = join(directory, "other.sqlite");
    const other = new (sqlite().DatabaseSync)(path);
    other.exec("CREATE TABLE notes (text TEXT); INSERT INTO notes VALUES ('keep');");
    other.close();
    expect(() => openProjectDatabase(path, true)).toThrow(/not a Code60 database/);
    const check = new (sqlite().DatabaseSync)(path);
    expect(check.prepare("SELECT name FROM sqlite_master").all()).toEqual([{ name: "notes" }]);
    expect(check.prepare("SELECT text FROM notes").all()).toEqual([{ text: "keep" }]);
    check.close();
  });

  it("rejects databases from a newer version", () => {
    const path = join(directory, "newer.sqlite");
    openProjectDatabase(path, true).close();
    const db = new (sqlite().DatabaseSync)(path);
    db.exec("UPDATE code60_meta SET value = '4' WHERE key = 'schema'");
    db.close();
    expect(() => openProjectDatabase(path, false)).toThrow(/newer version/);
  });

  it("rejects files that are not databases without changing them", async () => {
    const path = join(directory, "notes.db");
    await writeFile(path, "plain text that is not SQLite\n".repeat(20));
    expect(() => openProjectDatabase(path, false)).toThrow(/Could not open/);
    expect(await readFile(path, "utf8")).toBe("plain text that is not SQLite\n".repeat(20));
  });
});

describe("desktop preferences", () => {
  it("defaults release checks on and preserves the switch across concurrent writes and restarts", async () => {
    const file = join(directory, "desktop.json");
    const preferences = filePreferences(file);
    expect(await preferences.updateCheck()).toBe(true);
    await Promise.all([
      preferences.setUpdateCheck(false),
      preferences.write("/data/projects.sqlite"),
      preferences.setTransparent(true),
    ]);
    const again = filePreferences(file);
    expect(await again.updateCheck()).toBe(false);
    expect(await again.read()).toBe("/data/projects.sqlite");
    expect(await again.transparent()).toBe(true);
    await again.setUpdateCheck(true);
    expect(await filePreferences(file).updateCheck()).toBe(true);
    for (const value of [null, [], { updateCheck: "false" }, { updateCheck: 0 }]) {
      await writeFile(file, JSON.stringify(value));
      expect(await preferences.updateCheck()).toBe(true);
    }
  });
  it("preserves database and appearance settings across concurrent writes and restarts", async () => {
    const file = join(directory, "desktop.json");
    const preferences = filePreferences(file);
    expect(await preferences.transparent()).toBe(false);
    await Promise.all([preferences.write("/data/code60.sqlite"), preferences.setTransparent(true)]);
    const again = filePreferences(file);
    expect(await again.read()).toBe("/data/code60.sqlite");
    expect(await again.transparent()).toBe(true);
    await again.write("/data/other.sqlite");
    expect(await again.transparent()).toBe(true);
    await again.setTransparent(false);
    expect(await again.read()).toBe("/data/other.sqlite");
    expect(await again.transparent()).toBe(false);
    await expectPrivate(file, 0o600);
  });

  it("stores validated polling overrides beside other preferences", async () => {
    const file = join(directory, "desktop.json");
    const preferences = filePreferences(file);
    expect(await preferences.polling()).toEqual({});
    const history = { intervalMs: 10000, idleIntervalMs: 60000 };
    await Promise.all([
      preferences.write("/data/code60.sqlite"),
      preferences.setPolling({ history }),
    ]);
    expect(await preferences.polling()).toEqual({ history });
    expect(await preferences.read()).toBe("/data/code60.sqlite");
    await expect(
      preferences.setPolling({ history: { intervalMs: 1, idleIntervalMs: 1 } }),
    ).rejects.toThrow();
    await writeFile(file, JSON.stringify({ polling: { history: { intervalMs: 1 } } }));
    await expect(preferences.polling()).rejects.toThrow();
  });

  it("enables transparency only for an explicit boolean true", async () => {
    const file = join(directory, "desktop.json");
    for (const value of [null, [], { transparent: "true" }, { transparent: 1 }]) {
      await writeFile(file, JSON.stringify(value));
      expect(await filePreferences(file).transparent()).toBe(false);
    }
  });

  it("remembers the database path and ignores missing or invalid files", async () => {
    const file = join(directory, "state", "desktop.json");
    const preferences = filePreferences(file);
    expect(await preferences.read()).toBeUndefined();
    await preferences.write("/data/code60.sqlite");
    expect(await preferences.read()).toBe("/data/code60.sqlite");
    await expectPrivate(file, 0o600);
    await writeFile(file, "{not json");
    expect(await preferences.read()).toBeUndefined();
    await writeFile(file, JSON.stringify({ database: "relative.sqlite" }));
    expect(await preferences.read()).toBeUndefined();
  });

  it("persists the orchestration provider alongside concurrent desktop preferences", async () => {
    const file = join(directory, "desktop.json");
    const preferences = filePreferences(file);
    expect(await preferences.orchestrationProvider()).toBeNull();
    await Promise.all([
      preferences.write("/data/projects.sqlite"),
      preferences.setTransparent(true),
      preferences.setOrchestrationProvider("claude"),
    ]);
    const again = filePreferences(file);
    expect(await again.orchestrationProvider()).toBe("claude");
    expect(await again.read()).toBe("/data/projects.sqlite");
    expect(await again.transparent()).toBe(true);
    await again.setOrchestrationProvider(null);
    expect(await again.orchestrationProvider()).toBeNull();
    await writeFile(
      file,
      JSON.stringify({ orchestrationProvider: { provider: "claude", allowAll: false } }),
    );
    await expect(again.orchestrationProvider()).rejects.toThrow();
  });
});
