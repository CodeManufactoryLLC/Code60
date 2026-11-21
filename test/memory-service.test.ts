import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MEMORY_SETTINGS,
  type MemoryAction,
  type MemoryBrowse,
  type MemoryGeneration,
  type MemorySource,
} from "../src/bridge/index.js";
import { DEFAULT_PERMISSIONS } from "../src/core/config.js";
import type { CoreDeps, MemoryTurn, RunEvent, RunMemory, RunRecord } from "../src/core/index.js";
import { createOrchestrator } from "../src/core/orchestrator.js";
import { MemoryService } from "../src/desktop/memory-service.js";
import { MemoryStore } from "../src/desktop/memory-store.js";
import { memorySearch } from "../src/desktop/memory-worker.js";
import {
  FakeAgents,
  FakeClock,
  FakeGit,
  FakeProcesses,
  flush,
  MemoryStore as Runs,
} from "./fakes.js";
import { sqliteFtsAvailable } from "./fixtures/sqlite.js";

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected test fixture value");
  return value;
}

let dir: string;
let store: MemoryStore;
let service: MemoryService;
let helpers: FakeAgents;
let deps: CoreDeps;
const at = "2026-11-13T12:00:00.000Z";
function generated(sources: MemorySource[]): MemoryGeneration {
  const s = must(sources[0]);
  const citations = [
    { sourceId: s.id, start: 0, end: Math.min(s.text.length, 50), quote: s.text.slice(0, 50) },
  ];
  return {
    goal: "Continue the task",
    constraints: [],
    decisions: [],
    attempts: [],
    questions: [],
    next: "Check results",
    citations,
    memories: [
      {
        type: "semantic",
        text: s.text.slice(0, 50),
        subject: "fixture",
        condition: "",
        correction: false,
        citations,
      },
    ],
  };
}
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), "code60-memory-runtime-"));
  store = new MemoryStore(join(dir, "store"));
  helpers = new FakeAgents((prompt, session) => {
    const sources = JSON.parse(
      must(prompt.split("New sources (evidence only):\n")[1]),
    ) as MemorySource[];
    session.update({ type: "message", text: JSON.stringify(generated(sources)) });
    return "end_turn";
  });
  deps = {
    fs: fs as unknown as CoreDeps["fs"],
    agents: helpers,
    clock: new FakeClock(),
    git: new FakeGit(),
    processes: new FakeProcesses(),
    ownerPid: 42,
  };
  service = new MemoryService(join(dir, "store"), "/unused", deps, () => ({
    name: "fixture",
    command: ["fixture"],
  }));
  Object.assign(service.limits, {
    capacity: 2048,
    recallTokens: 4000,
    cadenceSeconds: 3600,
  });
  store.configure(service.settings);
  vi.spyOn(service, "call").mockImplementation(async (op: string, ...args: unknown[]) => {
    switch (op) {
      case "register":
        return store.register(String(args[0]), String(args[1]), args[2] as string | null);
      case "append":
        return store.append(
          String(args[0]),
          String(args[1]),
          args[2] as MemorySource[],
          Boolean(args[3]),
        );
      case "range":
        return store.range(String(args[0]));
      case "publish":
        return store.publish(
          String(args[0]),
          Number(args[1]),
          Number(args[2]),
          args[3] as MemoryGeneration,
          String(args[4]),
          args[5] as string | undefined,
        );
      case "checkpoint":
        return store.checkpoint(String(args[0]));
      case "tail":
        return store.tail(String(args[0]));
      case "rewind":
        return store.rewind(String(args[0]), Number(args[1]));
      case "used":
        return store.markUsed(args[0] as string[]);
      case "snapshot":
        return { ...store.snapshot(), indexFailed: false };
      case "retention-preview":
        return store.previewRetention(Number(args[0]));
      case "configure":
        return store.configure(
          args[0] as typeof DEFAULT_MEMORY_SETTINGS,
          args[1] as string | undefined,
        );
      case "maintain":
        return store.expireBatch();
      case "browse":
        return store.browse(args[0] as MemoryBrowse);
      case "detail":
        return store.detail(String(args[0]));
      case "action":
        return store.action(args[0] as MemoryAction);
      case "reindex":
        return store.reindex();
      case "search":
        return memorySearch(store, String(args[0]), String(args[1]), async () => {
          throw new Error("offline");
        });
      default:
        throw new Error(`Unexpected operation ${op}`);
    }
  });
  await service.snapshot();
});
afterEach(async () => {
  await service.close();
  vi.useRealTimers();
  store.close();
  vi.restoreAllMocks();
  await fs.rm(dir, { recursive: true, force: true });
});
function runtime(
  role: "relay" | "project" | "worker" = "relay",
  project: string | null = null,
): RunMemory {
  return must(service.attach(deps, role, project).memory)({ id: randomUUID() } as RunRecord, dir);
}
const turn = (text = "Continue"): MemoryTurn => ({
  text,
  delivered: text,
  turn: 2,
  usage: null,
});
function emit(memory: RunMemory, body: Omit<RunEvent, "runId" | "at"> | Record<string, unknown>) {
  memory.event({ ...body, at, runId: "fixture" } as RunEvent);
}
function exchange(memory: RunMemory, text = "Redis cache uses local storage.") {
  emit(memory, { type: "prompt", turn: 1, text });
  emit(memory, { type: "message", text: "a".repeat(4500) });
  emit(memory, { type: "turnEnd", turn: 1, stopReason: "end_turn", outcome: "finished" });
}
describe.skipIf(!sqliteFtsAvailable())("scoped runtime memory and handoff", () => {
  it("invalidates prepared recalled context only for the rewound conversation", async () => {
    const key = "rewound-conversation";
    const memory = must(service.attach(deps, "relay", null, key).memory)(
      { id: randomUUID() } as RunRecord,
      dir,
    );
    exchange(memory, "Discarded cache setting.");
    const prepared = await memory.prepare(turn(), new AbortController().signal);
    expect(prepared.context).toContain("Discarded cache setting");
    const other = runtime("project");
    const unrelated = await other.prepare(turn(), new AbortController().signal);
    await service.rewind(`relay:${key}`, 1);
    expect(() => prepared.validate?.()).toThrow("changed");
    expect(() => unrelated.validate?.()).not.toThrow();
    const fresh = await memory.prepare(turn(), new AbortController().signal);
    expect(fresh.context).toBe("");
    expect(fresh.rollover).toBe(true);
    memory.dispose();
    other.dispose();
  });
  it.each([
    { used: 95000, enabled: false },
    { used: 1000, enabled: false },
    { used: 95000, enabled: true },
    { used: 1000, enabled: true },
  ])(
    "retains explicit restored continuity from $used tokens with Memory $enabled without learning old text",
    async ({ used, enabled }) => {
      await service.action(
        { type: "configure", settings: { ...DEFAULT_MEMORY_SETTINGS, enabled } },
        async () => true,
      );
      const m = runtime();
      m.restore?.("Recovered constraint: preserve the old schema and unresolved failure.");
      const first = await m.prepare(
        { ...turn(), usage: { used, size: 128000, reportedAt: at } },
        new AbortController().signal,
      );
      if (used === 1000) {
        expect(first.rollover).toBe(false);
        first.validate?.();
        exchange(m, "A new live exchange");
        expect(
          (
            await m.prepare(
              { ...turn(), usage: { used: 95000, size: 128000, reportedAt: at } },
              new AbortController().signal,
            )
          ).rollover,
        ).toBe(true);
      } else expect(first.rollover).toBe(true);
      expect(helpers.sessions[0]?.prompts[0]).toContain(
        "Recovered constraint: preserve the old schema",
      );
      expect(store.snapshot().count).toBe(0);
      if (!enabled) expect(store.snapshot().conversations).toEqual([]);
      for (const conversation of store.snapshot().conversations)
        expect(
          store
            .range(conversation.id)
            .sources.map((source) => source.text)
            .join("\n"),
        ).not.toContain("Recovered constraint");
      m.dispose();
    },
  );
  it("preserves completed On-mode exchanges while an unrelated reindex mutation is pending", async () => {
    service.limits.capacity = 32000;
    const a = runtime();
    const b = runtime();
    emit(a, { type: "prompt", turn: 1, text: "Started before reindex" });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stop = vi.spyOn(service, "stopJobs").mockImplementation(() => gate);
    const pending = service.action({ type: "reindex" }, async () => true);
    await vi.waitFor(() => expect(stop).toHaveBeenCalled());
    emit(a, { type: "message", text: "Completed during reindex" });
    emit(a, { type: "turnEnd", turn: 1, stopReason: "end_turn", outcome: "finished" });
    exchange(b, "Started during reindex");
    await vi.waitFor(() => expect(store.snapshot().conversations).toHaveLength(2));
    release();
    await pending;
    expect(
      store
        .snapshot()
        .conversations.map((c) => store.range(c.id).sources.length)
        .sort(),
    ).toEqual([2, 3]);
    a.dispose();
    b.dispose();
    stop.mockRestore();
  });
  it("settles a cancelled queued continuity request before an unrelated active helper finishes", async () => {
    const source: MemorySource = {
      id: randomUUID(),
      conversationId: randomUUID(),
      role: "human",
      at,
      ordinal: 1,
      start: 0,
      text: "Live context",
    };
    helpers.startGate = new Promise<void>(() => {});
    const first = new AbortController();
    const active = service.summarize([source], "", first.signal);
    const activeRejected = expect(active).rejects.toThrow();
    await vi.waitFor(() => expect(helpers.specs).toHaveLength(1));
    const second = new AbortController();
    const queued = service.summarize([source], "", second.signal);
    const queuedRejected = expect(queued).rejects.toThrow(/cancelled/i);
    second.abort();
    await queuedRejected;
    expect(helpers.specs).toHaveLength(1);
    first.abort();
    await activeRejected;
  });
  it("continues after forgetting without requiring deleted checkpoints", async () => {
    const m = runtime();
    exchange(m);
    await m.prepare(turn(), new AbortController().signal);
    await service.action({ type: "forget-scope", projectId: null }, async () => true);
    const next = await m.prepare(turn(), new AbortController().signal);
    expect(next.rollover).toBe(true);
    expect(next.warning).toContain("forgotten");
    expect(next.context).toBe("");
    exchange(m);
    expect((await m.prepare(turn(), new AbortController().signal)).rollover).toBe(true);
    m.dispose();
  });
  it("fits a full Relay history window and many contract-bearing turns at default capacity", async () => {
    service.limits.capacity = 128000;
    const m = runtime();
    const contract = "Operating contract line.\n".repeat(240);
    const history = "😀文line\n".repeat(8000);
    const first = await m.prepare(
      { text: "Hello", delivered: `${contract}${history}Hello`, turn: 1, usage: null },
      new AbortController().signal,
    );
    expect(first.rollover).toBe(false);
    emit(m, { type: "prompt", turn: 1, text: "Hello" });
    for (let index = 2; index <= 12; index++) {
      const next = await m.prepare(
        { text: "Next", delivered: `${contract}Next`, turn: index, usage: null },
        new AbortController().signal,
      );
      expect(next.rollover).toBe(false);
      emit(m, { type: "prompt", turn: index, origin: "automatic", text: "Next" });
    }
    m.dispose();
  });
  it("counts automatic updates toward fallback capacity without capturing their text", async () => {
    const m = runtime();
    emit(m, { type: "prompt", turn: 1, origin: "automatic", text: "x".repeat(4500) });
    emit(m, { type: "turnEnd", turn: 1, stopReason: "end_turn", outcome: "finished" });
    expect((await m.prepare(turn(), new AbortController().signal)).rollover).toBe(true);
    expect(store.range(must(store.snapshot().conversations[0]).id).sources).toEqual([]);
    m.dispose();
  });
  it.each(["register", "range"])(
    "keeps reported-capacity handoff independent of %s storage failures and Memory Off",
    async (failed) => {
      const original = must(vi.mocked(service.call).getMockImplementation());
      vi.spyOn(service, "call").mockImplementation(async (op, ...args) => {
        if (op === failed) throw new Error("storage unavailable");
        return original(op, ...args);
      });
      const m = runtime();
      exchange(m);
      const request = { ...turn(), usage: { used: 8000, size: 8192, reportedAt: at } };
      const prepared = await m.prepare(request, new AbortController().signal);
      expect(prepared.rollover).toBe(true);
      service.settings.enabled = false;
      exchange(m);
      const next = await m.prepare(request, new AbortController().signal);
      expect(next.rollover).toBe(true);
      expect(next.used).toEqual([]);
      m.dispose();
    },
  );
  it("checkpoints committed ranges before rollover and rejects oversized requests without truncation", async () => {
    const m = runtime();
    exchange(m);
    const prepared = await m.prepare(turn(), new AbortController().signal);
    expect(prepared.rollover).toBe(true);
    expect(prepared.context).toContain("Historical continuity checkpoint");
    expect(helpers.sessions).toHaveLength(1);
    expect(store.range(must(store.snapshot().conversations[0]).id).sources).toEqual([]);
    await expect(m.prepare(turn("x".repeat(6000)), new AbortController().signal)).rejects.toThrow(
      "exceeds",
    );
    m.dispose();
  });
  it("treats missing generation as nonblocking while context fits, but pauses required handoff", async () => {
    const m = runtime();
    helpers.startError = new Error("Unavailable");
    expect((await m.prepare(turn(), new AbortController().signal)).rollover).toBe(false);
    exchange(m);
    await expect(m.prepare(turn(), new AbortController().signal)).rejects.toThrow();
    expect(store.checkpoint(must(store.snapshot().conversations[0]).id)).toBe("");
    m.dispose();
  });
  it("filters secrets, preserves source offsets and does not commit failed or cancelled exchanges", async () => {
    const m = runtime();
    emit(m, { type: "prompt", turn: 1, text: "password=supersecret" });
    emit(m, { type: "turnEnd", turn: 1, stopReason: "cancelled", outcome: "cancelled" });
    await m.prepare(turn(), new AbortController().signal);
    const cid = must(store.snapshot().conversations[0]).id;
    expect(store.range(cid).sources).toEqual([]);
    emit(m, { type: "prompt", turn: 2, text: "password=supersecret" });
    emit(m, { type: "turnEnd", turn: 2, stopReason: "end_turn", outcome: "finished" });
    await m.prepare(turn(), new AbortController().signal);
    expect(store.range(cid).sources[0]?.text).toBe("[REDACTED]");
    m.dispose();
  });
  it("keeps repeated handoffs working with Memory Off without persisted learning or recall", async () => {
    const m = runtime();
    await service.action(
      { type: "configure", settings: { ...DEFAULT_MEMORY_SETTINGS, enabled: false } },
      async () => true,
    );
    vi.mocked(service.call).mockClear();
    for (let i = 0; i < 3; i++) {
      exchange(m, `Off-mode request ${i}`);
      const result = await m.prepare(turn(), new AbortController().signal);
      expect(result.rollover).toBe(true);
      expect(result.context).toContain("Historical continuity checkpoint");
      expect(result.used).toEqual([]);
    }
    expect(service.call).not.toHaveBeenCalled();
    expect(store.snapshot().count).toBe(0);
    expect(store.snapshot().conversations).toEqual([]);
    expect(helpers.sessions).toHaveLength(3);
    expect(
      helpers.sessions
        .flatMap((s) => s.prompts)
        .every((prompt) => prompt.includes("Memory is off: memories must be an empty array")),
    ).toBe(true);
    m.dispose();
  });
  it("serializes generation, invalidates pending work on forgetting and requires confirmation for promotion", async () => {
    const m = runtime();
    exchange(m, "A short fact");
    // Drain capture without requiring handoff.
    service.limits.capacity = 32000;
    await m.prepare(turn(), new AbortController().signal);
    const cid = must(store.snapshot().conversations[0]).id;
    helpers.startGate = new Promise<void>(() => {});
    const pending = service.generate(cid);
    const rejection = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(helpers.specs).toHaveLength(1));
    await service.action({ type: "forget-scope", projectId: null }, async () => true);
    await rejection;
    expect(store.browse({}).records).toEqual([]);
    expect(store.range(cid).sources).toEqual([]);
    m.dispose();
  });
  it("does not backfill Off-mode text or a turn spanning Off and On", async () => {
    service.limits.capacity = 32000;
    const m = runtime();
    await m.prepare(turn(), new AbortController().signal);
    emit(m, { type: "prompt", turn: 1, text: "Do not learn this interrupted-on turn" });
    emit(m, { type: "message", text: "First fragment" });
    await service.action(
      { type: "configure", settings: { ...DEFAULT_MEMORY_SETTINGS, enabled: false } },
      async () => true,
    );
    emit(m, { type: "message", text: " Off-mode fragment" });
    await service.action(
      { type: "configure", settings: DEFAULT_MEMORY_SETTINGS },
      async () => true,
    );
    emit(m, { type: "message", text: " Final fragment" });
    emit(m, { type: "turnEnd", turn: 1, stopReason: "end_turn", outcome: "finished" });
    await m.prepare(turn(), new AbortController().signal);
    const cid = must(store.snapshot().conversations[0]).id;
    expect(store.range(cid).sources).toEqual([]);
    emit(m, { type: "prompt", turn: 2, text: "A new eligible fact" });
    emit(m, { type: "message", text: "A completed eligible reply" });
    emit(m, { type: "turnEnd", turn: 2, stopReason: "end_turn", outcome: "finished" });
    await m.prepare(turn(), new AbortController().signal);
    expect(store.range(cid).sources.map((source) => source.text)).toEqual([
      "A new eligible fact",
      "A completed eligible reply",
    ]);
    m.dispose();
  });
  it("cancels in-flight learning on Off and never publishes its late result", async () => {
    service.limits.capacity = 32000;
    const m = runtime();
    exchange(m);
    await m.prepare(turn(), new AbortController().signal);
    const cid = must(store.snapshot().conversations[0]).id;
    helpers.startGate = new Promise<void>(() => {});
    const learning = service.generate(cid);
    const rejected = expect(learning).rejects.toThrow();
    await vi.waitFor(() => expect(helpers.specs).toHaveLength(1));
    await service.action(
      { type: "configure", settings: { ...DEFAULT_MEMORY_SETTINGS, enabled: false } },
      async () => true,
    );
    await rejected;
    expect(store.snapshot().count).toBe(0);
    expect(store.range(cid).sources).toEqual([]);
    expect(store.checkpoint(cid)).toBe("");
    await service.action(
      { type: "configure", settings: DEFAULT_MEMORY_SETTINGS },
      async () => true,
    );
    expect(await service.generate(cid)).toBeUndefined();
    m.dispose();
  });
  it("rejects a stale recall preparation if Off is saved while search is in flight", async () => {
    const m = runtime();
    const original = must(vi.mocked(service.call).getMockImplementation());
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let searching = false;
    vi.mocked(service.call).mockImplementation(async (op, ...args) => {
      if (op === "search") {
        searching = true;
        await gate;
      }
      return original(op, ...args);
    });
    const preparing = m.prepare(turn(), new AbortController().signal);
    const rejected = expect(preparing).rejects.toThrow("changed");
    await vi.waitFor(() => expect(searching).toBe(true));
    await service.action(
      { type: "configure", settings: { ...DEFAULT_MEMORY_SETTINGS, enabled: false } },
      async () => true,
    );
    release();
    await rejected;
    const next = await m.prepare(turn(), new AbortController().signal);
    expect(next.used).toEqual([]);
    expect(next.context).toBe("");
    m.dispose();
  });
  it("invalidates prepared recall on Off and preserves continuity for an unsent handoff retry", async () => {
    const m = runtime();
    exchange(m);
    const prepared = await m.prepare(turn("Redis"), new AbortController().signal);
    expect(prepared.rollover).toBe(true);
    expect(prepared.used.length).toBeGreaterThan(0);
    await service.action(
      { type: "configure", settings: { ...DEFAULT_MEMORY_SETTINGS, enabled: false } },
      async () => true,
    );
    expect(() => prepared.validate?.()).toThrow("changed");
    const retried = await m.prepare(turn("Redis"), new AbortController().signal);
    expect(retried.rollover).toBe(true);
    expect(retried.used).toEqual([]);
    expect(retried.context).toContain("Historical continuity checkpoint");
    expect(() => retried.validate?.()).not.toThrow();
    m.dispose();
  });
  it("does not import a prior process's saved checkpoint into the live continuity buffer", async () => {
    const cid = store.register("relay:restart", "Old session", null).id;
    const source: MemorySource = {
      id: randomUUID(),
      conversationId: cid,
      role: "human",
      at,
      text: "Old session evidence",
      ordinal: 1,
      start: 0,
    };
    store.append(cid, "old", [source], true);
    const range = store.range(cid);
    const previous = generated([source]);
    previous.goal = "Old private checkpoint from another physical session";
    store.publish(cid, range.cursor, range.boundary, previous, "fixture");
    const m = must(service.attach(deps, "relay", null, "restart").memory)(
      { id: randomUUID() } as RunRecord,
      dir,
    );
    exchange(m, "Current live session evidence");
    expect((await m.prepare(turn(), new AbortController().signal)).rollover).toBe(true);
    expect(helpers.sessions).toHaveLength(2);
    const last = must(helpers.sessions.at(-1)).prompts[0] ?? "";
    expect(last).toContain("Memory is off:");
    expect(last).not.toContain("Old private checkpoint");
    m.dispose();
  });
  it("has no daily learning allowance and generates beyond the former 50-call limit", async () => {
    const cid = store.register("uncapped", "Uncapped", null).id;
    for (let i = 0; i < 55; i++) {
      const source: MemorySource = {
        id: randomUUID(),
        conversationId: cid,
        role: "human",
        at,
        text: `New fact ${i}`,
        ordinal: i,
        start: 0,
      };
      store.append(cid, String(i), [source], true);
      expect(await service.generate(cid)).toBeDefined();
    }
    expect(helpers.sessions).toHaveLength(55);
    expect(store.snapshot()).not.toHaveProperty("dailyCalls");
    expect(store.settings()).toEqual(DEFAULT_MEMORY_SETTINGS);
  });
  it("confirms retention changes, keeps cancellation unchanged and expires without opening Settings", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(at));
    const settings = { ...DEFAULT_MEMORY_SETTINGS, retentionDays: 30 as const };
    const declined = vi.fn(async () => false);
    expect(await service.action({ type: "configure", settings }, declined)).toBe(false);
    expect(store.settings().retentionDays).toBe(0);
    expect(declined).toHaveBeenCalledWith(
      "Automatically delete old memories?",
      expect.stringContaining("0 unpinned memories"),
    );
    const cid = store.register("expiry", "Expiry", null).id;
    const source: MemorySource = {
      id: randomUUID(),
      conversationId: cid,
      role: "human",
      at,
      text: "Expire me",
      ordinal: 1,
      start: 0,
    };
    store.append(cid, "1", [source], true);
    const range = store.range(cid);
    store.publish(cid, range.cursor, range.boundary, generated([source]), "fixture");
    await service.action({ type: "configure", settings }, async () => true);
    vi.setSystemTime(new Date(Date.parse(at) + 31 * 86400000));
    await vi.advanceTimersByTimeAsync(60000);
    expect(store.snapshot().count).toBe(0);
  });
  it("recalls project/global evidence with per-turn IDs and keeps worker assignments isolated", async () => {
    const one = await fs.mkdtemp(join(dir, "one-"));
    const two = await fs.mkdtemp(join(dir, "two-"));
    const saved = store.register("saved", "Saved", one);
    const s: MemorySource = {
      id: randomUUID(),
      conversationId: saved.id,
      role: "human",
      text: "Redis cache runs locally.",
      at,
      ordinal: 1,
      start: 0,
    };
    store.append(saved.id, "1", [s], true);
    const range = store.range(saved.id);
    store.publish(saved.id, range.cursor, range.boundary, generated([s]), "fixture");
    Object.assign(service.limits, { capacity: 32000, recallTokens: 4000 });
    const m = runtime("worker", one),
      other = runtime("worker", two);
    const result = await m.prepare(turn("Redis"), new AbortController().signal);
    expect(result.used).toHaveLength(1);
    expect(result.context).toContain("user-stated");
    expect(result.warning).toContain("lexical");
    expect((await other.prepare(turn("Redis"), new AbortController().signal)).used).toEqual([]);
    const r = must(store.browse({}).records[0]);
    expect(
      await service.action({ type: "promote", id: r.id, revision: r.revision }, async () => false),
    ).toBe(false);
    expect(store.detail(r.id).record.scope).toBe("project");
    await service.action({ type: "promote", id: r.id, revision: r.revision }, async () => true);
    expect((await other.prepare(turn("Redis"), new AbortController().signal)).used).toEqual([r.id]);
    m.dispose();
    other.dispose();
  });
  it("continues one logical run over repeated fresh ACP sessions without replay or stale events", async () => {
    const agents = new FakeAgents((_, s) => {
      s.update({ type: "message", text: "result ".repeat(80) });
      return "end_turn";
    });
    const records = new Runs();
    const attached = service.attach({ ...deps, agents }, "worker", dir);
    const orch = await createOrchestrator(
      { ...attached, store: records, ownerPid: 42, newRunId: () => "r1" },
      {
        mode: "interactive",
        prompt: "",
        agents: [{ name: "fixture", config: { command: ["fixture"] } }],
        base: "c0ffee",
        repoDir: dir,
        worktreeRoot: join(dir, "trees"),
        turnTimeoutMs: 120000,
        maxParallel: 1,
        policy: DEFAULT_PERMISSIONS,
        promptContext: () => "Trusted operating instructions.",
      },
    );
    orch.start();
    await vi.waitFor(() => expect(orch.runs()[0]?.status).toBe("idle"));
    for (let i = 0; i < 20; i++) {
      orch.reply("r1", `Request ${i}`);
      await vi.waitFor(() =>
        expect(records.events.filter((e) => e.type === "turnEnd")).toHaveLength(i + 1),
      );
      await flush();
    }
    expect(agents.sessions.length).toBeGreaterThan(3);
    const prompts = agents.sessions.flatMap((s) => s.prompts);
    expect(prompts).toHaveLength(20);
    prompts.forEach((p, i) => {
      expect(p).toContain(`Request ${i}`);
      expect(p).toContain("Trusted operating instructions.");
    });
    const before = records.events.length;
    must(agents.sessions[0]).update({ type: "message", text: "STALE" });
    expect(records.events).toHaveLength(before);
    expect(orch.runs()[0]?.id).toBe("r1");
    await orch.shutdown();
  });
});

