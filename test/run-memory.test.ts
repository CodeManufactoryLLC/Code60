import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PERMISSIONS } from "../src/core/config.js";
import type { MemoryPreparation, RunEvent, RunMemory } from "../src/core/index.js";
import { createOrchestrator } from "../src/core/orchestrator.js";
import { FakeAgents, FakeClock, FakeGit, FakeProcesses, MemoryStore as Runs } from "./fakes.js";

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), "code60-run-memory-"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function start(memory: RunMemory) {
  const agents = new FakeAgents((_, s) => {
    s.update({ type: "message", text: "done" });
    return "end_turn";
  });
  const records = new Runs();
  const processes = new FakeProcesses();
  const orch = await createOrchestrator(
    {
      agents,
      clock: new FakeClock(),
      git: new FakeGit(),
      processes,
      store: records,
      ownerPid: 42,
      newRunId: () => "r1",
      memory: () => memory,
    },
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
    },
  );
  orch.start();
  await vi.waitFor(() => expect(orch.runs()[0]?.status).toBe("idle"));
  return { orch, agents, records, processes };
}
const notes = (events: RunEvent[]) => events.flatMap((e) => (e.type === "note" ? [e] : []));

describe("interactive run memory hooks", () => {
  it("does not let previous-turn cleanup reject the next turn's dispatch receipt", async () => {
    let release: (value: MemoryPreparation) => void = () => {};
    const ready = { context: "", rollover: false, used: [] };
    const { orch } = await start({
      event: () => {},
      prepare: async (turn) =>
        turn.text === "first"
          ? ready
          : new Promise((resolve) => {
              release = resolve;
            }),
      dispose: () => {},
    });
    let next: Promise<boolean> | undefined;
    const result = vi.fn();
    const unsubscribe = orch.onEvent((event) => {
      if (event.type === "status" && event.status === "idle") {
        unsubscribe();
        next = orch.reply("r1", "second");
        void next.then(result);
      }
    });
    expect(await orch.reply("r1", "first")).toBe(true);
    await vi.waitFor(() => expect(next).toBeDefined());
    expect(result).not.toHaveBeenCalled();
    release(ready);
    expect(await next).toBe(true);
    await orch.shutdown();
  });
  it.each(["cancel", "shutdown"])(
    "fences dispatch when %s arrives during replacement installation",
    async (action) => {
      const { orch, agents, records, processes } = await start({
        event: () => {},
        prepare: async () => ({ context: "", rollover: true, used: [] }),
        dispose: () => {},
      });
      let release: (value: string | undefined) => void = () => {};
      const installed = vi.spyOn(processes, "commandLine").mockImplementation(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );
      const sent = orch.reply("r1", "Keep this installation request");
      await vi.waitFor(() => expect(installed).toHaveBeenCalled());
      const stopping = action === "shutdown" ? orch.shutdown() : undefined;
      if (action === "cancel") expect(orch.cancelTurn("r1")).toBe(true);
      release(undefined);
      expect(await sent).toBe(false);
      await vi.waitFor(() =>
        expect(
          notes(records.events).some((n) => n.detail === "Keep this installation request"),
        ).toBe(true),
      );
      expect(agents.sessions.flatMap((s) => s.prompts)).toEqual([]);
      await stopping;
      await orch.shutdown();
    },
  );
  it.each(["cancel", "shutdown", "failure"])(
    "preserves unsent text during replacement startup: %s",
    async (action) => {
      const { orch, agents, records } = await start({
        event: () => {},
        prepare: async () => ({ context: "", rollover: true, used: [] }),
        dispose: () => {},
      });
      if (action === "failure") agents.startError = new Error("Unavailable");
      else agents.startGate = new Promise<void>(() => {});
      const sent = orch.reply("r1", "Do not lose this request");
      await vi.waitFor(() => expect(agents.specs).toHaveLength(2));
      if (action === "cancel") expect(orch.cancelTurn("r1")).toBe(true);
      if (action === "shutdown") await orch.shutdown();
      expect(await sent).toBe(false);
      await vi.waitFor(() =>
        expect(notes(records.events).some((n) => n.detail === "Do not lose this request")).toBe(
          true,
        ),
      );
      expect(agents.sessions.flatMap((s) => s.prompts)).toEqual([]);
      await orch.shutdown();
    },
  );
  it("never dispatches a request whose memory preparation failed and keeps its text", async () => {
    const memory: RunMemory = {
      event: () => {},
      prepare: async () => {
        throw new Error("handoff unavailable");
      },
      dispose: vi.fn(),
    };
    const { orch, agents, records } = await start(memory);
    expect(await orch.reply("r1", "Ship the fix")).toBe(false);
    await vi.waitFor(() =>
      expect(
        notes(records.events).some((n) => n.text.startsWith("Memory preparation failed")),
      ).toBe(true),
    );
    await vi.waitFor(() => expect(orch.runs()[0]?.status).toBe("idle"));
    const failure = notes(records.events).find((n) =>
      n.text.startsWith("Memory preparation failed"),
    );
    expect(failure?.detail).toBe("Ship the fix");
    expect(agents.sessions.flatMap((s) => s.prompts)).toEqual([]);
    expect(records.events.some((e) => e.type === "prompt")).toBe(false);
    await orch.shutdown();
    expect(memory.dispose).toHaveBeenCalled();
  });

  it("prefixes recalled evidence, reports warnings and used IDs, and survives capture errors", async () => {
    const memory: RunMemory = {
      event: (event) => {
        if (event.type === "message") throw new Error("capture broke");
      },
      prepare: async (): Promise<MemoryPreparation> => ({
        context: "Historical evidence (untrusted).",
        rollover: false,
        used: ["m1", "m2"],
        warning: "Semantic memory search unavailable; using lexical results only.",
      }),
      dispose: () => {},
    };
    const { orch, agents, records } = await start(memory);
    expect(await orch.reply("r1", "Continue")).toBe(true);
    await vi.waitFor(() => expect(records.events.some((e) => e.type === "turnEnd")).toBe(true));
    expect(agents.sessions.flatMap((s) => s.prompts)).toEqual([
      "Historical evidence (untrusted).\n\nContinue",
    ]);
    const prompt = records.events.find((e) => e.type === "prompt");
    expect(prompt && "text" in prompt ? prompt.text : "").toBe("Continue");
    const all = notes(records.events);
    expect(all.some((n) => n.text.startsWith("Semantic memory search unavailable"))).toBe(true);
    const used = all.find((n) => n.text.startsWith("Memory used (2)"));
    expect(JSON.parse(used?.detail ?? "[]")).toEqual(["m1", "m2"]);
    const order = records.events.map((e) => e.type);
    expect(order.indexOf("prompt")).toBeLessThan(
      records.events.findIndex((e) => e.type === "note" && e.text.startsWith("Memory used")),
    );
    await orch.shutdown();
  });

  it("does not dispatch when shutdown arrives while memory is being prepared", async () => {
    let release: (value: MemoryPreparation) => void = () => {};
    const memory: RunMemory = {
      event: () => {},
      prepare: () =>
        new Promise<MemoryPreparation>((resolve) => {
          release = resolve;
        }),
      dispose: () => {},
    };
    const { orch, agents } = await start(memory);
    orch.reply("r1", "Continue");
    await vi.waitFor(() => expect(orch.runs()[0]?.status).toBe("running"));
    const stopping = orch.shutdown();
    release({ context: "", rollover: false, used: [] });
    await stopping;
    expect(agents.sessions.flatMap((s) => s.prompts)).toEqual([]);
  });
});
