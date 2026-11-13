import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MEMORY_SETTINGS,
  type MemoryGeneration,
  type MemorySource,
} from "../bridge/index.js";
import type { RagEmbedder } from "../core/index.js";
import { MemoryStore } from "./memory-store.js";
import { indexMemoryBatch, memorySearch } from "./memory-worker.js";
import { sqliteAvailable } from "./projects.js";

let dir: string;
let db: MemoryStore;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "code60-memory-index-"));
  db = new MemoryStore(join(dir, "memory"));
});
afterEach(async () => {
  db.close();
  await rm(dir, { recursive: true, force: true });
});
function seed(cid: string, count: number, label: string) {
  const s: MemorySource = {
    id: randomUUID(),
    conversationId: cid,
    role: "human",
    at: new Date().toISOString(),
    ordinal: 1,
    start: 0,
    text: `${label} evidence`,
  };
  db.append(cid, "1", [s], true);
  const citations = [{ sourceId: s.id, start: 0, end: s.text.length, quote: s.text }];
  const value: MemoryGeneration = {
    goal: "",
    constraints: [],
    decisions: [],
    attempts: [],
    questions: [],
    next: "",
    citations,
    memories: Array.from({ length: count }, (_, i) => ({
      type: "episodic",
      text: `${label} ${i} ${"word ".repeat(150)}`,
      subject: `${label}-${i}`,
      condition: "",
      correction: false,
      citations,
    })),
  };
  const range = db.range(cid);
  db.publish(cid, range.cursor, range.boundary, value, "fixture");
}
const vector = () => Float32Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0));
describe.skipIf(!sqliteAvailable())("memory index", () => {
  it("filters disabled and expired lexical matches before the 100-result limit", async () => {
    const c = db.register("filters", "Filters", null);
    for (let i = 0; i < 4; i++) seed(c.id, 30, `cache${i}`);
    const source: MemorySource = {
      id: randomUUID(),
      conversationId: c.id,
      role: "human",
      at: new Date().toISOString(),
      ordinal: 1,
      start: 0,
      text: "cache0 cache1 cache2 cache3",
    };
    db.append(c.id, "semantic", [source], true);
    const citations = [
      { sourceId: source.id, start: 0, end: source.text.length, quote: source.text },
    ];
    const range = db.range(c.id);
    db.publish(
      c.id,
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
            text: "cache0 cache1 cache2 cache3 guidance",
            subject: "enabled",
            condition: "",
            correction: false,
            citations,
          },
        ],
      },
      "fixture",
    );
    db.configure({
      ...DEFAULT_MEMORY_SETTINGS,
      types: { ...DEFAULT_MEMORY_SETTINGS.types, episodic: false },
    });
    const offline = async (): Promise<RagEmbedder> => {
      throw new Error("offline");
    };
    expect(
      (await memorySearch(db, c.id, "cache0 cache1 cache2 cache3", offline)).records.map(
        (r) => r.type,
      ),
    ).toEqual(["semantic"]);
    db.configure({
      ...DEFAULT_MEMORY_SETTINGS,
      retentionDays: { ...DEFAULT_MEMORY_SETTINGS.retentionDays, episodic: 1 },
    });
    const later = Date.now() + 2 * 86400000;
    const now = vi.spyOn(Date, "now").mockReturnValue(later);
    try {
      expect(
        (await memorySearch(db, c.id, "cache0 cache1 cache2 cache3", offline)).records.map(
          (r) => r.type,
        ),
      ).toEqual(["semantic"]);
    } finally {
      now.mockRestore();
    }
  });
  it("indexes bounded exact-span batches incrementally and exposes incomplete semantic recall", async () => {
    const c = db.register("c", "Chat", null);
    seed(c.id, 9, "Redis");
    let documents = 0;
    const model: RagEmbedder = {
      countTokens: (text) => text.length + 2,
      embedDocuments: async (texts) => {
        expect(texts.length).toBeLessThanOrEqual(4);
        for (const text of texts) expect(text.length + 2).toBeLessThanOrEqual(512);
        documents += texts.length;
        return texts.map(vector);
      },
      embedQuery: async () => vector(),
    };
    const initial = await memorySearch(db, c.id, "Redis", async () => model);
    expect(initial.records).toHaveLength(9);
    expect(initial.warning).toContain("incomplete");
    expect(db.snapshot().indexPending).toBe(9);
    expect(await indexMemoryBatch(db, async () => model)).toBe(true);
    expect(db.snapshot().indexPending).toBe(1);
    expect(await indexMemoryBatch(db, async () => model)).toBe(true);
    expect(await indexMemoryBatch(db, async () => model)).toBe(false);
    expect(documents).toBeGreaterThan(9);
    const first = await memorySearch(db, c.id, "paraphrase", async () => model);
    const again = await memorySearch(db, c.id, "paraphrase", async () => model);
    expect(first.records).toHaveLength(9);
    expect(first.warning).toBeUndefined();
    expect(first.records.map((r) => r.id)).toEqual(again.records.map((r) => r.id));
    db.reindex();
    expect(db.snapshot().indexPending).toBe(9);
  });
  it("filters host-authorized multi-target Relay scopes before ranking and rechecks native identities", async () => {
    const a = join(dir, "a"),
      b = join(dir, "b");
    await mkdir(a);
    await mkdir(b);
    const one = db.register("one", "One", a),
      two = db.register("two", "Two", b),
      relay = db.register("relay", "Relay", null);
    seed(one.id, 1, "Alpha");
    seed(two.id, 1, "Beta");
    const offline = async (): Promise<RagEmbedder> => {
      throw new Error("missing model");
    };
    expect((await memorySearch(db, relay.id, "Alpha", offline)).records).toEqual([]);
    const aId = one.projectId ?? "";
    const permitted = await memorySearch(db, relay.id, "Alpha Beta", offline, [aId]);
    expect(permitted.records.map((r) => r.projectId)).toEqual([one.projectId]);
    const both = await memorySearch(db, relay.id, "Alpha Beta", offline, [
      aId,
      two.projectId ?? "",
    ]);
    expect(new Set(both.records.map((r) => r.projectId))).toEqual(
      new Set([one.projectId, two.projectId]),
    );
    expect((await memorySearch(db, two.id, "Alpha", offline)).records).toEqual([]);
    const info = await stat(a, { bigint: true });
    expect(db.project(a, { device: info.dev, inode: info.ino })).toBe(aId);
    expect(() => db.project(a, { device: info.dev, inode: info.ino + 1n })).toThrow("identity");
  });
  it("lets a strong semantic match outrank many weak keyword hits", async () => {
    const c = db.register("fusion", "Fusion", null);
    seed(c.id, 30, "before");
    const s: MemorySource = {
      id: randomUUID(),
      conversationId: c.id,
      role: "human",
      at: new Date().toISOString(),
      ordinal: 1,
      start: 0,
      text: "Redis evidence",
    };
    db.append(c.id, "2", [s], true);
    const citations = [{ sourceId: s.id, start: 0, end: s.text.length, quote: s.text }];
    const range = db.range(c.id);
    db.publish(
      c.id,
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
            text: "Start the cache container first.",
            subject: "cache",
            condition: "",
            correction: false,
            citations,
          },
        ],
      },
      "fixture",
    );
    const axis = (i: number) => Float32Array.from({ length: 768 }, (_, j) => (j === i ? 1 : 0));
    const model: RagEmbedder = {
      countTokens: (text) => text.length + 2,
      embedDocuments: async (texts) => texts.map((t) => (t.includes("cache") ? axis(0) : axis(1))),
      embedQuery: async () => axis(0),
    };
    while (await indexMemoryBatch(db, async () => model)) {}
    const result = await memorySearch(db, c.id, "what runs before tests", async () => model);
    expect(result.records[0]?.text).toBe("Start the cache container first.");
    expect(result.records).toHaveLength(31);
  });
});