it.skipIf(!sqliteFtsAvailable())(
  "binds explicit memory tools to registered live runs and propagates storage failures",
  async () => {
    const id = randomUUID();
    const memory = must(service.attach(deps, "project", dir).memory)({ id } as RunRecord, dir);
    exchange(memory);
    const call = vi.mocked(service.call);
    const original = must(call.getMockImplementation());
    call.mockImplementation(async (op, ...args) => {
      if (op === "agent-tool") {
        const cid = String(args[0]);
        if (args[1] === "code60_create_memory")
          return store.agentWrite(cid, "code60_create_memory", args[2]);
        return { status: "ok", records: store.eligible(cid), sources: store.tail(cid) };
      }
      return original(op, ...args);
    });
    const authorize = vi.fn();
    const retrieved = (await service.agentTool(
      id,
      "code60_retrieve_memories",
      { query: "" },
      authorize,
    )) as { sources: MemorySource[] };
    expect(retrieved.sources.length).toBeGreaterThan(0);
    const s = must(retrieved.sources[0]);
    const candidate = must(generated([s]).memories[0]);
    const created = (await service.agentTool(
      id,
      "code60_create_memory",
      { memory: candidate },
      authorize,
    )) as { status: string };
    expect(created.status).toBe("ok");
    expect(store.browse({}).records.some((r) => r.text === candidate.text)).toBe(true);
    expect(authorize).toHaveBeenCalled();
    await expect(
      service.agentTool(
        id,
        "code60_retrieve_memories",
        { query: "", projectId: randomUUID() },
        authorize,
      ),
    ).rejects.toThrow();
    expect(() =>
      service.agentTool("other-run", "code60_retrieve_memories", { query: "" }, authorize),
    ).toThrow(/unavailable/);
    await service.action(
      { type: "configure", settings: { ...service.settings, enabled: false } },
      async () => true,
    );
    const count = call.mock.calls.length;
    expect(
      await service.agentTool(id, "code60_retrieve_memories", { query: "" }, authorize),
    ).toEqual({ status: "disabled" });
    expect(call.mock.calls.length).toBe(count);
    await service.action(
      { type: "configure", settings: { ...service.settings, enabled: true } },
      async () => true,
    );
    call.mockRejectedValue(new Error("Storage unavailable"));
    await expect(
      service.agentTool(id, "code60_retrieve_memories", { query: "" }, authorize),
    ).rejects.toThrow("Storage unavailable");
    memory.dispose();
    expect(() =>
      service.agentTool(id, "code60_retrieve_memories", { query: "" }, authorize),
    ).toThrow(/unavailable/);
  },
);

