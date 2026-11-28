import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../src/core/config.js";
import type { ModeChange, RunMemory, SessionSelection, SessionState } from "../src/core/index.js";
import { createOrchestrator } from "../src/core/orchestrator.js";
import { buildHandoffPrompt, HANDOFF_PROMPT_LIMIT } from "../src/core/recovery.js";
import type { RunEvent, RunRecord } from "../src/core/types.js";
import { FakeAgents, FakeClock, FakeGit, FakeProcesses, flush, MemoryStore } from "./fakes.js";

const makeRecord = (patch: Partial<RunRecord> = {}): RunRecord => ({
  id: "run-1",
  agent: "claude",
  status: "interrupted",
  firstPrompt: "Add a feature",
  turns: 1,
  base: "abc123",
  branch: "code60/run-1",
  worktree: "/repo.worktrees/run-1",
  ownerPid: 50,
  agentPid: 99,
  agentCommand: ["claude", "acp"],
  agentCommandLine: "claude acp",
  acpSessionId: "acp-session-1",
  startedAt: "2026-01-01T00:00:00.000Z",
  reason: "the owning process is gone",
  ...patch,
});
const recordWithoutAcpId = (): RunRecord => {
  const record = makeRecord();
  delete record.acpSessionId;
  return record;
};

async function setup(
  record = makeRecord(),
  agents = new FakeAgents(),
  prompts?: Partial<typeof DEFAULT_CONFIG.prompts>,
  memory?: RunMemory,
  initialSettings?: readonly SessionSelection[],
) {
  const store = new MemoryStore();
  await store.save(record);
  const git = new FakeGit();
  const clock = new FakeClock();
  const processes = new FakeProcesses();
  const orchestrator = await createOrchestrator(
    {
      agents,
      git,
      store,
      clock,
      processes,
      ownerPid: 500,
      ...(memory ? { memory: () => memory } : {}),
    },
    {
      mode: "interactive",
      agents: [{ name: record.agent, config: { command: ["claude", "acp"] } }],
      recovery: record,
      base: record.base ?? "",
      repoDir: "/repo",
      worktreeRoot: "/unused",
      turnTimeoutMs: 30_000,
      maxParallel: 1,
      policy: DEFAULT_CONFIG.permissions,
      initialSettings: () => initialSettings,
      ...(prompts === undefined ? {} : { prompts: { ...DEFAULT_CONFIG.prompts, ...prompts } }),
    },
  );
  return { record, agents, git, store, processes, orchestrator };
}

