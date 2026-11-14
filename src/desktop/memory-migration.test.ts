import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_MEMORY_SETTINGS, type MemorySource } from "../bridge/index.js";
import { migrateMemorySettings } from "./memory-migration.js";
import { MemoryStore } from "./memory-store.js";
import { sqliteAvailable } from "./projects.js";

const legacy = () => ({
  enabled: true,
  relay: true,
  project: true,
  worker: true,
  continuity: true,
  capture: true,
  recall: true,
  generation: true,
  rolloverPercent: 70,
  capacity: 128000,
  checkpointTokens: 2000,
  recallTokens: 4000,
  cadenceSeconds: 30,
  dailyCalls: 50,
  types: { episodic: true, semantic: true, lesson: true, history: true },
  generateTypes: { episodic: true, semantic: true, lesson: true, history: true },
  retentionDays: { episodic: 0, semantic: 0, lesson: 0, history: 0 },
});

describe("private memory settings migration", () => {
  it("keeps defaults enabled and removes legacy budgets and tuning preferences", () => {
    expect(migrateMemorySettings(undefined, false)).toEqual(DEFAULT_MEMORY_SETTINGS);
    expect(migrateMemorySettings(legacy(), false)).toEqual(DEFAULT_MEMORY_SETTINGS);
    expect(migrateMemorySettings({ ...legacy(), dailyCalls: 1, capacity: 32000 }, false)).toEqual(
      DEFAULT_MEMORY_SETTINGS,
    );
  });
  it("maps every legacy learning, recall, type, role, retention and conversation restriction to Off", () => {
    for (const key of [
      "enabled",
      "relay",
      "project",
      "worker",
      "continuity",
      "capture",
      "recall",
      "generation",
    ]) {
      expect(migrateMemorySettings({ ...legacy(), [key]: false }, false).enabled).toBe(false);
    }
    for (const key of ["episodic", "semantic", "lesson", "history"]) {
      const old = legacy();
      expect(
        migrateMemorySettings({ ...old, types: { ...old.types, [key]: false } }, false).enabled,
      ).toBe(false);
      expect(
        migrateMemorySettings(
          { ...old, generateTypes: { ...old.generateTypes, [key]: false } },
          false,
        ).enabled,
      ).toBe(false);
      expect(
        migrateMemorySettings(
          { ...old, retentionDays: { ...old.retentionDays, [key]: 30 } },
          false,
        ),
      ).toEqual({ ...DEFAULT_MEMORY_SETTINGS, enabled: false });
    }
    expect(migrateMemorySettings({ ...legacy(), recallTokens: 0 }, false).enabled).toBe(false);
    expect(migrateMemorySettings(legacy(), true).enabled).toBe(false);
    expect(migrateMemorySettings(undefined, true).enabled).toBe(false);
  });
  it("rejects malformed or unknown legacy fields rather than silently enabling memory", () => {
    for (const invalid of [
      { ...legacy(), capture: "true" },
      { ...legacy(), capacity: 0 },
      { ...legacy(), retentionDays: { episodic: 0 } },
      { ...legacy(), unexpected: true },
    ])
      expect(() => migrateMemorySettings(invalid, false)).toThrow();
  });
  it.skipIf(!sqliteAvailable())(
    "migrates a v1 database atomically without deleting saved memories or citations",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "code60-memory-migration-"));
      let store = new MemoryStore(root);
      try {
        const conversation = store.register("old", "Old chat", null);
        const source: MemorySource = {
          id: randomUUID(),
          conversationId: conversation.id,
          role: "human",
          at: new Date().toISOString(),
          text: "Keep this evidence.",
          ordinal: 1,
          start: 0,
        };
        store.append(conversation.id, "1", [source], true);
        const range = store.range(conversation.id);
        const citations = [
          { sourceId: source.id, start: 0, end: source.text.length, quote: source.text },
        ];
        store.publish(
          conversation.id,
          range.cursor,
          range.boundary,
          {
            goal: "",
            constraints: [],
            decisions: [],
            attempts: [],
            questions: [],
            next: "",
            citations,
            memories: [
              {
                type: "semantic",
                text: source.text,
                subject: "retained",
                condition: "",
                correction: false,
                citations,
              },
            ],
          },
          "fixture",
        );
        const record = store.browse({}).records[0];
        if (!record) throw new Error("Missing migration fixture");
        store.close();
        const sqlite = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
        const db = new sqlite.DatabaseSync(join(root, "memory.sqlite"));
        try {
          db.prepare("UPDATE meta SET value=? WHERE key='settings'").run(JSON.stringify(legacy()));
          db.exec(
            "UPDATE conversations SET remember=0; CREATE TABLE calls(day TEXT,count INTEGER); PRAGMA user_version=1;",
          );
        } finally {
          db.close();
        }
        store = new MemoryStore(root);
        expect(store.settings()).toEqual({ ...DEFAULT_MEMORY_SETTINGS, enabled: false });
        expect(store.snapshot().count).toBe(1);
        expect(store.detail(record.id).sources).toEqual([source]);
        expect(store.detail(record.id).incomplete).toBe(false);
        expect(store.range(conversation.id).sources).toEqual([]);
        store.configure(DEFAULT_MEMORY_SETTINGS);
        expect(store.eligible(conversation.id).map((r) => r.id)).toEqual([record.id]);
        store.close();
        store = new MemoryStore(root);
        expect(store.settings()).toEqual(DEFAULT_MEMORY_SETTINGS);
      } finally {
        store.close();
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
