import { describe, expect, it, vi } from "vitest";
import type { LogInput } from "../src/contracts/index.js";
import { DEFAULT_PERMISSIONS } from "../src/core/config.js";
import { createOrchestrator } from "../src/core/orchestrator.js";
import { FakeAgents, FakeClock, FakeGit, FakeProcesses, flush, MemoryStore } from "./fakes.js";

async function fixture(log: (input: LogInput) => void, count = 2) {
  const agents = new FakeAgents(() => "hang");
  const clock = new FakeClock();
  const store = new MemoryStore();
  let id = 0;
  const orchestrator = await createOrchestrator(
    {
      log,
      agents,
      clock,
      store,
      git: new FakeGit(),
      processes: new FakeProcesses(),
      ownerPid: 42,
      newRunId: () => `r${++id}`,
    },
    {
      mode: "interactive",
      prompt: "private prompt api_key=DO-NOT-LOG",
      base: "abc",
      repoDir: "/private/repository",
      worktreeRoot: "/private/worktrees",
      turnTimeoutMs: 10000,
      maxParallel: count,
      cancelGraceMs: 100,
      killGraceMs: 10,
      policy: DEFAULT_PERMISSIONS,
      agents: Array.from({ length: count }, () => ({
        name: "claude",
        config: { command: ["private-command", "--token=secret"] as [string, ...string[]] },
      })),
    },
  );
  orchestrator.start();
  await flush();
  return { orchestrator, agents, clock, store };
}
describe("desktop-only lifecycle diagnostics", () => {
  it("correlates overlapping turns and records once-only permission, cancellation and cleanup boundaries exactly once", async () => {
    const records: LogInput[] = [];
    const { orchestrator, agents, clock } = await fixture((record) => records.push(record));
    const first = agents.sessions[0];
    const second = agents.sessions[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(
      await first?.requestPermission({
        kind: "read",
        toolCallId: "tool-secret",
        title: "private title",
      }),
    ).toBe("allow");
    const approval = second?.requestPermission({
      kind: "execute",
      toolCallId: "private-tool",
      title: "secret command",
    });
    await flush();
    const permission = orchestrator.runs()[1]?.pending[0];
    expect(orchestrator.answerPermission(permission?.id as string, "deny")).toBe(true);
    expect(await approval).toBe("deny");
    if (first) first.onCancel = "ignore";
    orchestrator.cancelTurn("r1");
    orchestrator.cancelTurn("r1");
    await clock.advance(100);
    second?.endTurn("end_turn");
    await flush();
    await orchestrator.shutdown();
    for (const runId of ["r1", "r2"]) {
      const owned = records.filter((record) => record.runId === runId);
      expect(owned.filter((record) => record.event === "dispatch.accepted")).toHaveLength(1);
      expect(owned.filter((record) => record.event === "worktree.create")).toHaveLength(1);
      expect(owned.filter((record) => record.event === "turn.start")).toHaveLength(1);
      expect(owned.filter((record) => record.event === "turn.end")).toHaveLength(1);
      expect(owned.filter((record) => record.event === "process.stopped")).toHaveLength(1);
      expect(owned.filter((record) => record.event === "permission.decided")).toHaveLength(1);
      const start = owned.find((record) => record.event === "turn.start");
      const end = owned.find((record) => record.event === "turn.end");
      expect(end?.operationId).toBe(start?.operationId);
      expect(end?.durationMs).toBeGreaterThanOrEqual(0);
    }
    expect(records.filter((record) => record.event === "cancel.requested")).toHaveLength(1);
    expect(records.filter((record) => record.event === "cancel.escalated")).toHaveLength(1);
    const starts = records.filter((record) => record.event === "turn.start");
    expect(starts[0]?.operationId).not.toBe(starts[1]?.operationId);
    expect(JSON.stringify(records)).not.toMatch(/private|secret|DO-NOT-LOG/);
  });
  it("does not change lifecycle or transcripts when the optional diagnostic sink throws", async () => {
    const { orchestrator, agents, store } = await fixture(() => {
      throw new Error("broken logging");
    }, 1);
    agents.sessions[0]?.endTurn("end_turn");
    await flush();
    await orchestrator.shutdown();
    expect(orchestrator.runs()[0]?.status).toBe("finished");
    expect(store.events.find((event) => event.type === "prompt")).toMatchObject({
      text: "private prompt api_key=DO-NOT-LOG",
    });
  });
  it("gives follow-up turns separate correlation and coalesces persistence failures without losing transcript delivery", async () => {
    const records: LogInput[] = [];
    const { orchestrator, agents, store, clock } = await fixture(
      (record) => records.push(record),
      1,
    );
    agents.sessions[0]?.endTurn("end_turn");
    await flush();
    expect(orchestrator.runs()[0]?.status).toBe("idle");
    vi.spyOn(store, "appendEvent").mockRejectedValue(new Error("api_key=private"));
    vi.spyOn(store, "save").mockRejectedValue(new Error("private filesystem"));
    orchestrator.reply("r1", "second private prompt");
    await clock.advance(10000);
    await orchestrator.shutdown();
    const starts = records.filter((record) => record.event === "turn.start");
    const ends = records.filter((record) => record.event === "turn.end");
    expect(starts).toHaveLength(2);
    expect(ends).toHaveLength(2);
    expect(new Set(starts.map((record) => record.operationId)).size).toBe(2);
    expect(ends[1]).toMatchObject({
      operationId: starts[1]?.operationId,
      outcome: "timed_out",
      durationMs: 10000,
    });
    expect(records.filter((record) => record.event === "persistence.failed")).toHaveLength(1);
    expect(JSON.stringify(records)).not.toMatch(/private|api_key/);
    vi.restoreAllMocks();
  });
  it.each(["restore", "handoff", "failed-restore"] as const)(
    "records %s boundaries without recovery payloads",
    async (mode) => {
      const records: LogInput[] = [];
      const agents = new FakeAgents();
      if (mode === "failed-restore") agents.restoreError = new Error("token=private");
      const recovery = {
        id: "recovered",
        agent: "claude",
        status: "interrupted" as const,
        firstPrompt: "private first prompt",
        turns: 1,
        base: "abc",
        branch: "code60/recovered",
        worktree: "/private/worktree",
        ownerPid: 1,
        acpSessionId: "private-acp-session",
        startedAt: "2026-01-01T00:00:00.000Z",
      };
      const orchestrator = await createOrchestrator(
        {
          log: (record) => records.push(record),
          agents,
          git: new FakeGit(),
          store: new MemoryStore(),
          clock: new FakeClock(),
          processes: new FakeProcesses(),
          ownerPid: 42,
        },
        {
          mode: "interactive",
          recovery,
          repoDir: "/private/repo",
          worktreeRoot: "/private/trees",
          base: "abc",
          maxParallel: 1,
          turnTimeoutMs: 1000,
          policy: DEFAULT_PERMISSIONS,
          agents: [{ name: "claude", config: { command: ["private-command"] } }],
        },
      );
      if (mode === "handoff") {
        await orchestrator.handoff(
          "recovered",
          "private summary",
          "private reply",
          "private reason",
        );
        await flush();
      } else {
        const result = orchestrator.restore("recovered");
        if (mode === "failed-restore")
          await expect(result).resolves.toMatchObject({ type: "handoff-required" });
        else await expect(result).resolves.toEqual({ type: "restored" });
      }
      const boundaries = records.filter((record) => record.event.startsWith("recovery."));
      expect(boundaries).toHaveLength(2);
      expect(boundaries[1]).toMatchObject({
        operationId: boundaries[0]?.operationId,
        outcome: mode === "failed-restore" ? "failed" : "succeeded",
      });
      expect(JSON.stringify(records)).not.toMatch(/private|token=/);
      if (mode === "failed-restore") {
        agents.restoreError = undefined;
        await orchestrator.restore("recovered");
      }
      await orchestrator.shutdown(true);
    },
  );
});
