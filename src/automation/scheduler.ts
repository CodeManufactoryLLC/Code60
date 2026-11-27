import { randomUUID } from "node:crypto";
import {
  AUTOMATION_LIMIT,
  type Automation,
  type AutomationDraft,
  type AutomationRequest,
  type AutomationState,
  automationDraftSchema,
  type Execution,
  type ExecutionArtifact,
  type ExecutionReason,
  type ServiceStatus,
} from "../contracts/index.js";
import { CODE60_VERSION, dueDecision, nextOccurrence } from "../core/index.js";
import { AutomationError } from "./errors.js";
import {
  type AbortKind,
  type ActionExecutionContext,
  type ActionExecutionOutcome,
  type ActionHandler,
  type ActionRegistry,
  type ConcurrencySpec,
  ExecutionRefused,
} from "./handlers.js";
import type { StateWriter } from "./store.js";

type Active = {
  executionId: string;
  automationId: string;
  concurrency: ConcurrencySpec;
  abort: AbortController;
  abortReason: AbortKind;
  done: Promise<void>;
};

export type DispatchTrigger =
  | { type: "schedule"; scheduledFor: string; missed: boolean }
  | { type: "manual" };

const unfinished = (execution: Execution) =>
  execution.status === "claimed" || execution.status === "running";

function fallbackArtifact(automation: Automation): ExecutionArtifact {
  if (automation.action.type === "workflow") {
    return {
      type: "workflow",
      repository: { ...automation.action.repository },
      evidence: null,
      workflowId: null,
      workflowRunId: null,
      workflowStatus: null,
      tasksCompleted: 0,
      tasksTotal: automation.action.tasks.length,
    };
  }
  return {
    type: "prompt",
    repository: { ...automation.action.repository },
    evidence: null,
    runId: null,
    denials: 0,
    changedFiles: null,
  };
}

function summarizeHistoryEntry(execution: Execution) {
  const { artifact, ...rest } = execution;
  if (artifact.type === "prompt") {
    return {
      ...rest,
      denials: artifact.denials,
      runId: artifact.runId,
      changedFiles: artifact.changedFiles,
    };
  }
  return {
    ...rest,
    denials: 0,
    runId: artifact.workflowRunId,
    workflowId: artifact.workflowId,
    workflowStatus: artifact.workflowStatus,
    tasksCompleted: artifact.tasksCompleted,
    tasksTotal: artifact.tasksTotal,
  };
}

/** Single writer with a short control queue and lane/resource concurrency. Actions never hold the queue. */
export class Scheduler {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly active = new Map<string, Active>();
  private stopped = false;
  private removalReservation: symbol | null = null;
  private failed = false;
  private lastTick: number;
  private readonly listeners = new Set<(revision: number) => void>();
  private readonly startedAt: string;

  constructor(
    private readonly store: StateWriter,
    private readonly registry: ActionRegistry,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.startedAt = now().toISOString();
    this.lastTick = now().getTime();
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const task = this.tail.then(work);
    this.tail = task.catch(() => {});
    return task;
  }

  private async save(next: AutomationState) {
    if (this.failed)
      throw new AutomationError(
        "unavailable",
        "Schedule persistence failed. Restart after repairing storage.",
      );
    next.revision = this.store.state.revision + 1;
    try {
      await this.store.save(next);
    } catch {
      this.failed = true;
      this.abortAll("shutdown");
      throw new AutomationError(
        "unavailable",
        "Schedule persistence failed. No further launches are allowed.",
      );
    }
    this.notify();
  }

  private notify() {
    for (const listener of this.listeners) {
      try {
        listener(this.store.state.revision);
      } catch {
        /* Client failures cannot affect dispatch. */
      }
    }
  }