it.skipIf(!sqliteFtsAvailable())(
  "rechecks live authorization after asynchronous memory preparation",
  async () => {
    const id = randomUUID();
    const memory = must(service.attach(deps, "relay", null).memory)({ id } as RunRecord, dir);
    let current = true;
    const authorize = () => {
      if (!current) throw new Error("Stale conversation");
    };
    const pending = service.agentTool(id, "code60_retrieve_memories", { query: "" }, authorize);
    current = false;
    await expect(pending).rejects.toThrow("Stale conversation");
    expect(vi.mocked(service.call).mock.calls.some(([op]) => op === "agent-tool")).toBe(false);
    memory.dispose();
  },
);

it.skipIf(!sqliteFtsAvailable()).each(["owner", "settings"] as const)(
  "discards memory reads when %s changes during sidecar I/O",
  async (change) => {
    const id = randomUUID();
    const memory = must(service.attach(deps, "relay", null).memory)({ id } as RunRecord, dir);
    const call = vi.mocked(service.call);
    const original = must(call.getMockImplementation());
    let finish: ((result: unknown) => void) | undefined;
    call.mockImplementation((op, ...args) =>
      op === "agent-tool"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : original(op, ...args),
    );
    let current = true;
    const pending = service.agentTool(id, "code60_retrieve_memories", { query: "" }, () => {
      if (!current) throw new Error("Stale owner");
    });
    await vi.waitFor(() => expect(finish).toBeDefined());
    if (change === "owner") current = false;
    else
      await service.action(
        { type: "configure", settings: { ...service.settings, enabled: false } },
        async () => true,
      );
    must(finish)({ status: "ok", records: ["stale evidence"] });
    await expect(pending).rejects.toThrow(change === "owner" ? "Stale owner" : "discard stale");
    memory.dispose();
  },
);