describe("ended run recovery", () => {
  it.each(["restore", "handoff"] as const)(
    "applies saved defaults only to a fresh %s connection",
    async (method) => {
      const agents = new FakeAgents();
      const changes: ModeChange[] = [];
      const create = agents.start.bind(agents);
      const restore = agents.restore.bind(agents);
      const install = async (session: Awaited<ReturnType<typeof create>>) => {
        const state: SessionState = {
          model: null,
          modes: null,
          usage: null,
          settings: {
            confirmed: true,
            reportedAt: "2026-11-16T00:00:00.000Z",
            controls: [
              {
                id: "model",
                category: "model",
                name: "Model",
                currentValue: "m1",
                options: [{ value: "m2", name: "Two" }],
              },
            ],
          },
        };
        return Object.assign(session, {
          sessionState: state,
          setMode: async (change: ModeChange) => {
            changes.push(change);
            const fake = agents.sessions.find((agent) => agent === session);
            if (!fake) throw new Error("Missing fake session");
            const answer = await fake.requestPermission({
              kind: "execute",
              title: "Apply default",
              toolCallId: "mode",
            });
            if (answer !== "allow") throw new Error("Permission denied");
            const control = state.settings?.controls[0];
            if (control) control.currentValue = change.value;
          },
        });
      };
      agents.start = async (spec, signal) => install(await create(spec, signal));
      agents.restore = async (spec, id, signal) => install(await restore(spec, id, signal));
      const { orchestrator } = await setup(undefined, agents, undefined, undefined, [
        { configId: "model", value: "m2", name: "Two" },
      ]);
      try {
        if (method === "restore") await orchestrator.restore("run-1");
        else {
          await orchestrator.handoff("run-1", "Summary", "Continue", "Fresh session");
          const request = orchestrator.runs()[0]?.pending[0];
          if (!request) throw new Error("Missing handoff option request");
          expect(agents.sessions[0]?.prompts).toHaveLength(0);
          expect(orchestrator.answerPermission(request.id, "allow")).toBe(true);
        }
        await flush();
        expect(changes).toHaveLength(method === "restore" ? 0 : 1);
        expect(agents.sessions[0]?.prompts).toHaveLength(method === "restore" ? 0 : 1);
      } finally {
        await orchestrator.shutdown(true);
      }
    },
  );
  it.each(["restore", "handoff"])(
    "seeds only explicit live continuity during %s without replaying historical prompts",
    async (mode) => {
      const seed = vi.fn();
      const memory: RunMemory = {
        restore: seed,
        prepare: async () => ({ context: "", rollover: false, used: [] }),
        event() {},
        dispose() {},
      };
      const { record, agents, store, orchestrator } = await setup(
        undefined,
        undefined,
        undefined,
        memory,
      );
      await store.appendEvent({
        type: "prompt",
        runId: record.id,
        at: record.startedAt,
        turn: 1,
        text: "Historical constraint: retain the schema",
      });
      if (mode === "restore") {
        await orchestrator.restore(record.id);
        expect(seed).toHaveBeenCalledWith(
          expect.stringContaining("Historical constraint: retain the schema"),
        );
        expect(agents.sessions[0]?.prompts).toEqual([]);
      } else {
        await orchestrator.handoff(
          record.id,
          "Recovered schema constraint",
          "Continue",
          "Not supported",
        );
        expect(seed).toHaveBeenCalledWith("Recovered schema constraint");
        await vi.waitFor(() => expect(orchestrator.runs()[0]?.status).toBe("idle"));
        expect(agents.sessions[0]?.prompts).toHaveLength(1);
      }
      await orchestrator.shutdown(true);
    },
  );
  it("restores the saved ACP session in the existing worktree without replaying the prompt", async () => {
    const { record, agents, git, store, orchestrator } = await setup();
    const promptEvent: RunEvent = {
      runId: record.id,
      at: "2026-01-01T00:00:01.000Z",
      type: "prompt",
      turn: 1,
      text: record.firstPrompt,
    };
    await store.appendEvent(promptEvent);

    await expect(orchestrator.restore(record.id)).resolves.toEqual({ type: "restored" });

    expect(agents.restores).toEqual([
      {
        sessionId: "acp-session-1",
        spec: { name: "claude", command: ["claude", "acp"], cwd: record.worktree },
      },
    ]);
    expect(agents.sessions[0]?.prompts).toEqual([]);
    expect(git.worktrees).toEqual([]);
    expect(orchestrator.runs()[0]).toMatchObject({
      id: record.id,
      status: "idle",
      reason: expect.stringContaining("previous turn was interrupted"),
      branch: record.branch,
      worktree: record.worktree,
      turns: 1,
    });
    expect(record.acpSessionId).toBe("acp-session-1");
    expect(record.ownerPid).toBe(500);
    expect(await store.readEvents(record.id)).toEqual([
      promptEvent,
      expect.objectContaining({ type: "note", text: "Reconnected to the earlier agent session." }),
      expect.objectContaining({ type: "status", status: "idle" }),
    ]);
    await orchestrator.shutdown(true);
  });

  it.each(["finished", "failed", "cancelled", "timed_out"] as const)(
    "restores a run that previously ended as %s",
    async (status) => {
      const { record, agents, orchestrator } = await setup(
        makeRecord({ status, reason: `previously ${status}` }),
      );

      await expect(orchestrator.restore(record.id)).resolves.toEqual({ type: "restored" });

      expect(orchestrator.runs()[0]).toMatchObject({
        status: "idle",
        reason: expect.stringContaining(`previously ended with status ${status}`),
      });
      expect(agents.sessions[0]?.prompts).toEqual([]);
      await orchestrator.shutdown(true);
    },
  );

  it.each(["queued", "running", "waiting", "idle"] as const)(
    "refuses to recover an active %s run",
    async (status) => {
      const { agents, orchestrator, record } = await setup(makeRecord({ status }));

      await expect(orchestrator.restore(record.id)).rejects.toThrow(
        /only ended runs can be recovered/,
      );
      expect(agents.restores).toHaveLength(0);
    },
  );

  it.each([
    ["missing ACP ID", recordWithoutAcpId()],
    ["restore unsupported", makeRecord()],
  ])("offers a handoff for %s and leaves the record interrupted", async (caseName, record) => {
    const agents = new FakeAgents();
    if (caseName === "restore unsupported") agents.restoreUnavailable = true;
    const { orchestrator, record: saved } = await setup(record, agents);
    const result = await orchestrator.restore(saved.id);
    expect(result.type).toBe("handoff-required");
    expect(saved.status).toBe("interrupted");
    expect(saved.reason).toBe("the owning process is gone");
    expect(agents.sessions).toHaveLength(0);
    expect(agents.specs).toHaveLength(0);
    if (caseName === "missing ACP ID") expect(agents.restores).toHaveLength(0);
  });

  it("leaves a run interrupted when ACP restoration fails", async () => {
    const agents = new FakeAgents();
    agents.restoreError = new Error("ACP connection failed");
    const { orchestrator, record, store } = await setup(undefined, agents);
    const originalEvents = await store.readEvents(record.id);

    await expect(orchestrator.restore(record.id)).resolves.toEqual({
      type: "handoff-required",
      reason: "ACP connection failed",
    });

    expect(record.status).toBe("interrupted");
    expect(record.reason).toBe("the owning process is gone");
    expect(await store.readEvents(record.id)).toEqual(originalEvents);
    expect(agents.sessions).toHaveLength(0);
  });

  it("refuses to start a second writer while the old process group is alive", async () => {
    const { agents, processes, orchestrator, record, git } = await setup();
    processes.groups.add(record.agentPid as number);

    await expect(orchestrator.restore(record.id)).rejects.toThrow(/stop it before retrying/);

    expect(agents.restores).toHaveLength(0);
    expect(git.worktrees).toHaveLength(0);
    expect(record.status).toBe("interrupted");
  });

  it("sends a handoff and new message together while preserving run identity and transcript", async () => {
    const agents = new FakeAgents(() => "hang");
    const { orchestrator, record, git, store } = await setup(undefined, agents);
    const originalPrompt = record.firstPrompt;
    const events: RunEvent[] = [
      {
        runId: record.id,
        at: "2026-01-01T00:00:00.000Z",
        type: "prompt",
        turn: 1,
        text: "Add a feature",
      },
      {
        runId: record.id,
        at: "2026-01-01T00:00:02.000Z",
        type: "message",
        text: "I updated the implementation.",
      },
      {
        runId: record.id,
        at: "2026-01-01T00:00:03.000Z",
        type: "toolCall",
        toolCallId: "tool-1",
        title: "Edit file",
        kind: "edit",
        status: "completed",
      },
    ];
    for (const event of events) await store.appendEvent(event);
    const prompt = buildHandoffPrompt(record, events);

    const message = "Now add tests for the feature.";
    await orchestrator.handoff(record.id, prompt, message, "Restore is unavailable.");
    await flush();

    expect(agents.specs[0]?.cwd).toBe(record.worktree);
    expect(agents.sessions[0]?.prompts).toHaveLength(1);
    expect(agents.sessions[0]?.prompts[0]).toContain(prompt);
    expect(agents.sessions[0]?.prompts[0]).toContain(message);
    expect(await store.readEvents(record.id)).toEqual([
      ...events,
      expect.objectContaining({ type: "note", detail: prompt }),
      expect.objectContaining({ type: "status", status: "running" }),
      expect.objectContaining({ type: "prompt", text: message, turn: 2 }),
    ]);
    expect(record.firstPrompt).toBe(originalPrompt);
    expect(record.id).toBe("run-1");
    expect(record.branch).toBe("code60/run-1");
    expect(record.worktree).toBe("/repo.worktrees/run-1");
    expect(record.acpSessionId).toBe("fake-session-1000");
    expect(git.worktrees).toHaveLength(0);
    expect(orchestrator.runs()[0]?.status).toBe("running");
    await orchestrator.shutdown(true);
  });

  it.each([
    ["", "Continue", /handoff is empty/],
    ["a".repeat(HANDOFF_PROMPT_LIMIT + 1), "Continue", /size limit/],
    ["Summary", "  ", /message is empty/],
  ])("rejects invalid handoff input before starting an agent", async (summary, text, error) => {
    const { orchestrator, agents, record } = await setup();
    await expect(orchestrator.handoff(record.id, summary, text, "Unavailable")).rejects.toThrow(
      error,
    );
    expect(agents.specs).toHaveLength(0);
    expect(record.status).toBe("interrupted");
  });

  it("keeps handoff content bounded and instructs the new agent to verify before acting", () => {
    const prompt = buildHandoffPrompt(makeRecord(), [
      {
        runId: "run-1",
        at: "now",
        type: "message",
        text: "a".repeat(20_000),
      },
    ]);
    expect(prompt.length).toBeLessThanOrEqual(HANDOFF_PROMPT_LIMIT);
    expect(prompt).toContain("Inspect the worktree");
    expect(prompt.toLowerCase()).toContain("verify what completed");
    expect(prompt).toContain("[Handoff context truncated");
  });

  it("fills a custom summary template and still bounds the result", () => {
    const record = makeRecord({ branch: null, base: null });
    const events: RunEvent[] = [
      { runId: "run-1", at: "now", type: "message", text: "{{status}} stays literal" },
    ];
    expect(buildHandoffPrompt(record, events, "{{agent}}/{{branch}}/{{base}}: {{messages}}")).toBe(
      "claude/none/none: {{status}} stays literal",
    );
    const long = buildHandoffPrompt(record, [], `{{status}} ${"x".repeat(7_000)}`, 1_000);
    expect(long.length).toBe(1_000);
    expect(long).toMatch(/^interrupted x+/);
  });

  it("sends the handoff turn through the configured template", async () => {
    const { orchestrator, agents, record } = await setup(makeRecord(), new FakeAgents(), {
      ...DEFAULT_CONFIG.prompts,
      "handoff.first-turn": "[{{summary}}] user: {{message}}",
    });
    await orchestrator.handoff(record.id, "Summary", "Next step", "Unavailable");
    await flush();
    expect(agents.sessions[0]?.prompts).toEqual(["[Summary] user: Next step"]);
    await orchestrator.shutdown(true);
  });
});

