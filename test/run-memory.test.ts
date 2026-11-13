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
  const orch = await createOrchestrator(
    {
      agents,
      clock: new FakeClock(),
      git: new FakeGit(),
      processes: new FakeProcesses(),
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
  return { orch, agents, records };
}
const notes = (events: RunEvent[]) => events.flatMap((e) => (e.type === "note" ? [e] : []));

describe("interactive run memory hooks", () => {
  it("never dispatches a request whose memory preparation failed and keeps its text", async () => {
    const memory: RunMemory = {
      event: () => {},
      prepare: async () => {
        throw new Error("handoff unavailable");
      },
      dispose: vi.fn(),
    };
    const { orch, agents, records } = await start(memory);
    orch.reply("r1", "Ship the fix");
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
    orch.reply("r1", "Continue");
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
