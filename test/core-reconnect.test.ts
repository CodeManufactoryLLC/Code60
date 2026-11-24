import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_PERMISSIONS } from "../src/core/config.js";
import { createOrchestrator } from "../src/core/orchestrator.js";
import type { SessionResourceControls } from "../src/core/session-resources.js";
import { FakeAgents, FakeClock, FakeGit, FakeProcesses, MemoryStore } from "./fakes.js";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "code60-reconnect-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
async function fixture(extra = false) {
  const agents = new FakeAgents();
  const records = new MemoryStore();
  const captured: SessionResourceControls[] = [];
  const cleanup = vi.fn(async () => {});
  const original = agents.restore.bind(agents);
  vi.spyOn(agents, "restore").mockImplementation(async (...args) =>
    Object.assign(await original(...args), { restoreSupported: true }),
  );
  const orch = await createOrchestrator(
    {
      agents,
      store: records,
      processes: new FakeProcesses(),
      clock: new FakeClock(),
      git: new FakeGit(),
      ownerPid: 42,
      newRunId: () => "r1",
    },
    {
      mode: "interactive",
      prompt: "",
      agents: [{ name: "fixture", config: { command: ["fixture"] } }],
      base: "c0ffee",
      repoDir: directory,
      worktreeRoot: join(directory, "trees"),
      turnTimeoutMs: 120000,
      maxParallel: 1,
      policy: DEFAULT_PERMISSIONS,
      ...(extra
        ? {
            env: { SAFE: "captured" },
            mcpServers: [{ name: "existing", command: "/fixed", args: [], env: [] }],
          }
        : {}),
      sessionResources: async ({ controls }) => {
        captured.push(controls);
        return { servers: [], beginTurn() {}, endTurn() {}, close: cleanup };
      },
    },
  );
  orch.start();
  await vi.waitFor(() => expect(orch.runs()[0]?.status).toBe("idle"));
  const controls = captured[0]!;
  return { agents, records, captured, cleanup, orch, controls };
}
it.each([false, true])(
  "replaces idle ACP resources with fresh restoration authority without replay (configured=%s)",
  async (extra) => {
    const f = await fixture(extra);
    try {
      expect(f.controls.idle()).toBe(true);
      expect(f.controls.canRestore()).toBe(false);
      await expect(f.controls.reconnect()).rejects.toThrow("idle");
      Object.assign(f.agents.sessions[0]!, { restoreSupported: true });
      expect(f.controls.canRestore()).toBe(true);
      await f.controls.reconnect();
      expect(f.agents.restores[0]?.sessionId).toBe(f.agents.sessions[0]?.sessionId);
      expect(f.captured).toHaveLength(2);
      expect(f.cleanup).toHaveBeenCalledOnce();
      expect(f.agents.sessions.flatMap((session) => session.prompts)).toEqual([]);
      expect(f.orch.runs()[0]?.status).toBe("idle");
      expect(f.controls.canRestore()).toBe(true);
      expect(await f.orch.reply("r1", "fresh authorized work")).toBe(true);
      await vi.waitFor(() => expect(f.orch.runs()[0]?.status).toBe("idle"));
      expect(f.agents.sessions[1]?.prompts).toEqual(["fresh authorized work"]);
    } finally {
      await f.orch.shutdown();
    }
  },
);
it("refuses active turns, mode changes and shutdown rather than replaying work", async () => {
  const f = await fixture();
  try {
    const raw = f.agents.sessions[0]!;
    Object.assign(raw, { restoreSupported: true });
    f.agents.script = () => "hang"; // The existing session's script is captured; install a fresh one.
    await f.controls.reconnect();
    const current = f.agents.sessions[1]!;
    expect(await f.orch.reply("r1", "active")).toBe(true);
    expect(f.controls.idle()).toBe(false);
    await expect(f.controls.reconnect()).rejects.toThrow("idle");
    current.endTurn("end_turn");
    await vi.waitFor(() => expect(f.orch.runs()[0]?.status).toBe("idle"));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const state = {
      model: null,
      usage: null,
      modes: {
        source: "config" as const,
        confirmed: true,
        reportedAt: "2026-11-24T00:00:00.000Z",
        controls: [
          {
            id: "permissions",
            name: "Permissions",
            currentValue: "ask",
            options: [{ value: "ask", name: "Ask" }],
          },
        ],
      },
    };
    Object.assign(current, { setMode: async () => gate, sessionState: state });
    current.update({ type: "sessionState", state });
    const changing = f.orch.setMode("r1", {
      source: "config",
      configId: "permissions",
      value: "ask",
    });
    expect(f.controls.idle()).toBe(false);
    await expect(f.controls.reconnect()).rejects.toThrow("idle");
    release();
    await changing;
    await f.orch.shutdown();
    expect(f.controls.idle()).toBe(false);
    await expect(f.controls.reconnect()).rejects.toThrow("idle");
  } finally {
    await f.orch.shutdown();
  }
});
it.each(["restore", "stop"] as const)(
  "settles a failed %s without replay and retains cleanup ownership",
  async (stage) => {
    const f = await fixture();
    const raw = f.agents.sessions[0]!;
    Object.assign(raw, { restoreSupported: true });
    if (stage === "restore") f.agents.restoreError = new Error("synthetic restoration failure");
    else vi.spyOn(raw, "stop").mockRejectedValueOnce(new Error("synthetic cleanup failure"));
    await expect(f.controls.reconnect()).rejects.toThrow("start a new session");
    await vi.waitFor(() => expect(f.orch.runs()[0]?.status).toBe("failed"));
    expect(f.agents.sessions.flatMap((session) => session.prompts)).toEqual([]);
    expect(f.controls.idle()).toBe(false);
    await f.orch.shutdown();
  },
);