describe("session information on recovery", () => {
  const previous = {
    model: { id: "old", name: "Old model", reportedAt: "2026-11-07T12:00:00.000Z" },
    usage: null,
    modes: null,
  };
  it("replaces saved state with the restored agent's report", async () => {
    const record = makeRecord({ sessionState: previous });
    const { agents, orchestrator, store } = await setup(record);
    const restore = agents.restore.bind(agents);
    agents.restore = async (spec, id, signal) =>
      Object.assign(await restore(spec, id, signal), {
        sessionState: { ...previous, model: { ...previous.model, id: "new", name: "New model" } },
      });
    await orchestrator.restore(record.id);
    expect(orchestrator.runs()[0]?.sessionState?.model?.id).toBe("new");
    expect(store.records.get(record.id)?.sessionState?.model?.id).toBe("new");
    await orchestrator.shutdown();
  });
  it("clears old information when a fresh handoff has no report", async () => {
    const record = makeRecord({ sessionState: previous });
    const { orchestrator, store } = await setup(record);
    await orchestrator.handoff(record.id, "summary", "continue", "restoration unavailable");
    await flush();
    expect(store.records.get(record.id)?.sessionState).toEqual({
      model: null,
      usage: null,
      modes: null,
    });
    await orchestrator.shutdown();
  });

  it.each([false, true] as const)(
    "resolves shutdown(force=%s) during in-flight restore without leaking a late session",
    async (force) => {
      const agents = new FakeAgents();
      let releaseRestore!: () => void;
      const gate = new Promise<void>((resolve) => {
        releaseRestore = resolve;
      });
      let entered!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const origRestore = agents.restore.bind(agents);
      agents.restore = async (spec, id, _signal) => {
        entered();
        await gate;
        return origRestore(spec, id, new AbortController().signal);
      };
      const { record, orchestrator } = await setup(makeRecord(), agents);

      const restoring = orchestrator.restore(record.id);
      await started;
      await expect(orchestrator.restore(record.id)).rejects.toThrow(/only ended runs/);

      const shuttingDown = orchestrator.shutdown(force);
      releaseRestore();
      expect((await restoring).type).toBe("handoff-required");
      await shuttingDown;

      expect(agents.sessions).toHaveLength(1);
      expect(agents.sessions[0]?.stops).toContain(0);
      expect(record.status).toBe("interrupted");
    },
  );

  it("resolves shutdown immediately on an unstarted or failed recovery orchestrator", async () => {
    const agents = new FakeAgents();
    agents.restoreUnavailable = true;
    const { record, orchestrator } = await setup(makeRecord(), agents);
    expect((await orchestrator.restore(record.id)).type).toBe("handoff-required");
    await orchestrator.shutdown(false);
    expect(record.status).toBe("interrupted");
  });
});
