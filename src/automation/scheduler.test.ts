import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type {
  Automation,
  AutomationDraft,
  AutomationState,
  Execution,
} from "../contracts/index.js";
import {
  type ActionExecutionContext,
  type ActionExecutionOutcome,
  type ActionHandler,
  ActionRegistry,
  ExecutionRefused,
  PrelaunchPreparationError,
} from "./handlers.js";
import { Scheduler } from "./scheduler.js";
import { emptyState, type StateWriter } from "./store.js";

const schedule = { type: "interval" as const, everyMinutes: 1, anchor: "2026-01-01T00:00:00Z" };

const draft: AutomationDraft = {
  name: "Checks",
  enabled: true,
  trigger: { type: "schedule", schedule },
  action: {
    type: "prompt",
    prompt: "Check",
    agent: "droid",
    repository: "/repo",
    baseBranch: "main",
    allow: ["read"],
    turnTimeout: "1m",
  },
};

const workflowDraftFor = (repository: string, name = "Workflow"): AutomationDraft => ({
  name,
  enabled: true,
  trigger: { type: "schedule", schedule },
  action: {
    type: "workflow",
    provider: "claude",
    repository,
    baseBranch: "main",
    tasks: [{ name: "Task 1", instructions: "Do work", verify: "Verify work", checks: [] }],
    repairs: 2,
    retries: 1,
    autoApprove: true,
  },
});

const identity = {
  repository: { path: "/repo", dev: "1", ino: "2" },
  providerHash: "a".repeat(64),
};

function setup(initial = emptyState(), extraHandlers: ActionHandler<"workflow">[] = []) {
  let now = new Date("2026-01-01T00:00:00Z");
  const store: StateWriter = {
    state: structuredClone(initial),
    save: vi.fn(async (state: AutomationState) => {
      Object.assign(store, { state: structuredClone(state) });
    }),
  };
  let release!: () => void;
  let snapshot: Automation | undefined;
  let launch: Execution | undefined;
  const execute = vi.fn(
    async (
      automation: Automation,
      execution: Execution,
      ctx: ActionExecutionContext,
    ): Promise<ActionExecutionOutcome> => {
      snapshot = automation;
      launch = execution;
      await new Promise<void>((resolve) => {
        release = resolve;
        ctx.signal.addEventListener("abort", () => resolve(), { once: true });
        if (ctx.signal.aborted) resolve();
      });
      return {
        status: ctx.signal.aborted ? "cancelled" : "finished",
        reason: null,
        artifact: (current) =>
          current.type === "prompt" ? { ...current, denials: 1, changedFiles: 2 } : current,
      };
    },
  );
  const inspect = vi.fn(async (_execution: Execution) => "gone" as "gone" | "blocked");
  const promptHandler: ActionHandler<"prompt"> = {
    type: "prompt",
    concurrency: (action) => ({
      lanes: [{ name: "prompt", limit: 1 }],
      resources: [`repo:${action.repository.dev}:${action.repository.ino}`],
    }),
    validate: vi.fn(async (actionDraft) => {
      const { repository: _repo, ...fields } = actionDraft;
      return {
        ...fields,
        repository:
          actionDraft.repository === "/repo"
            ? identity.repository
            : {
                path: actionDraft.repository,
                dev: "1",
                ino: String(actionDraft.repository.length + 10),
              },
        providerHash: identity.providerHash,
      };
    }),
    summarize: (action) => ({
      agent: action.agent,
      repository: { dev: action.repository.dev, ino: action.repository.ino },
    }),
    prepareClaim: (action, skipped) => ({
      type: "prompt",
      repository: { ...action.repository },
      evidence: null,
      runId: skipped ? null : `auto-${randomUUID()}`,
      denials: 0,
      changedFiles: null,
    }),
    execute,
    inspect,
    reconcileOnRestart: async (execution) => {
      const state = await inspect(execution);
      if (state === "blocked") {
        return {
          kind: "blocked",
          runId: execution.artifact.type === "prompt" ? execution.artifact.runId : null,
        };
      }
      return { kind: "interrupted", reason: "service_restarted" };
    },
  };
  const registry = new ActionRegistry([promptHandler, ...extraHandlers]);
  const scheduler = new Scheduler(store, registry, () => now);
  const advance = async (seconds: number) => {
    for (let i = 0; i < seconds; i++) {
      now = new Date(+now + 1000);
      await scheduler.tick();
    }
  };
  return {
    store,
    executor: { execute, inspect, validate: promptHandler.validate },
    scheduler,
    advance,
    setNow: (value: string) => {
      now = new Date(value);
    },
    release: () => release(),
    snapshot: () => snapshot,
    launch: () => launch,
  };
}
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

