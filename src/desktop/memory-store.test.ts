import { randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, rename, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MEMORY_SETTINGS,
  type MemoryGeneration,
  type MemorySource,
} from "../bridge/index.js";
import { MemoryStore } from "./memory-store.js";
import { sqliteAvailable } from "./projects.js";

// Node 22.12 has SQLite but lacks the FTS5 tables required by these memory fixtures.
function sqliteFtsAvailable(): boolean {
  if (!sqliteAvailable()) return false;
  const sqlite = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
  const database = new sqlite.DatabaseSync(":memory:");
  try {
    return (
      database.prepare("SELECT sqlite_compileoption_used('ENABLE_FTS5') AS enabled").get()
        ?.enabled === 1
    );
  } finally {
    database.close();
  }
}

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
  vi.useRealTimers();
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
describe.skipIf(!sqliteFtsAvailable())("private application memory", () => {
  it.each([false, true])(
    "restores a surviving fact after rewinding a correction=%s",
    (correction) => {
      const c = store.register("project:rewind", "Chat", dir);
      const original = publish(c.id, source(c.id));
      const changed = { ...source(c.id, "Use SQLite for the cache."), ordinal: 2 };
      const value = generation(changed);
      must(value.memories[0]).correction = correction;
      publish(c.id, changed, value);
      expect(store.detail(original.id).record.state).toBe(correction ? "superseded" : "disputed");
      store.close();
      store = new MemoryStore(join(dir, "memory"));
      store.rewind("project:rewind", 2);
      expect(store.eligible(c.id).map((record) => record.text)).toEqual([original.text]);
      store.rewind("project:rewind", 2);
      expect(store.eligible(c.id).map((record) => record.text)).toEqual([original.text]);
    },
  );
  it("preserves a human edit made after a discarded correction", () => {
    const c = store.register("project:rewind", "Chat", dir);
    const original = publish(c.id, source(c.id));
    const changed = { ...source(c.id, "Use SQLite for the cache."), ordinal: 2 };
    const value = generation(changed);
    must(value.memories[0]).correction = true;
    publish(c.id, changed, value);
    const current = store.detail(original.id).record;
    store.action({
      type: "edit",
      id: original.id,
      revision: current.revision,
      text: "Human cache choice",
      pinned: true,
    });
    const edited = store.detail(original.id).record;
    store.rewind("project:rewind", 2);
    expect(store.detail(original.id).record).toEqual(edited);
  });
  it("restores derived state across consecutive request Undos", () => {
    const c = store.register("project:rewind", "Chat", dir);
    const original = publish(c.id, source(c.id));
    publish(c.id, { ...source(c.id, "Use SQLite for the cache."), ordinal: 2 });
    publish(c.id, { ...source(c.id, "Use Memcached for the cache."), ordinal: 3 });
    store.rewind("project:rewind", 3);
    expect(store.detail(original.id).record.state).toBe("disputed");
    store.rewind("project:rewind", 2);
    expect(store.eligible(c.id).map((record) => record.text)).toEqual([original.text]);
  });
  it.each([true, false])(
    "ignores discarded project candidates when relearning identical=%s evidence",
    (identical) => {
      const c = store.register("project:rewind", "Chat", dir);
      const discarded = publish(c.id, source(c.id));
      store.rewind("project:rewind", 1);
      const fresh = {
        ...source(c.id, identical ? discarded.text : "Use SQLite for the cache."),
        ordinal: 2,
      };
      const learned = publish(c.id, fresh);
      expect(learned.id).not.toBe(discarded.id);
      expect(learned.state).toBe("active");
      expect(store.eligible(c.id).map((record) => record.id)).toEqual([learned.id]);
    },
  );

  it("suppresses discarded turns and stale extraction while retaining surviving and unrelated evidence", () => {
    const c = store.register("project:chat", "Chat", null);
    const other = store.register("project:other", "Other", null);
    const surviving = source(c.id, "Use Redis for the cache.");
    publish(c.id, surviving);
    const discarded = { ...source(c.id, "Retry failed requests seven times."), ordinal: 2 };
    const value = generation(discarded);
    must(value.memories[0]).subject = "retries";
    publish(c.id, discarded, value);
    publish(other.id, source(other.id, "Other chat remains available."));
    const pending = { ...source(c.id, "Pending discarded extraction."), ordinal: 3 };
    store.append(c.id, "pending", [pending], true);
    const range = store.range(c.id);
    expect(store.checkpoint(c.id)).not.toBe("");
    expect(store.rewind("project:chat", 2)).toEqual([c.id]);
    expect(store.eligible(c.id).map((record) => record.text)).toEqual([surviving.text]);
    expect(store.lexical(c.id, "seven")).toEqual([]);
    expect(store.range(c.id).sources).toEqual([]);
    expect(store.checkpoint(c.id)).toBe("");
    expect(store.eligible(other.id).map((record) => record.text)).toEqual([
      "Other chat remains available.",
    ]);
    expect(() =>
      store.publish(c.id, range.cursor, range.boundary, generation(pending), "late"),
    ).toThrow("changed");
    expect(store.browse({ conversationId: c.id }).records).toHaveLength(2);
    expect(() => store.rewind("project:chat", -1)).toThrow("boundary");
  });
  it("distinguishes type, conditions, subject and dated events when deduplicating", () => {
    const c = store.register("c", "Chat", null);
    publish(c.id, source(c.id));
    publish(c.id, source(c.id));
    const episode = source(c.id);
    publish(c.id, episode, generation(episode, "episodic"));
    const otherSubject = source(c.id);
    const subjectValue = generation(otherSubject);
    must(subjectValue.memories[0]).subject = "client-cache";
    publish(c.id, otherSubject, subjectValue);
    const lesson = source(c.id);
    publish(c.id, lesson, generation(lesson, "lesson"));
    const conditional = source(c.id);
    const conditionValue = generation(conditional, "lesson");
    must(conditionValue.memories[0]).condition = "When deploying production";
    publish(c.id, conditional, conditionValue);
    const later = { ...source(c.id), at: "2026-11-14T12:00:00.000Z" };
    publish(c.id, later, generation(later, "episodic"));
    const repeated = { ...source(c.id), at: later.at };
    publish(c.id, repeated, generation(repeated, "episodic"));
    const records = store.browse({}).records;
    expect(records).toHaveLength(6);
    expect(records.every((r) => r.state === "active")).toBe(true);
    expect(records.filter((r) => r.type === "episodic").map((r) => r.eventAt)).toEqual([
      later.at,
      at,
    ]);
  });
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
    store.configure({ ...DEFAULT_MEMORY_SETTINGS, enabled: false });
    store.close();
    store = new MemoryStore(join(dir, "memory"));
    expect(store.settings().enabled).toBe(false);
    expect(store.register("chat", "Chat", null).id).toBe(c.id);
    expect(store.browse({}).records).toHaveLength(4);
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
    const unresolved = publish(c.id, source(c.id, "Cache uses DynamoDB.", "assistant"));
    expect(unresolved.state).toBe("disputed");
    store.action({
      type: "resolve",
      id: first.id,
      revision: store.detail(first.id).record.revision,
    });
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
  it("scope forgetting preserves promoted globals and their shared evidence without regenerating local records", () => {
    const c = store.register("local", "Local", null);
    const s = source(c.id);
    const value = generation(s);
    value.memories.push({
      ...must(value.memories[0]),
      type: "history",
      text: "Local history using the same source.",
    });
    const shared = publish(c.id, s, value);
    store.action({ type: "promote", id: shared.id, revision: shared.revision });
    const unextracted = source(c.id, "An unextracted local fact.");
    store.append(c.id, "pending", [unextracted], true);
    store.action({ type: "forget-scope", projectId: null });
    expect(store.browse({}).records.map((r) => r.id)).toEqual([shared.id]);
    expect(store.detail(shared.id).incomplete).toBe(false);
    expect(store.eligible(c.id).map((r) => r.id)).toEqual([shared.id]);
    expect(store.lexical(c.id, "Local")).toEqual([shared.id]);
    expect(store.range(c.id).sources).toEqual([]);
    store.append(c.id, "future", [source(c.id, "A future local fact.")], true);
    expect(store.range(c.id).sources).toHaveLength(1);
    const future = store.range(c.id);
    store.publish(
      c.id,
      future.cursor,
      future.boundary,
      generation(must(future.sources[0]), "episodic"),
      "fixture",
    );
    const recent = must(store.browse({ type: "episodic" }).records[0]);
    store.action({ type: "forget", id: recent.id, revision: recent.revision });
    expect(store.range(c.id).sources).toEqual([]);
    expect(store.tail(c.id)).toEqual([]);
    expect(store.eligible(c.id).map((r) => r.id)).toEqual([shared.id]);
  });
  it("supports revisions, stable paging, vector rebuilds and authoritative Off mode", () => {
    const c = store.register("c", "Chat", null);
    for (let i = 0; i < 28; i++) {
      const s = source(c.id, `Cache event ${i}`);
      publish(c.id, s, generation(s, "episodic"));
    }
    const page = store.browse({});
    expect(page.records).toHaveLength(25);
    expect(store.browse({ cursor: must(page.next ?? undefined) }).records).toHaveLength(3);
    const lastPage = store.browse({ cursor: must(page.next ?? undefined) });
    const old = must(lastPage.records[2]);
    store.action({
      type: "edit",
      id: old.id,
      revision: old.revision,
      text: "Old record stays on its page.",
      pinned: false,
    });
    expect(store.browse({ cursor: must(page.next ?? undefined) }).records.map((r) => r.id)).toEqual(
      lastPage.records.map((r) => r.id),
    );
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
    store.configure({ ...DEFAULT_MEMORY_SETTINGS, enabled: false });
    store.append(c.id, "ignored", [source(c.id)], true);
    expect(store.range(c.id).sources).toEqual([]);
    expect(store.eligible(c.id)).toEqual([]);
    expect(store.lexical(c.id, "cache")).toEqual([]);
    expect(store.register("c", "Chat", null).id).toBe(c.id);
    expect(store.snapshot().count).toBe(28);
  });
  it("deletes expired unpinned records, preserves pinned shared evidence and suppresses recreation", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(at));
    const c = store.register("retention", "Retention", null);
    const s = source(c.id);
    const value = generation(s);
    value.memories.push({ ...must(value.memories[0]), type: "history", text: "Pinned history" });
    publish(c.id, s, value);
    const pinned = must(store.browse({ type: "history" }).records[0]);
    const expired = must(store.browse({ type: "semantic" }).records[0]);
    store.action({ type: "edit", id: pinned.id, revision: 1, text: pinned.text, pinned: true });
    store.setVectors(expired.id, "test", [new Float32Array([1, 0])]);
    store.configure({ ...DEFAULT_MEMORY_SETTINGS, retentionDays: 30 });
    vi.setSystemTime(new Date(Date.parse(at) + 30 * 86400000 - 1));
    expect(store.expireBatch()).toBe(0);
    vi.advanceTimersByTime(1);
    expect(store.eligible(c.id).map((r) => r.id)).toEqual([pinned.id]);
    expect(store.expireBatch()).toBe(1);
    expect(() => store.detail(expired.id)).toThrow("unavailable");
    expect(store.vectors(expired.id, "test")).toEqual([]);
    expect(store.detail(pinned.id).incomplete).toBe(false);
    expect(store.detail(pinned.id).sources).toHaveLength(1);
    expect(store.lexical(c.id, "history")).toEqual([pinned.id]);
    expect(store.checkpoint(c.id)).toBe("");
    expect(store.range(c.id).sources).toEqual([]);
    expect(store.expireBatch()).toBe(0);
  });
  it("bounds retention batches and revalidates preview tokens after edits or restart", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(at));
    const c = store.register("batch", "Batch", null);
    for (let i = 0; i < 70; i++) {
      const s = source(c.id, `Unique event ${i}`);
      const value = generation(s, "episodic");
      must(value.memories[0]).subject = `event-${i}`;
      publish(c.id, s, value);
    }
    vi.setSystemTime(new Date(Date.parse(at) + 91 * 86400000));
    const preview = store.previewRetention(30);
    expect(preview.count).toBe(70);
    const r = must(store.browse({}).records[0]);
    store.action({ type: "edit", id: r.id, revision: r.revision, text: r.text, pinned: true });
    expect(() =>
      store.configure({ ...DEFAULT_MEMORY_SETTINGS, retentionDays: 30 }, preview.token),
    ).toThrow("changed");
    expect(store.settings().retentionDays).toBe(0);
    const next = store.previewRetention(30);
    expect(next.count).toBe(69);
    store.configure({ ...DEFAULT_MEMORY_SETTINGS, retentionDays: 30 }, next.token);
    expect(store.expireBatch()).toBe(64);
    expect(store.expireBatch()).toBe(5);
    expect(store.expireBatch()).toBe(0);
    expect(store.browse({}).records.map((record) => record.id)).toEqual([r.id]);
    const old = store.previewRetention(30);
    store.close();
    store = new MemoryStore(join(dir, "memory"));
    expect(() =>
      store.configure({ ...DEFAULT_MEMORY_SETTINGS, retentionDays: 30 }, old.token),
    ).toThrow("changed");
  });
  it("discards learning-only evidence when Off while preserving saved records and citations", () => {
    const c = store.register("toggle", "Toggle", null);
    const saved = publish(c.id, source(c.id));
    store.append(c.id, "pending", [source(c.id, "An unprocessed fact")], true);
    const range = store.range(c.id);
    store.configure({ ...DEFAULT_MEMORY_SETTINGS, enabled: false });
    store.configure(DEFAULT_MEMORY_SETTINGS);
    expect(store.range(c.id).sources).toEqual([]);
    expect(store.detail(saved.id).incomplete).toBe(false);
    expect(() =>
      store.publish(
        c.id,
        range.cursor,
        range.boundary,
        generation(must(range.sources[0])),
        "fixture",
      ),
    ).toThrow("changed");
  });
  it("rejects linked and unsafe storage instead of resetting it", async () => {
    const linked = join(dir, "linked");
    await mkdir(linked, { mode: 0o700 });
    await symlink(join(dir, "memory", "memory.sqlite"), join(linked, "memory.sqlite"));
    expect(() => new MemoryStore(linked)).toThrow();
    await chmod(join(dir, "memory", "memory.sqlite"), 0o644);
    expect(() => new MemoryStore(join(dir, "memory"))).toThrow("permissions");
    await chmod(join(dir, "memory", "memory.sqlite"), 0o600);
  });
});

