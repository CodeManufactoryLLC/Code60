import { randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, rename, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MEMORY_SETTINGS,
  type MemoryGeneration,
  type MemorySource,
} from "../bridge/index.js";
import { MemoryStore } from "./memory-store.js";

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected test fixture value");
  return value;
}

let dir: string;
let store: MemoryStore;
const at = "2026-11-13T12:00:00.000Z";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "code60-memory-store-"));
  store = new MemoryStore(join(dir, "memory"));
});
afterEach(async () => {
  store.close();
  await rm(dir, { recursive: true, force: true });
});
function source(
  cid: string,
  text = "Use Redis for the cache.",
  role: MemorySource["role"] = "human",
): MemorySource {
  return { id: randomUUID(), conversationId: cid, text, role, at, ordinal: 1, start: 0 };
}
function generation(
  s: MemorySource,
  type: "semantic" | "lesson" | "history" | "episodic" = "semantic",
): MemoryGeneration {
  const citations = [{ sourceId: s.id, start: 0, end: s.text.length, quote: s.text }];
  return {
    goal: "Investigate the cache",
    constraints: [],
    decisions: [],
    attempts: [],
    questions: [],
    next: "Test the cache",
    citations,
    memories: [
      {
        type,
        text: s.text,
        subject: "cache",
        condition: type === "lesson" ? "When testing the cache" : "",
        correction: false,
        citations,
      },
    ],
  };
}
function publish(cid: string, s: MemorySource, value = generation(s)) {
  store.append(cid, randomUUID(), [s], true);
  // A completed marker commits its exact physical turn only.
  const range = store.range(cid);
  store.publish(cid, range.cursor, range.boundary, value, "fixture");
  return must(store.browse({ conversationId: cid }).records[0]);
}
describe("private application memory", () => {
  it("persists settings, exact evidence, revisions and all four memory types across restart", async () => {
    const c = store.register("chat", "Chat", null);
    for (const type of ["episodic", "semantic", "lesson", "history"] as const) {
      const s = source(c.id, `${type}: Redis was unavailable.`);
      publish(c.id, s, generation(s, type));
    }
    expect(store.browse({}).records.map((r) => r.type)).toEqual([
      "history",
      "lesson",
      "semantic",
      "episodic",
    ]);
    const record = must(store.browse({}).records[0]);
    expect(store.detail(record.id).sources[0]?.text).toBe("history: Redis was unavailable.");
    expect(store.detail(record.id).revisions).toHaveLength(1);
    store.configure({ ...DEFAULT_MEMORY_SETTINGS, dailyCalls: 3 });
    store.close();
    store = new MemoryStore(join(dir, "memory"));
    expect(store.settings().dailyCalls).toBe(3);
    expect(store.register("chat", "Chat", null).id).toBe(c.id);
    expect(store.browse({}).records).toHaveLength(4);
    if (process.platform !== "win32")
      expect((await stat(join(dir, "memory", "memory.sqlite"))).mode & 0o077).toBe(0);
  });
  it("shares only durable project identity and human-promoted global memories", async () => {
    const a = join(dir, "a"),
      b = join(dir, "b");
    await mkdir(a);
    await mkdir(b);
    const one = store.register("one", "One", a);
    const two = store.register("two", "Two", a);
    const other = store.register("three", "Other", b);
    const relay = store.register("relay", "Relay", null);
    const r = publish(one.id, source(one.id));
    publish(relay.id, source(relay.id, "Unassigned Relay context."));
    expect(store.eligible(two.id).map((r) => r.id)).toEqual([r.id]);
    expect(store.eligible(other.id)).toEqual([]);
    expect(store.eligible(relay.id)).toHaveLength(1);
    store.action({ type: "promote", id: r.id, revision: r.revision });
    expect(store.eligible(other.id)[0]?.scope).toBe("global");
    expect(store.lexical(other.id, "Redis")).toEqual([r.id]);
    await rename(a, `${a}-old`);
    await mkdir(a);
    expect(store.register("replacement", "Replacement", a).projectId).not.toBe(one.projectId);
  });
  it("keeps incomplete turns uncommitted and publishes checkpoints/cursors atomically", () => {
    const c = store.register("c", "Chat", null);
    const s = source(c.id);
    store.append(c.id, "old:1", [s], false);
    store.append(c.id, "new:1", [], true);
    expect(store.range(c.id).sources).toEqual([]);
    store.append(c.id, "old:1", [], true);
    const range = store.range(c.id);
    const invalid = generation(s);
    must(must(invalid.memories[0]).citations[0]).end++;
    expect(() => store.publish(c.id, range.cursor, range.boundary, invalid, "fixture")).toThrow();
    expect(store.range(c.id).cursor).toBe(0);
    expect(store.checkpoint(c.id)).toBe("");
    store.publish(c.id, range.cursor, range.boundary, generation(s), "fixture");
    expect(() =>
      store.publish(c.id, range.cursor, range.boundary, generation(s), "fixture"),
    ).toThrow("changed");
    expect(store.range(c.id).sources).toEqual([]);
  });
  it("preserves contradictory evidence, links human corrections and protects pinned edits", () => {
    const c = store.register("c", "Chat", null);
    const first = publish(c.id, source(c.id, "Cache uses Redis.", "assistant"));
    const second = publish(c.id, source(c.id, "Cache uses SQLite.", "assistant"));
    expect(store.detail(first.id).record.state).toBe("disputed");
    expect(second.state).toBe("disputed");
    expect(second.evidence).toBe("agent-reported");
    store.action({ type: "resolve", id: first.id, revision: 2 });
    const s = source(c.id, "Correction: cache uses Memcached.");
    const value = generation(s);
    must(value.memories[0]).correction = true;
    const third = publish(c.id, s, value);
    expect(third.state).toBe("disputed");
    expect(store.detail(first.id).record).toMatchObject({
      pinned: true,
      state: "active",
      evidence: "human-edited",
    });
    const other = store.register("other", "Other", null);
    const previous = publish(other.id, source(other.id));
    const correction = source(other.id, "Correction: use SQLite.");
    const result = generation(correction);
    must(result.memories[0]).correction = true;
    const corrected = publish(other.id, correction, result);
    expect(corrected.supersedes).toBe(previous.id);
    expect(store.detail(previous.id).record.state).toBe("superseded");
  });
  it("forgets immediately, invalidates checkpoints and suppresses recreation and sibling recall", () => {
    const c = store.register("c", "Chat", null);
    const s = source(c.id);
    const value = generation(s);
    value.memories.push({
      ...must(value.memories[0]),
      text: "Same evidence, other memory.",
      type: "history",
    });
    publish(c.id, s, value);
    const r = must(store.browse({ type: "semantic" }).records[0]);
    store.action({ type: "forget", id: r.id, revision: r.revision });
    expect(store.eligible(c.id)).toEqual([]);
    expect(store.lexical(c.id, "evidence")).toEqual([]);
    expect(store.checkpoint(c.id)).toBe("");
    expect(store.tail(c.id)).toEqual([]);
    expect(store.range(c.id).sources).toEqual([]);
    expect(() => store.detail(r.id)).toThrow();
    const pending = source(c.id, "A not-yet-extracted fact.");
    store.append(c.id, "next", [pending], true);
    store.action({ type: "forget-scope", projectId: null });
    expect(store.range(c.id).sources).toEqual([]);
  });
  it("supports revisions, stable paging, retention, vector rebuilds, call limits and do-not-remember", () => {
    const c = store.register("c", "Chat", null);
    for (let i = 0; i < 28; i++) {
      const s = source(c.id, `Cache event ${i}`);
      publish(c.id, s, generation(s, "episodic"));
    }
    const page = store.browse({});
    expect(page.records).toHaveLength(25);
    expect(store.browse({ cursor: must(page.next ?? undefined) }).records).toHaveLength(3);
    const r = must(page.records[0]);
    store.action({ type: "edit", id: r.id, revision: 1, text: "A human edit.", pinned: true });
    expect(() =>
      store.action({ type: "edit", id: r.id, revision: 1, text: "Stale", pinned: false }),
    ).toThrow("changed");
    expect(store.detail(r.id).revisions).toHaveLength(2);
    store.markUsed([r.id]);
    expect(store.detail(r.id).record.lastUsedAt).not.toBeNull();
    store.setVectors(r.id, "fixture", [new Float32Array([1, 0])]);
    expect([...must(store.vectors(r.id, "fixture")[0])]).toEqual([1, 0]);
    expect(store.vectors(r.id, "other")).toEqual([]);
    store.reindex();
    expect(store.vectors(r.id, "fixture")).toEqual([]);
    store.reserveCall(1);
    expect(() => store.reserveCall(1)).toThrow("daily");
    expect(store.snapshot().dailyCalls).toBe(1);
    store.action({ type: "remember", conversationId: c.id, enabled: false });
    store.append(c.id, "ignored", [source(c.id)], true);
    expect(store.range(c.id).remember).toBe(false);
    expect(store.register("c", "Chat", null).remember).toBe(false);
    store.configure({
      ...DEFAULT_MEMORY_SETTINGS,
      retentionDays: { ...DEFAULT_MEMORY_SETTINGS.retentionDays, episodic: 1 },
    });
    expect(store.snapshot().count).toBe(28);
  });
  it.skipIf(process.platform === "win32")(
    "rejects linked and unsafe storage instead of resetting it",
    async () => {
      const linked = join(dir, "linked");
      await mkdir(linked, { mode: 0o700 });
      await symlink(join(dir, "memory", "memory.sqlite"), join(linked, "memory.sqlite"));
      expect(() => new MemoryStore(linked)).toThrow();
      await chmod(join(dir, "memory", "memory.sqlite"), 0o644);
      expect(() => new MemoryStore(join(dir, "memory"))).toThrow("permissions");
      await chmod(join(dir, "memory", "memory.sqlite"), 0o600);
    },
  );
});