  onChange(listener: (revision: number) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private abortEntry(entry: Active, reason: Exclude<AbortKind, null>) {
    entry.abortReason ??= reason;
    entry.abort.abort();
  }

  private abortAll(reason: Exclude<AbortKind, null>) {
    for (const entry of this.active.values()) this.abortEntry(entry, reason);
  }

  private hasActiveForAutomation(automationId: string): boolean {
    for (const entry of this.active.values()) if (entry.automationId === automationId) return true;
    return false;
  }

  private isConcurrencyBusy(spec: ConcurrencySpec): boolean {
    for (const lane of spec.lanes) {
      let count = 0;
      for (const entry of this.active.values()) {
        if (entry.concurrency.lanes.some((held) => held.name === lane.name)) count++;
      }
      if (count >= lane.limit) return true;
    }
    for (const resource of spec.resources) {
      for (const entry of this.active.values()) {
        if (entry.concurrency.resources.includes(resource)) return true;
      }
    }
    return false;
  }

  status(): ServiceStatus {
    const activeExecutionIds = [...this.active.keys()];
    return {
      version: 1,
      appVersion: CODE60_VERSION,
      pid: process.pid,
      startedAt: this.startedAt,
      revision: this.store.state.revision,
      pausedAll: this.store.state.pausedAll,
      block: this.failed
        ? { reason: "persistence_failed", executionId: null, runId: null }
        : this.store.state.block,
      activeExecutionId: activeExecutionIds[0] ?? null,
      activeExecutionIds,
    };
  }

  /** Fence new claims without changing saved pause state or cancelling approved work. */
  async reserveIdleForUninstall(signal?: AbortSignal): Promise<() => Promise<void>> {
    signal?.throwIfAborted();
    return this.serial(async () => {
      signal?.throwIfAborted();
      if (
        this.removalReservation ||
        this.stopped ||
        this.failed ||
        this.active.size > 0 ||
        this.store.state.block ||
        this.store.state.executions.some(unfinished)
      )
        throw new AutomationError(
          "refused",
          "Scheduled work is active or its ownership is uncertain; resolve it before uninstalling.",
        );
      const token = Symbol("uninstall reservation");
      this.removalReservation = token;
      let released = false;
      return () =>
        this.serial(async () => {
          if (released) return;
          if (this.removalReservation !== token)
            throw new AutomationError("refused", "Uninstall reservation ownership changed.");
          this.removalReservation = null;
          released = true;
        });
    });
  }

  /** Restart advances future schedules and reconciles unfinished executions per handler. */
  async initialize(): Promise<void> {
    await this.serial(async () => {
      const state = structuredClone(this.store.state);
      const reattachments: Array<{
        execution: Execution;
        handler: ActionHandler;
        concurrency: ConcurrencySpec;
        resume: (ctx: ActionExecutionContext) => Promise<ActionExecutionOutcome>;
      }> = [];
      for (const execution of state.executions.filter(unfinished)) {
        const handler = this.registry.get(execution.actionType);
        if (!handler) {
          execution.status = "interrupted";
          execution.reason = "service_restarted";
          execution.endedAt = this.now().toISOString();
          continue;
        }
        const decision = await handler.reconcileOnRestart(execution);
        if (decision.kind === "blocked") {
          state.block = {
            reason: "leftover_agent",
            executionId: execution.id,
            runId: decision.runId ?? null,
          };
          break;
        }
        if (decision.kind === "interrupted") {
          execution.status = "interrupted";
          execution.reason = decision.reason ?? "service_restarted";
          execution.endedAt = this.now().toISOString();
          continue;
        }
        if (decision.kind === "settled") {
          execution.status = decision.outcome.status;
          execution.reason = decision.outcome.reason;
          if (decision.outcome.artifact)
            execution.artifact = decision.outcome.artifact(execution.artifact);
          execution.endedAt = this.now().toISOString();
          continue;
        }
        reattachments.push({
          execution: structuredClone(execution),
          handler,
          concurrency: decision.concurrency,
          resume: decision.resume,
        });
      }
      for (const automation of state.automations)
        automation.nextRunAt =
          automation.enabled && automation.trigger.type === "schedule"
            ? dueDecision(
                automation.trigger.schedule,
                null,
                this.now(),
                this.claimedThrough(automation),
              ).nextRunAt.toISOString()
            : null;
      await this.save(state);
      for (const item of reattachments) {
        if (this.stopped) break;
        const abort = new AbortController();
        const active: Active = {
          executionId: item.execution.id,
          automationId: item.execution.automationId,
          concurrency: item.concurrency,
          abort,
          abortReason: null,
          done: Promise.resolve(),
        };
        this.active.set(item.execution.id, active);
        active.done = Promise.resolve().then(() =>
          this.settleRun(item.handler, item.execution, active, (ctx) => item.resume(ctx)),
        );
      }
    });
  }

  private find(state: AutomationState, id: string, revision?: number): Automation {
    const automation = state.automations.find((value) => value.id === id);
    if (!automation) throw new AutomationError("not_found", "Automation not found.");
    if (revision !== undefined && automation.revision !== revision)
      throw new AutomationError("conflict", "The automation changed. Reload before saving.");
    return automation;
  }

  private claimedThrough(automation: Automation): Date | null {
    let latest: string | null = null;
    for (const execution of this.store.state.executions) {
      if (
        execution.automationId === automation.id &&
        execution.revision === automation.revision &&
        execution.scheduledFor &&
        (!latest || Date.parse(execution.scheduledFor) > Date.parse(latest))
      )
        latest = execution.scheduledFor;
    }
    return latest ? new Date(latest) : null;
  }

  private async draft(draft: AutomationDraft, previous?: Automation): Promise<Automation> {
    const valid = automationDraftSchema.parse(draft);
    const handler = this.registry.get(valid.action.type);
    if (!handler)
      throw new AutomationError(
        "refused",
        `Action handler "${valid.action.type}" is unavailable in this runtime.`,
      );
    const persistedAction = await handler.validate(valid.action as never);
    const at = this.now().toISOString();
    return {
      id: previous?.id ?? randomUUID(),
      revision: (previous?.revision ?? 0) + 1,
      createdAt: previous?.createdAt ?? at,
      updatedAt: at,
      name: valid.name,
      trigger: valid.trigger,
      action: persistedAction,
      enabled: valid.enabled,
      nextRunAt:
        valid.enabled && valid.trigger.type === "schedule"
          ? nextOccurrence(valid.trigger.schedule, this.now()).toISOString()
          : null,
    };
  }

  private addExecution(
    state: AutomationState,
    automation: Automation,
    handler: ActionHandler | undefined,
    trigger: DispatchTrigger,
    reason: ExecutionReason | null,
  ): Execution {
    // Explicit bound, never silently delete run evidence to make room.
    if (state.executions.length >= 5000)
      throw new AutomationError(
        "refused",
        "Execution metadata limit reached. Schedules are preserved; dispatch is paused.",
      );
    const artifact = handler
      ? handler.prepareClaim(automation.action as never, reason !== null)
      : fallbackArtifact(automation);
    const execution: Execution = {
      id: randomUUID(),
      sequence: ++state.sequence,
      automationId: automation.id,
      automationName: automation.name,
      actionType: automation.action.type,
      revision: automation.revision,
      trigger: trigger.type,
      scheduledFor: trigger.type === "schedule" ? trigger.scheduledFor : null,
      claimedAt: this.now().toISOString(),
      startedAt: null,
      endedAt: reason ? this.now().toISOString() : null,
      status: reason ? "skipped" : "claimed",
      reason,
      artifact,
    };
    state.executions.push(execution);
    return execution;
  }

  /** Generalized dispatch seam shared by time ticks, manual runs, and future event triggers. */
  private async dispatch(automation: Automation, trigger: DispatchTrigger) {
    const state = structuredClone(this.store.state);
    const current = this.find(state, automation.id);
    if (trigger.type === "schedule" && current.trigger.type === "schedule") {
      const claimedThrough = this.claimedThrough(current);
      const next = new Date(
        Math.max(
          this.now().getTime(),
          Date.parse(trigger.scheduledFor),
          claimedThrough?.getTime() ?? 0,
        ),
      );
      current.nextRunAt = nextOccurrence(current.trigger.schedule, next).toISOString();
      if (claimedThrough && Date.parse(trigger.scheduledFor) <= claimedThrough.getTime()) {
        await this.save(state);
        return null;
      }
    }
    const handler = this.registry.get(current.action.type);
    const concurrency = handler ? handler.concurrency(current.action as never) : null;
    let reason: ExecutionReason | null =
      trigger.type === "schedule" && trigger.missed
        ? "missed"
        : state.block || this.failed
          ? "blocked"
          : state.pausedAll || this.stopped
            ? "paused"
            : !handler || !concurrency
              ? "handler_unavailable"
              : this.isConcurrencyBusy(concurrency)
                ? "busy"
                : null;
    if (!reason && handler?.canDispatch) {
      const available = await Promise.resolve(handler.canDispatch(current.action as never)).catch(
        () => false,
      );
      if (!available) reason = "busy";
    }
    const execution = this.addExecution(state, current, handler, trigger, reason);
    await this.save(state); // Unique claim + advanced schedule are durable before launch.
    if (!reason && this.stopped) {
      execution.status = "cancelled";
      execution.reason = "service_stopped";
      execution.endedAt = this.now().toISOString();
      await this.save(state);
      return execution;
    }
    if (!reason && handler && concurrency) {
      const abort = new AbortController();
      const snapshot = structuredClone(current);
      const active: Active = {
        executionId: execution.id,
        automationId: current.id,
        concurrency,
        abort,
        abortReason: null,
        done: Promise.resolve(),
      };
      this.active.set(execution.id, active);
      // Leave the control queue before preparation, cancellation or action execution.
      active.done = Promise.resolve().then(() => this.launch(handler, snapshot, execution, active));
    }
    return execution;
  }

  private async launch(
    handler: ActionHandler,
    automation: Automation,
    execution: Execution,
    active: Active,
  ): Promise<void> {
    try {
      await this.serial(async () => {
        const state = structuredClone(this.store.state);
        const entry = state.executions.find((value) => value.id === execution.id);
        if (!entry) throw new Error("Missing claim");
        entry.status = "running";
        entry.startedAt = this.now().toISOString();
        await this.save(state);
      });
    } catch {
      this.failed = true;
      this.active.delete(execution.id);
      this.notify();
      return;
    }
    await this.settleRun(handler, execution, active, (ctx) =>
      handler.execute(automation, execution, ctx),
    );
  }

  private async settleRun(
    handler: ActionHandler,
    execution: Execution,
    active: Active,
    run: (ctx: ActionExecutionContext) => Promise<ActionExecutionOutcome>,
  ): Promise<void> {
    const ctx: ActionExecutionContext = {
      signal: active.abort.signal,
      abortKind: () => active.abortReason,
      updateArtifact: (updater) =>
        this.serial(async () => {
          const state = structuredClone(this.store.state);
          const entry = state.executions.find((value) => value.id === execution.id);
          if (!entry || active.abort.signal.aborted) throw new Error("Execution cancelled");
          entry.artifact = updater(entry.artifact);
          await this.save(state);
        }),
      notify: () => this.notify(),
    };
    try {
      let outcome: ActionExecutionOutcome;
      try {
        outcome = await run(ctx);
      } catch (error) {
        outcome = {
          status: active.abort.signal.aborted ? ("cancelled" as const) : ("failed" as const),
          reason:
            error instanceof ExecutionRefused ? error.reason : ("preparation_failed" as const),
        };
      }
      if (outcome.detachedOnShutdown && active.abortReason === "shutdown") {
        // Long-lived action (e.g., Workflow) preserves running state across backend restart.
        return;
      }
      // A stopped execution is a cancellation, even when the interrupted runtime reports failure.
      if (
        active.abort.signal.aborted &&
        outcome.status !== "finished" &&
        outcome.reason !== "persistence_failed"
      ) {
        outcome = {
          ...outcome,
          status: "cancelled",
          reason:
            active.abortReason === "shutdown" || this.stopped
              ? "service_stopped"
              : "cancelled_by_user",
        };
      }
      await this.serial(async () => {
        const state = structuredClone(this.store.state);
        const entry = state.executions.find((value) => value.id === execution.id);
        if (!entry) throw new Error("Missing execution");
        entry.status = outcome.status;
        entry.reason = outcome.reason;
        if (outcome.artifact) entry.artifact = outcome.artifact(entry.artifact);
        entry.endedAt = this.now().toISOString();
        if (outcome.reason === "low_disk" || outcome.reason === "persistence_failed")
          state.pausedAll = true;
        // Unknown leftover ownership blocks every later launch, regardless of outcome.
        if ((await handler.inspect(entry)) !== "gone") {
          state.block = {
            reason: "leftover_agent",
            executionId: entry.id,
            runId:
              entry.artifact.type === "prompt"
                ? entry.artifact.runId
                : entry.artifact.workflowRunId,
          };
        }
        await this.save(state);
      });
    } catch {
      this.failed = true; // An uncertain save cannot authorize more execution.
    } finally {
      this.active.delete(execution.id);
      // Live ownership changes even when saving the final outcome failed.
      this.notify();
    }
  }

  async tick(): Promise<void> {
    await this.serial(async () => {
      if (this.removalReservation) return;
      const gap = this.now().getTime() - this.lastTick;
      this.lastTick = this.now().getTime();
      if (this.stopped || this.failed || this.store.state.pausedAll || this.store.state.block)
        return;
      for (const saved of [...this.store.state.automations]) {
        if (!saved.enabled || saved.trigger.type !== "schedule") continue;
        const decision = dueDecision(
          saved.trigger.schedule,
          saved.nextRunAt ? new Date(saved.nextRunAt) : null,
          this.now(),
          this.claimedThrough(saved),
        );
        if (decision.type !== "wait") {
          await this.dispatch(saved, {
            type: "schedule",
            scheduledFor: decision.scheduledFor.toISOString(),
            missed: decision.type === "missed" || gap > 5000,
          });
        } else if (saved.nextRunAt !== decision.nextRunAt.toISOString()) {
          const state = structuredClone(this.store.state);
          this.find(state, saved.id).nextRunAt = decision.nextRunAt.toISOString();
          await this.save(state);
        }
      }
    });
  }

  async request(request: AutomationRequest): Promise<unknown> {
    return this.serial(async () => {
      if (
        this.removalReservation &&
        !["status", "list", "get", "history", "subscribe"].includes(request.action)
      )
        throw new AutomationError(
          "refused",
          "The backend is preparing to uninstall; scheduled changes are unavailable.",
        );
      const state = structuredClone(this.store.state);
      switch (request.action) {
        case "status":
          return this.status();
        case "list":
          return state.automations.map((automation) => {
            const handler = this.registry.get(automation.action.type);
            const summary = handler
              ? handler.summarize(automation.action as never)
              : {
                  agent:
                    automation.action.type === "prompt"
                      ? automation.action.agent
                      : automation.action.provider,
                  repository: {
                    dev: automation.action.repository.dev,
                    ino: automation.action.repository.ino,
                  },
                  ...(automation.action.type === "workflow"
                    ? { taskCount: automation.action.tasks.length }
                    : {}),
                };
            const running =
              this.hasActiveForAutomation(automation.id) &&
              state.executions.some(
                (entry) =>
                  entry.automationId === automation.id &&
                  this.active.has(entry.id) &&
                  unfinished(entry),
              );
            return {
              id: automation.id,
              revision: automation.revision,
              createdAt: automation.createdAt,
              updatedAt: automation.updatedAt,
              name: automation.name,
              actionType: automation.action.type,
              enabled: automation.enabled,
              nextRunAt: automation.nextRunAt,
              running,
              ...summary,
            };
          });
        case "get":
          return this.find(state, request.id);
        case "history":
          return state.executions
            .filter(
              (value) =>
                (!request.id || value.automationId === request.id) &&
                (!request.before || value.sequence < request.before),
            )
            .slice(-(request.limit ?? 50))
            .reverse()
            .map(summarizeHistoryEntry);
        case "create": {
          if (state.automations.length >= AUTOMATION_LIMIT)
            throw new AutomationError("refused", "Automation limit reached.");
          const automation = await this.draft(request.draft);
          state.automations.push(automation);
          await this.save(state);
          return automation;
        }
        case "update": {
          const previous = this.find(state, request.id, request.revision);
          const automation = await this.draft(request.draft, previous);
          state.automations[state.automations.indexOf(previous)] = automation;
          await this.save(state);
          return automation;
        }
        case "setEnabled": {
          const automation = this.find(state, request.id, request.revision);
          automation.enabled = request.enabled;
          automation.revision++;
          automation.updatedAt = this.now().toISOString();
          automation.nextRunAt =
            request.enabled && automation.trigger.type === "schedule"
              ? nextOccurrence(automation.trigger.schedule, this.now()).toISOString()
              : null;
          await this.save(state);
          return automation;
        }
        case "delete":
          this.find(state, request.id, request.revision);
          if (this.hasActiveForAutomation(request.id))
            throw new AutomationError("refused", "Cancel active work before deleting.");
          state.automations = state.automations.filter((value) => value.id !== request.id);
          await this.save(state);
          return null;
        case "runNow":
          return this.dispatch(this.find(state, request.id), { type: "manual" });
        case "cancel":
          for (const entry of this.active.values()) {
            if (entry.automationId === request.id) this.abortEntry(entry, "user");
          }
          return null;
        case "pauseAll":
          state.pausedAll = true;
          if (request.cancelActive) this.abortAll("user");
          await this.save(state);
          return null;
        case "resumeAll":
          state.pausedAll = false;
          for (const automation of state.automations)
            automation.nextRunAt =
              automation.enabled && automation.trigger.type === "schedule"
                ? nextOccurrence(automation.trigger.schedule, this.now()).toISOString()
                : null;
          await this.save(state);
          return null;
        case "resolveBlock":
          for (const execution of state.executions.filter(
            (value) => unfinished(value) || value.id === state.block?.executionId,
          )) {
            const handler = this.registry.get(execution.actionType);
            if (!handler || (await handler.inspect(execution)) !== "gone")
              throw new AutomationError(
                "refused",
                "A leftover agent is alive or cannot be verified. Stop it manually, then retry.",
              );
            if (unfinished(execution)) {
              execution.status = "interrupted";
              execution.reason = "service_restarted";
              execution.endedAt = this.now().toISOString();
            }
          }
          state.block = null;
          await this.save(state);
          return null;
        case "subscribe":
          return { revision: state.revision };
        default:
          throw new AutomationError("invalid", "This action needs an execution evidence reader.");
      }
    });
  }

  execution(id: string): Execution {
    const value = this.store.state.executions.find((entry) => entry.id === id);
    if (!value) throw new AutomationError("not_found", "Execution not found.");
    return structuredClone(value);
  }

  executionCount(): number {
    return this.store.state.executions.length;
  }

  enabledAutomations(): Automation[] {
    return structuredClone(this.store.state.automations.filter((entry) => entry.enabled));
  }

  pinnedWorktrees(): string[] {
    const paths: string[] = [];
    for (const execution of this.store.state.executions) {
      if (
        (execution.status === "claimed" || execution.status === "running") &&
        execution.artifact.evidence?.worktree.path
      ) {
        paths.push(execution.artifact.evidence.worktree.path);
      }
    }
    return paths;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.abortAll("shutdown");
    await this.tail; // Fence claims that were still persisting when shutdown began.
    this.abortAll("shutdown");
    await Promise.all([...this.active.values()].map((entry) => entry.done));
    await this.tail;
  }
}