describe.skipIf(!sqliteFtsAvailable())("explicit agent memory writes", () => {
  function saved(result: ReturnType<MemoryStore["agentWrite"]>) {
    if (result.status !== "ok") throw new Error(`Unexpected memory status: ${result.status}`);
    return result.record;
  }
  function setup(project: string | null = null) {
    const c = store.register(`agent:${randomUUID()}`, "Agent", project);
    const s = source(c.id);
    store.append(c.id, "1", [s], true);
    return { c, s, memory: must(generation(s).memories[0]) };
  }
  it("persists stable IDs, evidence, modifications and revision history across reopen", () => {
    const { c, memory } = setup();
    const created = store.agentWrite(c.id, "code60_create_memory", { memory });
    expect(created.status).toBe("ok");
    const record = saved(created);
    expect(saved(store.agentWrite(c.id, "code60_create_memory", { memory })).id).toBe(record.id);
    const changed = store.agentWrite(c.id, "code60_modify_memory", {
      id: record.id,
      revision: record.revision,
      memory: { ...memory, text: "Redis is the cache." },
    });
    expect(changed).toMatchObject({
      status: "ok",
      record: { id: record.id, revision: 2, evidence: "agent-reported" },
    });
    store.close();
    store = new MemoryStore(join(dir, "memory"));
    expect(store.eligible(c.id)).toEqual([saved(changed)]);
    expect(store.detail(record.id).revisions.map((r) => r.revision)).toEqual([2, 1]);
    expect(store.detail(record.id).sources).toHaveLength(1);
    expect(
      store.agentWrite(c.id, "code60_modify_memory", { id: record.id, revision: 1, memory }),
    ).toEqual({ status: "conflict" });
    expect(store.detail(record.id).record.text).toBe("Redis is the cache.");
    expect(
      store.agentWrite(c.id, "code60_modify_memory", { id: randomUUID(), revision: 1, memory }),
    ).toEqual({ status: "not-found" });
  });
  it("rejects uncommitted, foreign, suppressed and invalid evidence and unknown scope fields", () => {
    const { c, s, memory } = setup();
    const other = store.register("other", "Other", null);
    expect(() => store.agentWrite(other.id, "code60_create_memory", { memory })).toThrow(
      /evidence/,
    );
    expect(() =>
      store.agentWrite(c.id, "code60_create_memory", { memory, projectId: randomUUID() }),
    ).toThrow();
    for (const patch of [
      { text: " " },
      { subject: " " },
      { type: "lesson" },
      { citations: [] },
      { citations: [{ ...memory.citations[0], quote: "invented" }] },
    ])
      expect(() =>
        store.agentWrite(c.id, "code60_create_memory", { memory: { ...memory, ...patch } }),
      ).toThrow();
    const pending = source(c.id, "Pending evidence");
    store.append(c.id, "pending", [pending], false);
    expect(() =>
      store.agentWrite(c.id, "code60_create_memory", {
        memory: must(generation(pending).memories[0]),
      }),
    ).toThrow(/evidence/);
    const record = saved(store.agentWrite(c.id, "code60_create_memory", { memory }));
    store.action({ type: "forget", id: record.id, revision: record.revision });
    expect(store.tail(c.id).map((item) => item.id)).not.toContain(s.id);
    expect(() => store.agentWrite(c.id, "code60_create_memory", { memory })).toThrow(/evidence/);
    expect(store.browse({}).records).toHaveLength(0);
  });
  it("isolates conversations/projects and protects human and global records", async () => {
    const { c, memory } = setup(dir);
    const record = saved(store.agentWrite(c.id, "code60_create_memory", { memory }));
    const otherDir = join(dir, "other-project");
    await mkdir(otherDir);
    const foreign = setup(otherDir);
    expect(store.eligible(foreign.c.id)).toEqual([]);
    expect(
      store.agentWrite(foreign.c.id, "code60_modify_memory", {
        id: record.id,
        revision: 1,
        memory: foreign.memory,
      }),
    ).toEqual({ status: "not-found" });
    const peer = setup(dir);
    expect(store.eligible(peer.c.id).map((r) => r.id)).toContain(record.id);
    expect(
      store.agentWrite(peer.c.id, "code60_modify_memory", {
        id: record.id,
        revision: 1,
        memory: { ...peer.memory, text: "Peer evidence" },
      }).status,
    ).toBe("ok");
    store.action({ type: "edit", id: record.id, revision: 2, text: "Human choice", pinned: false });
    expect(
      store.agentWrite(c.id, "code60_modify_memory", { id: record.id, revision: 3, memory }).status,
    ).toBe("protected");
    store.action({ type: "promote", id: record.id, revision: 3 });
    expect(store.eligible(foreign.c.id).map((r) => r.id)).toContain(record.id);
    expect(
      store.agentWrite(c.id, "code60_modify_memory", { id: record.id, revision: 4, memory }).status,
    ).toBe("not-found");
    const local = setup();
    const localRecord = saved(
      store.agentWrite(local.c.id, "code60_create_memory", { memory: local.memory }),
    );
    expect(store.eligible(c.id).map((r) => r.id)).not.toContain(localRecord.id);
    expect(
      store.agentWrite(c.id, "code60_modify_memory", { id: localRecord.id, revision: 1, memory })
        .status,
    ).toBe("not-found");
  });
  it("keeps disputed creates inspectable without recalling them automatically", () => {
    const { c, memory } = setup();
    store.agentWrite(c.id, "code60_create_memory", { memory });
    const result = store.agentWrite(c.id, "code60_create_memory", {
      memory: { ...memory, text: "Cache choice is uncertain." },
    });
    const record = saved(result);
    expect(record.state).toBe("disputed");
    expect(store.eligible(c.id)).toEqual([]);
    expect(store.eligible(c.id, "", 20, [], true).map((r) => r.id)).toContain(record.id);
    expect(store.lexical(c.id, "uncertain", [], true)).toContain(record.id);
  });
  it("keeps discarded project evidence inaccessible to explicit modifications", () => {
    const { c, memory } = setup(dir);
    const record = saved(store.agentWrite(c.id, "code60_create_memory", { memory }));
    store.rewind(JSON.parse(String(store.conversation(c.id).key))[0], 1);
    const peer = setup(dir);
    expect(store.eligible(peer.c.id)).toEqual([]);
    expect(
      store.agentWrite(peer.c.id, "code60_modify_memory", {
        id: record.id,
        revision: record.revision,
        memory: peer.memory,
      }),
    ).toEqual({ status: "not-found" });
    expect(store.detail(record.id).record.revision).toBe(1);
  });
  it("blocks writes while Off and preserves existing records", () => {
    const { c, memory } = setup();
    const record = saved(store.agentWrite(c.id, "code60_create_memory", { memory }));
    store.configure({ ...DEFAULT_MEMORY_SETTINGS, enabled: false });
    expect(store.agentWrite(c.id, "code60_create_memory", { memory })).toEqual({
      status: "disabled",
    });
    expect(
      store.agentWrite(c.id, "code60_modify_memory", { id: record.id, revision: 1, memory }),
    ).toEqual({ status: "disabled" });
    expect(store.eligible(c.id)).toEqual([]);
    expect(store.detail(record.id).record.revision).toBe(1);
  });
});
