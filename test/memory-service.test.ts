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
import { sqliteAvailable } from "../src/desktop/projects.js";
import {
  FakeAgents,
  FakeClock,
  FakeGit,
  FakeProcesses,
  flush,
  MemoryStore as Runs,
} from "./fakes.js";

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
  service.settings = {
    ...DEFAULT_MEMORY_SETTINGS,
    capacity: 2048,
    recallTokens: 0,
    cadenceSeconds: 3600,
  };
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
        );
      case "reserve":
        return store.reserveCall(Number(args[0]));
      case "checkpoint":
        return store.checkpoint(String(args[0]));
      case "tail":
        return store.tail(String(args[0]));
      case "used":
        return store.markUsed(args[0] as string[]);
      case "snapshot":
        return store.snapshot();
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
});
afterEach(async () => {
  await service.close();
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
describe.skipIf(!sqliteAvailable())("scoped runtime memory and handoff", () => {
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
    service.settings = { ...service.settings, capacity: DEFAULT_MEMORY_SETTINGS.capacity };
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
    await expect(m.prepare(turn(), new AbortController().signal)).rejects.toThrow("checkpoint");
    expect(store.range(must(store.snapshot().conversations[0]).id).sources).toEqual([]);
    m.dispose();
  });
  it.each(["register", "range"])(
    "uses reported capacity when %s fails and bypasses disabled memory",
    async (failed) => {
      const original = must(vi.mocked(service.call).getMockImplementation());
      vi.spyOn(service, "call").mockImplementation(async (op, ...args) => {
        if (op === failed) throw new Error("storage unavailable");
        return original(op, ...args);
      });
      const m = runtime();
      const request = { ...turn(), usage: { used: 8000, size: 8192, reportedAt: at } };
      await expect(m.prepare(request, new AbortController().signal)).rejects.toThrow();
      service.settings.enabled = false;
      expect(await m.prepare(request, new AbortController().signal)).toEqual({
        context: "",
        rollover: false,
        used: [],
      });
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
  it("respects live per-conversation privacy and separate capture/recall switches", async () => {
    const m = runtime();
    await m.prepare(turn(), new AbortController().signal);
    const cid = must(store.snapshot().conversations[0]).id;
    await service.action(
      { type: "remember", conversationId: cid, enabled: false },
      async () => true,
    );
    exchange(m);
    await expect(m.prepare(turn(), new AbortController().signal)).rejects.toThrow("checkpoint");
    expect(store.range(cid).sources).toEqual([]);
    m.dispose();
  });
  it("serializes generation, invalidates pending work on forgetting and requires confirmation for promotion", async () => {
    const m = runtime();
    exchange(m, "A short fact");
    // Drain capture without requiring handoff.
    service.settings.capacity = 32000;
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
    service.settings = { ...service.settings, capacity: 32000, recallTokens: 4000 };
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
    for (let i = 0; i < 12; i++) {
      orch.reply("r1", `Request ${i}`);
      await vi.waitFor(() =>
        expect(records.events.filter((e) => e.type === "turnEnd")).toHaveLength(i + 1),
      );
      await flush();
    }
    expect(agents.sessions.length).toBeGreaterThan(3);
    const prompts = agents.sessions.flatMap((s) => s.prompts);
    expect(prompts).toHaveLength(12);
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