describe("durable automation scheduler", () => {
  it("reserves an idle scheduler without changing saved state and rejects new claims until release", async () => {
    const s = setup();
    const job = (await s.scheduler.request({ action: "create", draft })) as Automation;
    const before = structuredClone(s.store.state);
    const release = await s.scheduler.reserveIdleForUninstall();
    expect(await s.scheduler.request({ action: "status" })).toMatchObject({
      pausedAll: false,
      activeExecutionId: null,
      activeExecutionIds: [],
    });
    await expect(s.scheduler.request({ action: "runNow", id: job.id })).rejects.toThrow(
      "preparing to uninstall",
    );
    await expect(s.scheduler.request({ action: "pauseAll", cancelActive: true })).rejects.toThrow(
      "preparing to uninstall",
    );
    await s.advance(120);
    expect(s.executor.execute).not.toHaveBeenCalled();
    expect(s.store.state).toEqual(before);
    await release();
    await s.scheduler.request({ action: "runNow", id: job.id });
    await flush();
    expect(s.executor.execute).toHaveBeenCalledOnce();
    await s.scheduler.stop();
  });

  it("waits behind a persisting claim and refuses without cancelling its active execution", async () => {
    const s = setup();
    const job = (await s.scheduler.request({ action: "create", draft })) as Automation;
    const barrier = () => {
      let resolve: () => void = () => {};
      const promise = new Promise<void>((done) => {
        resolve = done;
      });
      return { promise, resolve };
    };
    const entered = barrier();
    const hold = barrier();
    const save = vi.mocked(s.store.save).getMockImplementation();
    if (!save) throw Error("Fixture save implementation missing");
    vi.mocked(s.store.save).mockImplementationOnce(async (state) => {
      entered.resolve();
      await hold.promise;
      await save(state);
    });
    const claim = s.scheduler.request({ action: "runNow", id: job.id });
    await entered.promise;
    const reservation = s.scheduler.reserveIdleForUninstall();
    const rejected = expect(reservation).rejects.toThrow("active or its ownership is uncertain");
    const abort = new AbortController();
    const cancelled = s.scheduler.reserveIdleForUninstall(abort.signal);
    const cancellation = expect(cancelled).rejects.toThrow("cancelled before claim persisted");
    abort.abort(Error("cancelled before claim persisted"));
    hold.resolve();
    await claim;
    await rejected;
    await cancellation;
    await flush();
    expect(s.executor.execute).toHaveBeenCalledOnce();
    expect(vi.mocked(s.executor.execute).mock.calls[0]?.[2].signal.aborted).toBe(false);
    s.release();
    await flush();
    await s.scheduler.stop();
  });

  it("refuses uncertain scheduler ownership and never lets an old release clear a newer reservation", async () => {
    const blocked = setup({
      ...emptyState(),
      block: { reason: "leftover_agent", executionId: null, runId: null },
    });
    await expect(blocked.scheduler.reserveIdleForUninstall()).rejects.toThrow(
      "ownership is uncertain",
    );
    expect(blocked.executor.execute).not.toHaveBeenCalled();
    expect(blocked.store.save).not.toHaveBeenCalled();
    await blocked.scheduler.stop();
    const s = setup();
    const job = (await s.scheduler.request({ action: "create", draft })) as Automation;
    const releaseOld = await s.scheduler.reserveIdleForUninstall();
    await releaseOld();
    const releaseNew = await s.scheduler.reserveIdleForUninstall();
    await releaseOld();
    await expect(s.scheduler.request({ action: "runNow", id: job.id })).rejects.toThrow(
      "preparing to uninstall",
    );
    await releaseNew();
    await s.scheduler.stop();
    await expect(s.scheduler.reserveIdleForUninstall()).rejects.toThrow("ownership is uncertain");
  });

  it("reports live job ownership independently of recurrence and history paging", async () => {
    const s = setup();
    const job = (await s.scheduler.request({
      action: "create",
      draft: { ...draft, enabled: false },
    })) as Automation;
    const list = async () =>
      (await s.scheduler.request({ action: "list" })) as {
        id: string;
        enabled: boolean;
        running: boolean;
      }[];
    expect(await list()).toMatchObject([{ id: job.id, enabled: false, running: false }]);
    await s.scheduler.request({ action: "runNow", id: job.id });
    await flush();
    expect(await list()).toMatchObject([{ id: job.id, enabled: false, running: true }]);
    await s.scheduler.request({ action: "history", before: 1 });
    expect((await list())[0]?.running).toBe(true);
    await expect(
      s.scheduler.request({ action: "delete", id: job.id, revision: job.revision }),
    ).rejects.toThrow("Cancel active work");
    await s.scheduler.request({ action: "cancel", id: job.id });
    await s.scheduler.stop();
    expect((await list())[0]?.running).toBe(false);
    expect(s.store.state.executions[0]?.status).toBe("cancelled");
    expect(s.store.state.automations[0]).not.toHaveProperty("running");
  });

  it("notifies loss of live ownership after a failed final save without changing retained evidence", async () => {
    const s = setup();
    const job = (await s.scheduler.request({ action: "create", draft })) as Automation;
    await s.scheduler.request({ action: "runNow", id: job.id });
    await flush();
    const persisted = structuredClone(s.store.state);
    const changed = vi.fn();
    const unsubscribe = s.scheduler.onChange(changed);
    vi.mocked(s.store.save).mockRejectedValueOnce(new Error("Synthetic final write failure"));
    s.release();
    await s.scheduler.stop();
    expect(changed).toHaveBeenCalledWith(persisted.revision);
    expect(s.store.state).toEqual(persisted);
    expect(s.scheduler.status()).toMatchObject({
      activeExecutionId: null,
      block: { reason: "persistence_failed" },
    });
    const jobs = await s.scheduler.request({ action: "list" });
    expect(jobs).toMatchObject([{ id: job.id, running: false }]);
    expect(persisted.executions[0]?.status).toBe("running");
    unsubscribe();
  });

  it("fences a claim still being saved when shutdown begins", async () => {
    const s = setup();
    const automation = (await s.scheduler.request({ action: "create", draft })) as Automation;
    let saved!: () => void;
    let entered!: () => void;
    const saving = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      saved = resolve;
    });
    vi.mocked(s.store.save).mockImplementationOnce(async (state) => {
      entered();
      await gate;
      Object.assign(s.store, { state: structuredClone(state) });
    });
    const claim = s.scheduler.request({ action: "runNow", id: automation.id });
    await saving;
    const stopped = s.scheduler.stop();
    saved();
    await claim;
    await stopped;
    const revision = s.store.state.revision;
    await flush();
    expect(s.executor.execute).not.toHaveBeenCalled();
    expect(s.store.state.revision).toBe(revision);
    expect(s.store.state.executions[0]).toMatchObject({
      status: "cancelled",
      reason: "service_stopped",
    });
  });

  it("does not replay claimed occurrences after clock rollback, resume or restart", async () => {
    const s = setup();
    await s.scheduler.request({ action: "create", draft });
    await s.advance(60);
    await flush();
    s.release();
    await flush();
    s.setNow("2026-01-01T00:00:59Z");
    await s.scheduler.tick();
    await s.advance(1);
    expect(s.executor.execute).toHaveBeenCalledTimes(1);
    await s.scheduler.request({ action: "pauseAll", cancelActive: false });
    s.setNow("2026-01-01T00:00:59Z");
    await s.scheduler.request({ action: "resumeAll" });
    await s.advance(1);
    expect(s.executor.execute).toHaveBeenCalledTimes(1);
    await s.scheduler.stop();
    const restarted = setup(s.store.state);
    await restarted.scheduler.initialize();
    await restarted.advance(60);
    expect(restarted.executor.execute).not.toHaveBeenCalled();
    expect(restarted.store.state.automations[0]?.nextRunAt).toBe("2026-01-01T00:02:00.000Z");
    await restarted.scheduler.stop();
  });

  it("records a turn interrupted by service shutdown as stopped, not failed", async () => {
    const s = setup();
    vi.mocked(s.executor.execute).mockImplementationOnce(
      (_automation, _execution, ctx) =>
        new Promise((_resolve, reject) =>
          ctx.signal.addEventListener("abort", () => reject(new Error("agent exited on signal"))),
        ),
    );
    const automation = (await s.scheduler.request({ action: "create", draft })) as Automation;
    const claim = (await s.scheduler.request({ action: "runNow", id: automation.id })) as Execution;
    await flush();
    await s.scheduler.stop();
    expect(s.scheduler.execution(claim.id)).toMatchObject({
      status: "cancelled",
      reason: "service_stopped",
    });
  });

  it("persists claims and recurrence before launch, freezes edits, skips occupied occurrences", async () => {
    const s = setup();
    await s.scheduler.initialize();
    const automation = (await s.scheduler.request({ action: "create", draft })) as Automation;
    await s.advance(60);
    await flush();
    expect(s.executor.execute).toHaveBeenCalledTimes(1);
    const savedArtifact = s.store.state.executions[0]?.artifact;
    const launchedArtifact = s.launch()?.artifact;
    expect(savedArtifact?.type === "prompt" && savedArtifact.runId).toBe(
      launchedArtifact?.type === "prompt" && launchedArtifact.runId,
    );
    expect(s.store.state.automations[0]?.nextRunAt).toBe("2026-01-01T00:02:00.000Z");
    await s.scheduler.request({
      action: "update",
      id: automation.id,
      revision: 1,
      draft: {
        ...draft,
        action: { ...draft.action, prompt: "Different" } as AutomationDraft["action"],
      },
    });
    const snap = s.snapshot();
    expect(snap?.action.type === "prompt" && snap.action.prompt).toBe("Check");
    await s.advance(60);
    expect(s.store.state.executions[1]?.reason).toBe("busy");
    await expect(
      s.scheduler.request({ action: "delete", id: automation.id, revision: 2 }),
    ).rejects.toThrow("Cancel");
    await s.scheduler.request({ action: "cancel", id: automation.id });
    await s.scheduler.stop();
    expect(s.store.state.executions[0]?.status).toBe("cancelled");
  });

  it("skips missed occurrences after sleep, and advances at restart without catch-up", async () => {
    const s = setup();
    await s.scheduler.request({ action: "create", draft });
    s.setNow("2026-01-01T00:01:10Z");
    await s.scheduler.tick();
    expect(s.executor.execute).not.toHaveBeenCalled();
    expect(s.store.state.executions[0]?.reason).toBe("missed");
    const restarted = setup(s.store.state);
    restarted.setNow("2026-01-02T00:00:01Z");
    await restarted.scheduler.initialize();
    expect(restarted.store.state.automations[0]?.nextRunAt).toBe("2026-01-02T00:01:00.000Z");
    await restarted.scheduler.stop();
  });

  it("checks revisions and pauses future dispatch without rewriting active work", async () => {
    const s = setup();
    const automation = (await s.scheduler.request({ action: "create", draft })) as Automation;
    await s.scheduler.request({ action: "runNow", id: automation.id });
    await flush();
    await s.scheduler.request({ action: "pauseAll", cancelActive: false });
    await s.advance(120);
    expect(s.executor.execute).toHaveBeenCalledTimes(1);
    await expect(
      s.scheduler.request({
        action: "setEnabled",
        id: automation.id,
        revision: 99,
        enabled: false,
      }),
    ).rejects.toThrow("changed");
    await s.scheduler.request({ action: "pauseAll", cancelActive: true });
    await s.scheduler.stop();
    expect(s.store.state.executions[0]?.status).toBe("cancelled");
    expect(await s.scheduler.request({ action: "history", limit: 1 })).toHaveLength(1);
  });

  it("never starts an agent after claim persistence fails", async () => {
    const s = setup();
    const automation = (await s.scheduler.request({ action: "create", draft })) as Automation;
    vi.mocked(s.store.save).mockRejectedValueOnce(new Error("disk full"));
    await expect(s.scheduler.request({ action: "runNow", id: automation.id })).rejects.toThrow(
      "persistence",
    );
    expect(s.executor.execute).not.toHaveBeenCalled();
    expect(s.scheduler.status().block?.reason).toBe("persistence_failed");
  });

  it("blocks restart on uncertain leftover ownership and never replays a claim", async () => {
    const s = setup();
    const automation = (await s.scheduler.request({ action: "create", draft })) as Automation;
    await s.scheduler.request({ action: "runNow", id: automation.id });
    await flush();
    const saved = structuredClone(s.store.state);
    await s.scheduler.stop();
    const restarted = setup(saved);
    vi.mocked(restarted.executor.inspect).mockResolvedValue("blocked");
    await restarted.scheduler.initialize();
    expect(restarted.scheduler.status().block?.reason).toBe("leftover_agent");
    await restarted.advance(60);
    expect(restarted.executor.execute).not.toHaveBeenCalled();
    await expect(restarted.scheduler.request({ action: "resolveBlock" })).rejects.toThrow(
      "leftover",
    );
    vi.mocked(restarted.executor.inspect).mockResolvedValue("gone");
    await restarted.scheduler.request({ action: "resolveBlock" });
    expect(restarted.store.state.executions[0]?.status).toBe("interrupted");
    await restarted.scheduler.stop();
  });

  it("records failed turns without retries and preserves evidence after deletion", async () => {
    const s = setup();
    vi.mocked(s.executor.execute).mockRejectedValue(new Error("agent error"));
    const automation = (await s.scheduler.request({ action: "create", draft })) as Automation;
    const claim = (await s.scheduler.request({ action: "runNow", id: automation.id })) as Execution;
    await flush();
    await s.scheduler.stop();
    expect(s.scheduler.execution(claim.id).status).toBe("failed");
    await s.scheduler.request({ action: "delete", id: automation.id, revision: 1 });
    expect(s.scheduler.execution(claim.id).artifact.repository).toEqual(identity.repository);
    expect(s.executor.execute).toHaveBeenCalledTimes(1);
  });

  it("enforces per-action concurrency lanes and per-repo resource exclusivity", async () => {
    const resolvers = new Map<string, () => void>();
    const repoMap: Record<string, { path: string; dev: string; ino: string }> = {
      "/repo-a": { path: "/repo-a", dev: "1", ino: "101" },
      "/repo-b": { path: "/repo-b", dev: "1", ino: "102" },
      "/repo-c": { path: "/repo-c", dev: "1", ino: "103" },
    };
    const workflowHandler: ActionHandler<"workflow"> = {
      type: "workflow",
      concurrency: (action) => ({
        lanes: [{ name: "workflow", limit: 2 }],
        resources: [`repo:${action.repository.dev}:${action.repository.ino}`],
      }),
      validate: async (actionDraft) => {
        const { repository, ...fields } = actionDraft;
        const pin = repoMap[repository] ?? { path: repository, dev: "1", ino: "999" };
        return { ...fields, repository: pin, providerHash: identity.providerHash };
      },
      summarize: (action) => ({
        agent: action.provider,
        repository: { dev: action.repository.dev, ino: action.repository.ino },
        taskCount: action.tasks.length,
      }),
      prepareClaim: (action, skipped) => ({
        type: "workflow",
        repository: { ...action.repository },
        evidence: null,
        workflowId: skipped ? null : randomUUID(),
        workflowRunId: null,
        workflowStatus: skipped ? null : "preparing",
        tasksCompleted: 0,
        tasksTotal: action.tasks.length,
      }),
      execute: async (_automation, execution, ctx) => {
        await new Promise<void>((resolve) => {
          resolvers.set(execution.id, resolve);
          ctx.signal.addEventListener("abort", () => resolve(), { once: true });
        });
        if (ctx.abortKind() === "shutdown")
          return { status: "cancelled", reason: "service_stopped", detachedOnShutdown: true };
        return { status: ctx.signal.aborted ? "cancelled" : "finished", reason: null };
      },
      inspect: async () => "gone",
      reconcileOnRestart: async () => ({ kind: "interrupted", reason: "service_restarted" }),
    };

    const s = setup(emptyState(), [workflowHandler]);
    const wfA = (await s.scheduler.request({
      action: "create",
      draft: workflowDraftFor("/repo-a", "WF A"),
    })) as Automation;
    const wfA2 = (await s.scheduler.request({
      action: "create",
      draft: workflowDraftFor("/repo-a", "WF A2"),
    })) as Automation;
    const wfB = (await s.scheduler.request({
      action: "create",
      draft: workflowDraftFor("/repo-b", "WF B"),
    })) as Automation;
    const wfC = (await s.scheduler.request({
      action: "create",
      draft: workflowDraftFor("/repo-c", "WF C"),
    })) as Automation;
    const promptOther = (await s.scheduler.request({
      action: "create",
      draft,
    })) as Automation;

    // Two workflows on different repos run concurrently in the workflow lane (limit 2).
    const execA = (await s.scheduler.request({ action: "runNow", id: wfA.id })) as Execution;
    const execB = (await s.scheduler.request({ action: "runNow", id: wfB.id })) as Execution;
    await flush();
    expect(s.scheduler.status().activeExecutionIds).toHaveLength(2);

    // Same repo collides on resource key.
    const sameRepo = (await s.scheduler.request({ action: "runNow", id: wfA2.id })) as Execution;
    expect(sameRepo.status).toBe("skipped");
    expect(sameRepo.reason).toBe("busy");

    // Third workflow on a new repo hits the workflow lane limit (2).
    const thirdWf = (await s.scheduler.request({ action: "runNow", id: wfC.id })) as Execution;
    expect(thirdWf.status).toBe("skipped");
    expect(thirdWf.reason).toBe("busy");

    // Prompt lane is independent and runs concurrently on its own repo!
    const promptExec = (await s.scheduler.request({
      action: "runNow",
      id: promptOther.id,
    })) as Execution;
    await flush();
    expect(promptExec.status).toBe("claimed");
    expect(s.scheduler.status().activeExecutionIds).toHaveLength(3);

    // Finish all cleanly.
    resolvers.get(execA.id)?.();
    resolvers.get(execB.id)?.();
    s.release();
    await flush();
    await s.scheduler.stop();
    expect(s.scheduler.execution(execA.id).status).toBe("finished");
    expect(s.scheduler.execution(execB.id).status).toBe("finished");
  });

  it("detaches workflow executions on shutdown and re-attaches them on restart", async () => {
    let finishReattached!: () => void;
    const makeHandler = (reattachOnInit: boolean): ActionHandler<"workflow"> => ({
      type: "workflow",
      concurrency: (action) => ({
        lanes: [{ name: "workflow", limit: 2 }],
        resources: [`repo:${action.repository.dev}:${action.repository.ino}`],
      }),
      validate: async (actionDraft) => {
        const { repository: _r, ...fields } = actionDraft;
        return { ...fields, repository: identity.repository, providerHash: identity.providerHash };
      },
      summarize: (action) => ({
        agent: action.provider,
        repository: { dev: action.repository.dev, ino: action.repository.ino },
        taskCount: action.tasks.length,
      }),
      prepareClaim: (action, skipped) => ({
        type: "workflow",
        repository: { ...action.repository },
        evidence: null,
        workflowId: skipped ? null : randomUUID(),
        workflowRunId: null,
        workflowStatus: skipped ? null : "preparing",
        tasksCompleted: 0,
        tasksTotal: action.tasks.length,
      }),
      execute: async (_automation, _execution, ctx) => {
        await new Promise<void>((resolve) => {
          ctx.signal.addEventListener("abort", () => resolve(), { once: true });
        });
        if (ctx.abortKind() === "shutdown")
          return { status: "cancelled", reason: "service_stopped", detachedOnShutdown: true };
        return { status: "cancelled", reason: "cancelled_by_user" };
      },
      inspect: async () => "gone",
      reconcileOnRestart: async (execution) => {
        if (!reattachOnInit) return { kind: "interrupted", reason: "service_restarted" };
        const repo = execution.artifact.repository;
        return {
          kind: "reattach",
          concurrency: {
            lanes: [{ name: "workflow", limit: 2 }],
            resources: [`repo:${repo.dev}:${repo.ino}`],
          },
          resume: async () => {
            await new Promise<void>((resolve) => {
              finishReattached = resolve;
            });
            return {
              status: "finished",
              reason: null,
              artifact: (current) =>
                current.type === "workflow"
                  ? { ...current, workflowStatus: "completed", tasksCompleted: 1 }
                  : current,
            };
          },
        };
      },
    });

    const first = setup(emptyState(), [makeHandler(false)]);
    const wf = (await first.scheduler.request({
      action: "create",
      draft: workflowDraftFor("/repo", "Restartable WF"),
    })) as Automation;
    const exec = (await first.scheduler.request({ action: "runNow", id: wf.id })) as Execution;
    await flush();
    await first.scheduler.stop();
    // Detached on shutdown: stays running in state.json so restart reconciles against DesktopWorkflows.
    expect(first.store.state.executions[0]?.status).toBe("running");

    // Restart with reattach: re-acquires lane/resource slot and settles when workflow completes.
    const second = setup(first.store.state, [makeHandler(true)]);
    await second.scheduler.initialize();
    expect(second.scheduler.status().activeExecutionIds).toEqual([exec.id]);
    // Same repo is still busy while re-attached.
    const overlapping = (await second.scheduler.request({
      action: "runNow",
      id: wf.id,
    })) as Execution;
    expect(overlapping.reason).toBe("busy");

    finishReattached();
    await flush();
    expect(second.scheduler.execution(exec.id).status).toBe("finished");
    expect(second.scheduler.status().activeExecutionIds).toEqual([]);
    await second.scheduler.stop();
  });

  it("fails closed with handler_unavailable when a persisted job has no registered handler", async () => {
    const withWf = setup(emptyState(), [
      {
        type: "workflow",
        concurrency: (action) => ({
          lanes: [{ name: "workflow", limit: 2 }],
          resources: [`repo:${action.repository.dev}:${action.repository.ino}`],
        }),
        validate: async (actionDraft) => {
          const { repository: _r, ...fields } = actionDraft;
          return {
            ...fields,
            repository: identity.repository,
            providerHash: identity.providerHash,
          };
        },
        summarize: (action) => ({ agent: action.provider }),
        prepareClaim: (action) => ({
          type: "workflow",
          repository: { ...action.repository },
          evidence: null,
          workflowId: null,
          workflowRunId: null,
          workflowStatus: null,
          tasksCompleted: 0,
          tasksTotal: action.tasks.length,
        }),
        execute: async () => ({ status: "finished", reason: null }),
        inspect: async () => "gone",
        reconcileOnRestart: async () => ({ kind: "interrupted" }),
      },
    ]);
    const wf = (await withWf.scheduler.request({
      action: "create",
      draft: workflowDraftFor("/repo", "Saved WF"),
    })) as Automation;
    await withWf.scheduler.stop();

    // Open same state without workflow handler registered.
    const standalone = setup(withWf.store.state);
    const skipped = (await standalone.scheduler.request({
      action: "runNow",
      id: wf.id,
    })) as Execution;
    expect(skipped.status).toBe("skipped");
    expect(skipped.reason).toBe("handler_unavailable");
    await standalone.scheduler.stop();
  });

  it("does not brick state.block on prelaunch refusals, pre-spawn cancels, or pre-spawn preparation errors", async () => {
    const s = setup();
    const automation = (await s.scheduler.request({ action: "create", draft })) as Automation;
    vi.mocked(s.executor.inspect).mockResolvedValue("blocked");

    vi.mocked(s.executor.execute).mockRejectedValueOnce(new ExecutionRefused("repository_missing"));
    await s.scheduler.request({ action: "runNow", id: automation.id });
    await flush();
    expect(s.store.state.executions.at(-1)).toMatchObject({
      status: "failed",
      reason: "repository_missing",
    });
    expect(s.scheduler.status().block).toBeNull();

    vi.mocked(s.executor.execute).mockRejectedValueOnce(
      new PrelaunchPreparationError("repoInfo failed before launch"),
    );
    await s.scheduler.request({ action: "runNow", id: automation.id });
    await flush();
    expect(s.store.state.executions.at(-1)).toMatchObject({
      status: "failed",
      reason: "preparation_failed",
    });
    expect(s.scheduler.status().block).toBeNull();

    vi.mocked(s.executor.execute).mockResolvedValueOnce({
      status: "cancelled",
      reason: "cancelled_by_user",
      neverStarted: true,
    });
    await s.scheduler.request({ action: "runNow", id: automation.id });
    await flush();
    expect(s.store.state.executions.at(-1)).toMatchObject({
      status: "cancelled",
      reason: "cancelled_by_user",
    });
    expect(s.scheduler.status().block).toBeNull();
    await s.scheduler.stop();
  });
});
