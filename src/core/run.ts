import { createHash, randomUUID } from "node:crypto";
import {
  type AgentMcpServer,
  type AgentSession,
  AgentStartError,
  type Agents,
  type AgentUpdate,
  type PermissionAnswer,
  type PermissionRequest,
} from "../agents/index.js";
import {
  emitLog,
  emptySessionState,
  type LogInput,
  type LogSink,
  logInputSchema,
  type ModeChange,
  modeChangeSchema,
  type PromptTemplates,
  parseValue,
  renderPrompt,
  supportsModeChange,
} from "../contracts/index.js";
import type { Git } from "../git/index.js";
import { diagnosticMessage, diagnosticText } from "../platform/index.js";
import type { MemoryFactory, MemoryPreparation, RunMemory } from "./agent-memory.js";
import type { Clock } from "./clock.js";
import { type Processes, recordedAgentAlive } from "./processes.js";
import type { RecordStore } from "./records.js";
import { HANDOFF_PROMPT_LIMIT } from "./recovery.js";
import type {
  FinalRunStatus,
  Mode,
  PendingPermission,
  PermissionRule,
  RecoveryResult,
  RunEvent,
  RunEventBody,
  RunRecord,
  RunStatus,
  RunView,
  StopReason,
  ToolKind,
} from "./types.js";
import { ACTIVE_STATUSES, RefusedError } from "./types.js";

export interface RunDeps {
  memory?: MemoryFactory;
  log?: LogSink;
  agents: Agents;
  git: Git;
  store: RecordStore;
  clock: Clock;
  processes: Processes;
  ownerPid?: number;
  ownerIdentity?: NonNullable<RunRecord["ownerIdentity"]>;
  onEvent(event: RunEvent): void;
  /** Called when view-only state changes without an event, such as a run starting to stop. */
  onChange(): void;
  warn(message: string): void;
}

export interface RunSettings {
  mode: Mode;
  repoDir: string;
  command: readonly [string, ...string[]];
  env?: Readonly<Record<string, string>>;
  mcpServers?: readonly AgentMcpServer[];
  /** Additional context sent with each user turn, but not recorded as user-authored text. */
  promptContext?: () => string;
  turnTimeoutMs: number;
  /** How long a cancelled turn may take to end before the agent is killed. */
  cancelGraceMs: number;
  /** Time between SIGTERM and SIGKILL when stopping the agent. */
  killGraceMs: number;
  decide(kind: ToolKind): PermissionRule;
  prompts: Readonly<PromptTemplates>;
}

type CancelCause = "user" | "timeout" | "shutdown";

interface Outcome {
  status: FinalRunStatus;
  reason?: string;
}

interface Pending {
  view: PendingPermission;
  resolve(answer: PermissionAnswer): void;
}

function formatDuration(ms: number): string {
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  if (ms % 1_000 === 0) return `${ms / 1_000}s`;
  return `${ms}ms`;
}

function outcomeOf(reason: StopReason): Outcome {
  switch (reason) {
    case "end_turn":
      return { status: "finished" };
    case "cancelled":
      return { status: "cancelled", reason: "the turn was cancelled" };
    default:
      return { status: "failed", reason: `the turn stopped: ${reason}` };
  }
}

function message(error: unknown): string {
  return diagnosticMessage(error);
}

/** One agent session, in its own worktree or directly in a directory, driven through the run lifecycle. */
export class Run {
  private readonly memory: RunMemory | undefined;
  private readonly lifecycleOperation = randomUUID();
  private turnOperation = this.lifecycleOperation;
  private turnStarted = 0;
  private persistenceReported = false;
  readonly finished: Promise<void>;
  private resolveFinished!: () => void;
  private session: AgentSession | undefined;
  private sessionExited = false;
  private modeChanging = false;
  private worktreeCreated = false;
  private turnActive = false;
  private turnTimer: unknown;
  private graceTimer: unknown;
  private cancelCause: CancelCause | undefined;
  private lastOutcome: Outcome | undefined;
  private readonly pending = new Map<string, Pending>();
  private permissionCount = 0;
  private shutdownRequested = false;
  private forced = false;
  private ending = false;
  private readonly startAbort = new AbortController();
  private preparationAbort: AbortController | undefined;
  private dispatchSettle: ((sent: boolean) => void) | undefined;

  constructor(
    readonly record: RunRecord,
    private readonly deps: RunDeps,
    private readonly settings: RunSettings,
  ) {
    this.memory =
      settings.mode === "interactive" ? deps.memory?.(record, settings.repoDir) : undefined;
    this.finished = new Promise((resolve) => {
      this.resolveFinished = resolve;
    });
  }

  get id(): string {
    return this.record.id;
  }

  private log(event: LogInput["event"], outcome: LogInput["outcome"], durationMs?: number): void {
    if (!this.deps.log) return;
    const provider = logInputSchema.shape.provider.safeParse(this.record.agent);
    emitLog(this.deps.log, {
      event,
      outcome,
      operationId: this.turnOperation,
      runId: this.id,
      ...(provider.success && provider.data ? { provider: provider.data } : {}),
      ...(this.record.branch
        ? {
            projectId: createHash("sha256")
              .update(this.settings.repoDir)
              .digest("hex")
              .slice(0, 16),
          }
        : {}),
      ...(durationMs === undefined ? {} : { durationMs: Math.max(0, durationMs) }),
      ...(outcome === "failed" ? { errorCategory: "unknown" as const } : {}),
    });
  }

  private diagnostic() {
    return this.deps.log
      ? {
          diagnostic: {
            operationId: this.turnOperation,
            runId: this.id,
            ...(this.record.branch
              ? {
                  projectId: createHash("sha256")
                    .update(this.settings.repoDir)
                    .digest("hex")
                    .slice(0, 16),
                }
              : {}),
          },
        }
      : {};
  }

  get status(): RunStatus {
    return this.record.status;
  }

  get hasWorktree(): boolean {
    return this.worktreeCreated;
  }

  view(): RunView {
    const r = this.record;
    return {
      id: r.id,
      agent: r.agent,
      status: r.status,
      ...(r.reason === undefined ? {} : { reason: r.reason }),
      turns: r.turns,
      branch: r.branch,
      worktree: r.worktree,
      ...(r.lastStopReason === undefined ? {} : { lastStopReason: r.lastStopReason }),
      ...(r.sessionState === undefined ? {} : { sessionState: r.sessionState }),
      modeChanging: this.modeChanging,
      pending: [...this.pending.values()].map((p) => p.view),
      stopping: this.ending && !this.isFinal(),
    };
  }

  /** Announces the queued run. */
  queue(): Promise<void> {
    this.log("dispatch.accepted", "succeeded");
    return this.setStatus("queued");
  }

  /** Never rejects: every failure becomes the run's final status. */
  async start(): Promise<void> {
    try {
      await this.startAndRun();
    } catch (error) {
      await this.end({ status: "failed", reason: message(error) });
    }
  }

  /** Restores a saved ACP session without replaying a previous prompt. */
  async restore(): Promise<RecoveryResult> {
    await this.assertRecoverableAndSafe();
    this.turnOperation = randomUUID();
    this.log("recovery.start", "started");
    const previousStatus = this.status;
    const previousReason = this.record.reason;
    const sessionId = this.record.acpSessionId;
    if (!sessionId) {
      this.log("recovery.end", "failed");
      return {
        type: "handoff-required",
        reason: "This run has no saved ACP session ID to restore.",
      };
    }
    if (!this.deps.agents.restore) {
      this.log("recovery.end", "failed");
      return {
        type: "handoff-required",
        reason: "The configured agent launcher does not support ACP session restore.",
      };
    }
    let session: AgentSession;
    try {
      session = await this.startRecoveryAgent((signal) =>
        (this.deps.agents.restore as NonNullable<Agents["restore"]>)(
          {
            name: this.record.agent,
            ...this.diagnostic(),
            command: this.settings.command,
            cwd: this.record.worktree,
            ...(this.settings.env === undefined ? {} : { env: this.settings.env }),
            ...(this.settings.mcpServers === undefined
              ? {}
              : { mcpServers: this.settings.mcpServers }),
          },
          sessionId,
          signal,
        ),
      );
    } catch (error) {
      this.log("recovery.end", "failed");
      return { type: "handoff-required", reason: message(error) };
    }
    await this.installSession(session);
    this.record.ownerPid = this.deps.ownerPid ?? process.pid;
    delete this.record.endedAt;
    this.lastOutcome = { status: "finished" };
    const previousOutcome =
      previousStatus === "interrupted"
        ? "The previous turn was interrupted."
        : `This run previously ended with status ${previousStatus}.`;
    this.emit({ type: "note", text: "Reconnected to the earlier agent session." });
    await this.setStatus(
      "idle",
      `${previousOutcome}${previousReason ? ` Recorded reason: ${previousReason}.` : ""} The ACP session was restored; review the worktree before replying.`,
    );
    if (this.sessionExited && !this.ending) {
      void this.end({ status: "failed", reason: "the agent exited while idle" });
    }
    this.log("recovery.end", "succeeded");
    return { type: "restored" };
  }

  /**
   * Starts a fresh ACP session in this run's existing worktree. Its first turn sends the bounded
   * summary with the user's message; the transcript records the summary as a note.
   */
  async handoff(
    summary: string,
    text: string,
    reason: string,
    deliveredText = text,
    origin?: "automatic",
  ): Promise<void> {
    await this.assertRecoverableAndSafe();
    if (summary.trim() === "") throw new Error("the recovery handoff is empty");
    if (summary.length > HANDOFF_PROMPT_LIMIT)
      throw new Error("the recovery handoff exceeds its size limit");
    if (text.trim() === "") throw new Error("the message is empty");
    const context = this.settings.promptContext?.();
    const heading =
      origin === "automatic"
        ? "--- Automatic Code60 update (not written by the user) ---"
        : "--- User request ---";
    const sent = renderPrompt("handoffTurn", this.settings.prompts.handoffTurn, {
      summary,
      message: context ? `${context}\n\n${heading}\n${deliveredText}` : deliveredText,
    });
    this.log("recovery.start", "started");
    let session: AgentSession;
    try {
      session = await this.startRecoveryAgent((signal) =>
        this.deps.agents.start(
          {
            name: this.record.agent,
            ...this.diagnostic(),
            command: this.settings.command,
            cwd: this.record.worktree,
            ...(this.settings.env === undefined ? {} : { env: this.settings.env }),
            ...(this.settings.mcpServers === undefined
              ? {}
              : { mcpServers: this.settings.mcpServers }),
          },
          signal,
        ),
      );
    } catch (error) {
      this.log("recovery.end", "failed");
      throw new Error(`could not start a fresh agent session: ${message(error)}`);
    }
    await this.installSession(session);
    this.log("recovery.end", "succeeded");
    this.record.ownerPid = this.deps.ownerPid ?? process.pid;
    delete this.record.endedAt;
    this.lastOutcome = { status: "finished" };
    this.emit({
      type: "note",
      text: `The earlier agent session could not be restored (${reason.replace(/\.$/, "")}). Started a fresh session in the same worktree with a summary of the earlier work.`,
      detail: summary,
    });
    await this.setStatus("running", "Started a fresh session with a handoff summary.");
    void this.runTurn(text, true, true, sent, origin);
  }

  async setMode(value: ModeChange): Promise<void> {
    const change = parseValue(modeChangeSchema, value);
    const session = this.session;
    if (
      this.settings.mode !== "interactive" ||
      this.status !== "idle" ||
      this.ending ||
      this.modeChanging ||
      this.sessionExited ||
      !session?.setMode
    ) {
      throw new RefusedError(
        "Harness mode can be changed only while the connected session is idle",
      );
    }
    if (!supportsModeChange(this.record.sessionState ?? emptySessionState(), change)) {
      throw new RefusedError("This harness mode is no longer available");
    }
    this.modeChanging = true;
    this.deps.onChange();
    try {
      await session.setMode(change);
    } finally {
      this.modeChanging = false;
      this.deps.onChange();
    }
  }

  /**
   * Sends a follow-up prompt to an idle run (desktop app only). State errors throw synchronously;
   * the promise resolves true once the prompt is dispatched and false if it never will be.
   */
  reply(text: string, origin?: "automatic", deliveredText = text): Promise<boolean> {
    if (this.settings.mode !== "interactive")
      throw new Error("follow-up prompts are only available in the desktop app");
    if (this.status !== "idle" || this.ending || this.modeChanging) {
      throw new Error(`run ${this.id} is ${this.status}; you can reply only to an idle run`);
    }
    if (text.trim() === "") throw new Error("the reply is empty");
    const context = this.settings.promptContext?.();
    const heading =
      origin === "automatic"
        ? "--- Automatic Code60 update (not written by the user) ---"
        : "--- User request ---";
    const sent = context ? `${context}\n\n${heading}\n${deliveredText}` : deliveredText;
    this.settleDispatch(false);
    const dispatched = new Promise<boolean>((resolve) => {
      this.dispatchSettle = resolve;
    });
    const receipt = this.dispatchSettle;
    this.runTurn(text, true, false, sent, origin)
      .catch((error) => this.end({ status: "failed", reason: message(error) }))
      .finally(() => {
        if (this.dispatchSettle === receipt) this.settleDispatch(false);
      });
    return dispatched;
  }

  /** Ends an idle run. Its final status comes from the last turn. */
  finish(): void {
    if (this.status !== "idle" || this.ending) {
      throw new Error(`run ${this.id} is ${this.status}; you can finish only an idle run`);
    }
    void this.end(this.lastOutcome ?? { status: "finished" });
  }

  /** Cancels the current turn. Returns false when no turn is in progress. */
  cancelTurn(cause: CancelCause = "user"): boolean {
    const session = this.session;
    const preparing = this.preparationAbort;
    if (!this.turnActive || (session === undefined && preparing === undefined)) return false;
    if (this.cancelCause !== undefined) return true;
    this.cancelCause = cause;
    this.log("cancel.requested", cause === "timeout" ? "timed_out" : "cancelled");
    this.withdrawPending();
    // Before dispatch there is no agent turn to cancel; abort preparation or handoff startup.
    if (preparing !== undefined || session === undefined) {
      preparing?.abort();
      return true;
    }
    if (this.status === "waiting") void this.setStatus("running");
    session.cancel().catch(() => {});
    this.graceTimer = this.deps.clock.setTimeout(
      () => {
        this.log("cancel.escalated", "cancelled");
        void session.stop(this.forced ? 0 : this.settings.killGraceMs).catch(() => {
          this.log("cancel.escalation_failed", "failed");
        });
      },
      this.forced ? 0 : this.settings.cancelGraceMs,
    );
    return true;
  }

  answerPermission(id: string, answer: PermissionAnswer): boolean {
    const entry = this.pending.get(id);
    if (entry === undefined) return false;
    this.pending.delete(id);
    this.emitPermission(entry.view, answer, "user");
    if (this.pending.size === 0 && this.status === "waiting") void this.setStatus("running");
    entry.resolve(answer);
    return true;
  }

  /** Cancels any turn and ends the run. With `force`, skips the grace periods. */
  shutdown(force = false): Promise<void> {
    this.shutdownRequested = true;
    if (force) {
      this.forced = true;
      this.startAbort.abort();
      if (this.session !== undefined) void this.session.stop(0);
      if (this.cancelCause !== undefined && this.session !== undefined) {
        this.deps.clock.clearTimeout(this.graceTimer);
      }
    }
    switch (this.status) {
      case "queued":
        void this.end({ status: "cancelled", reason: "cancelled before it started" });
        break;
      case "idle":
        if (!this.ending) void this.end(this.lastOutcome ?? { status: "finished" });
        break;
      case "running":
      case "waiting":
        if (!this.cancelTurn("shutdown")) this.startAbort.abort();
        break;
      default:
        break;
    }
    return this.finished;
  }

  private isFinal(): boolean {
    return !ACTIVE_STATUSES.has(this.status);
  }

  private async startAndRun(): Promise<void> {
    const { git, agents, clock } = this.deps;
    const { record, settings } = this;
    await this.setStatus("running");
    if (record.branch !== null && record.base !== null) {
      try {
        const spec = {
          repoDir: settings.repoDir,
          path: record.worktree,
          branch: record.branch,
          base: record.base,
        };
        if (settings.mode === "interactive") await git.addWorktree(spec, this.startAbort.signal);
        else await git.addWorktree(spec);
        this.worktreeCreated = true;
        this.log("worktree.create", "succeeded");
      } catch (error) {
        this.log("worktree.create", "failed");
        if (settings.mode === "interactive" && this.shutdownRequested)
          return this.end({ status: "cancelled", reason: "cancelled before the agent started" });
        return this.end({
          status: "failed",
          reason: `could not create the worktree: ${message(error)}`,
        });
      }
    }
    if (this.shutdownRequested) {
      return this.end({ status: "cancelled", reason: "cancelled before the agent started" });
    }

    let startTimedOut = false;
    const timer = clock.setTimeout(() => {
      startTimedOut = true;
      this.startAbort.abort();
    }, settings.turnTimeoutMs);
    let session: AgentSession;
    try {
      session = await agents.start(
        {
          name: record.agent,
          ...this.diagnostic(),
          command: settings.command,
          cwd: record.worktree,
          ...(settings.env === undefined ? {} : { env: settings.env }),
          ...(settings.mcpServers === undefined ? {} : { mcpServers: settings.mcpServers }),
        },
        this.startAbort.signal,
      );
    } catch (error) {
      clock.clearTimeout(timer);
      if (error instanceof AgentStartError && error.stderrTail !== "") {
        this.emit({ type: "stderr", text: diagnosticText(error.stderrTail, 64 * 1024) });
      }
      if (startTimedOut) {
        return this.end({
          status: "timed_out",
          reason: `the agent did not start within ${formatDuration(settings.turnTimeoutMs)}`,
        });
      }
      if (this.shutdownRequested) {
        return this.end({ status: "cancelled", reason: "cancelled before the agent started" });
      }
      return this.end({ status: "failed", reason: message(error) });
    }
    clock.clearTimeout(timer);
    await this.installSession(session);

    if (this.shutdownRequested) {
      return this.end({ status: "cancelled", reason: "cancelled before the first prompt" });
    }
    if (record.firstPrompt === "") {
      this.lastOutcome = { status: "finished", reason: "no prompt was sent" };
      await this.setStatus("idle", "no prompt yet");
      return;
    }
    await this.runTurn(record.firstPrompt);
  }

  private async installSession(session: AgentSession): Promise<void> {
    this.session = session;
    this.sessionExited = false;
    if (session.sessionState || this.record.sessionState) {
      this.emit({ type: "sessionState", state: session.sessionState ?? emptySessionState() });
    }
    session.onUpdate((update) => {
      if (
        this.session === session &&
        (update.type !== "sessionState" || (!this.sessionExited && !this.ending))
      )
        this.emit(update);
    });
    session.onPermission((request, signal) => this.onPermission(request, signal));
    void session.exited.then(() => {
      if (this.session !== session) return;
      this.sessionExited = true;
      if (this.status === "idle" && !this.ending) {
        void this.end({ status: "failed", reason: "the agent exited while idle" });
      }
    });

    this.record.agentPid = session.pid;
    if (session.identity === undefined) delete this.record.agentIdentity;
    else this.record.agentIdentity = session.identity;
    if (this.deps.ownerIdentity) this.record.ownerIdentity = this.deps.ownerIdentity;
    else delete this.record.ownerIdentity;
    this.record.agentCommand = this.settings.command;
    this.record.acpSessionId = session.sessionId;
    const commandLine = await this.deps.processes.commandLine(session.pid).catch(() => undefined);
    if (commandLine === undefined) delete this.record.agentCommandLine;
    else this.record.agentCommandLine = commandLine;
    await this.save();
  }

  private async assertRecoverableAndSafe(): Promise<void> {
    if (ACTIVE_STATUSES.has(this.status) || this.ending) {
      throw new RefusedError(`run ${this.id} is ${this.status}; only ended runs can be recovered`);
    }
    if (await recordedAgentAlive(this.deps.processes, this.record)) {
      throw new RefusedError(
        `the leftover agent for run ${this.id} is still alive (process group ${this.record.agentPid}); stop it before retrying`,
      );
    }
  }

  private async startRecoveryAgent(
    start: (signal: AbortSignal) => Promise<AgentSession>,
    cancel: AbortSignal = this.startAbort.signal,
  ): Promise<AgentSession> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    cancel.addEventListener("abort", abort, { once: true });
    if (cancel.aborted) abort();
    let timedOut = false;
    const timer = this.deps.clock.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.settings.turnTimeoutMs);
    try {
      const session = await start(controller.signal);
      if (timedOut) {
        await session.stop(0);
        throw new Error(
          `the agent did not start within ${formatDuration(this.settings.turnTimeoutMs)}`,
        );
      }
      return session;
    } catch (error) {
      if (timedOut) {
        throw new Error(
          `the agent did not start within ${formatDuration(this.settings.turnTimeoutMs)}`,
        );
      }
      throw error;
    } finally {
      this.deps.clock.clearTimeout(timer);
      cancel.removeEventListener("abort", abort);
    }
  }

  /** Ends a turn whose request was never dispatched, keeping its text visible. */
  private async notSent(statusSaved: Promise<void>, note: string, text: string): Promise<void> {
    const { clock } = this.deps;
    clock.clearTimeout(this.turnTimer);
    clock.clearTimeout(this.graceTimer);
    this.turnActive = false;
    this.withdrawPending();
    this.settleDispatch(false);
    await statusSaved;
    this.emit({ type: "note", text: note, detail: text });
    if (this.shutdownRequested)
      return this.end({ status: "cancelled", reason: "cancelled before dispatch" });
    if (this.session === undefined)
      return this.end(
        this.cancelCause
          ? { status: "cancelled", reason: "cancelled during context handoff" }
          : { status: "failed", reason: "the context handoff session could not start" },
      );
    await this.setStatus("idle", "Message not sent.");
  }

  private settleDispatch(sent: boolean): void {
    const settle = this.dispatchSettle;
    this.dispatchSettle = undefined;
    settle?.(sent);
  }

  private async runTurn(
    text: string,
    setInitialPrompt = true,
    preserveInterruptedOnFailure = false,
    sent = text,
    origin?: "automatic",
  ): Promise<void> {
    let session = this.session as AgentSession;
    const { clock } = this.deps;
    const { settings } = this;
    this.record.turns += 1;
    this.turnOperation = randomUUID();
    this.turnStarted = clock.now().getTime();
    this.log("turn.start", "started");
    const turn = this.record.turns;
    if (setInitialPrompt && this.record.firstPrompt === "") this.record.firstPrompt = text;
    this.cancelCause = undefined;
    this.turnActive = true;
    const statusSaved = this.status === "running" ? Promise.resolve() : this.setStatus("running");
    this.turnTimer = clock.setTimeout(() => this.cancelTurn("timeout"), settings.turnTimeoutMs);

    let stopReason: StopReason | undefined;
    let failure: unknown;
    let memoryUsed: string[] = [];
    try {
      if (this.memory) {
        const abort = new AbortController();
        this.preparationAbort = abort;
        const signal = AbortSignal.any([this.startAbort.signal, abort.signal]);
        const stopped = () => this.cancelCause !== undefined || this.shutdownRequested;
        try {
          let preparation: MemoryPreparation;
          try {
            preparation = await this.memory.prepare(
              {
                text,
                delivered: sent,
                turn,
                usage: this.record.sessionState?.usage ?? null,
              },
              signal,
            );
          } catch {
            return await this.notSent(
              statusSaved,
              "Memory preparation failed. This message was not sent. Open Settings → Memory, resolve the warning and try again. Unsent request:",
              text,
            );
          }
          if (stopped())
            return await this.notSent(
              statusSaved,
              "Cancelled before this message was sent. Unsent request:",
              text,
            );
          if (preparation.rollover) {
            // Retire an idle physical session only. Logical task/gateway ownership stays in host.
            this.session = undefined;
            try {
              await session.stop(this.settings.killGraceMs);
              session = await this.startRecoveryAgent(
                (start) =>
                  this.deps.agents.start(
                    {
                      name: this.record.agent,
                      command: settings.command,
                      cwd: this.record.worktree,
                      ...(settings.env === undefined ? {} : { env: settings.env }),
                      ...(settings.mcpServers === undefined
                        ? {}
                        : { mcpServers: settings.mcpServers }),
                    },
                    start,
                  ),
                signal,
              );
              await this.installSession(session);
            } catch (error) {
              return await this.notSent(
                statusSaved,
                stopped()
                  ? "Cancelled during context handoff before this message was sent. Unsent request:"
                  : `Context handoff failed (${message(error)}). This message was not sent. Unsent request:`,
                text,
              );
            }
            if (stopped())
              return await this.notSent(
                statusSaved,
                "Cancelled during context handoff before this message was sent. Unsent request:",
                text,
              );
            this.emit({
              type: "note",
              text: "Context handoff: continued in a fresh agent session. Historical memory is evidence, not restored authority.",
            });
          }
          if (preparation.warning) this.emit({ type: "note", text: preparation.warning });
          if (preparation.context) sent = `${preparation.context}\n\n${sent}`;
          memoryUsed = preparation.used;
        } finally {
          this.preparationAbort = undefined;
        }
      }
      this.emit({ type: "prompt", turn, text, ...(origin === undefined ? {} : { origin }) });
      this.settleDispatch(true);
      if (memoryUsed.length)
        this.emit({
          type: "note",
          text: `Memory used (${memoryUsed.length}). Inspect Settings → Memory for sources.`,
          detail: JSON.stringify(memoryUsed),
        });
      stopReason = await session.prompt(sent);
    } catch (error) {
      failure = error;
    }
    const completedAt = clock.now().toISOString();
    clock.clearTimeout(this.turnTimer);
    clock.clearTimeout(this.graceTimer);
    this.turnActive = false;
    this.withdrawPending();
    await statusSaved;

    const cause = this.cancelCause;
    const causeOutcome = (c: CancelCause): Outcome =>
      c === "timeout"
        ? {
            status: "timed_out",
            reason: `turn ${turn} exceeded the ${formatDuration(settings.turnTimeoutMs)} turn timeout`,
          }
        : {
            status: "cancelled",
            reason: c === "user" ? "the turn was cancelled" : "cancelled during shutdown",
          };

    if (stopReason === undefined) {
      this.log(
        "turn.end",
        cause === "timeout" ? "timed_out" : cause ? "cancelled" : "failed",
        clock.now().getTime() - this.turnStarted,
      );
      if (preserveInterruptedOnFailure) {
        return this.end(
          {
            status: "interrupted",
            reason: `the handoff session could not complete: ${message(failure)}`,
          },
          { turn, completedAt },
        );
      }
      return this.end(
        cause !== undefined ? causeOutcome(cause) : { status: "failed", reason: message(failure) },
        { turn, completedAt },
      );
    }
    this.record.lastStopReason = stopReason;
    const outcome =
      cause !== undefined && (cause === "timeout" || stopReason === "cancelled")
        ? causeOutcome(cause)
        : outcomeOf(stopReason);
    this.log(
      "turn.end",
      outcome.status === "finished" ? "succeeded" : outcome.status,
      clock.now().getTime() - this.turnStarted,
    );
    this.emit({ type: "turnEnd", turn, stopReason, completedAt, outcome: outcome.status });
    if (settings.mode === "headless" || this.shutdownRequested) return this.end(outcome);

    this.lastOutcome = outcome;
    const note = cause === "timeout" ? " (turn timed out)" : "";
    await this.setStatus("idle", `turn ${turn} ended: ${stopReason}${note}`);
  }

  private onPermission(request: PermissionRequest, signal: AbortSignal): Promise<PermissionAnswer> {
    const rule = this.settings.decide(request.kind);
    if (rule !== "ask" || this.settings.mode === "headless") {
      const answer: PermissionAnswer = rule === "allow" ? "allow" : "deny";
      this.emitPermission(request, answer, "policy");
      return Promise.resolve(answer);
    }
    if (signal.aborted || this.cancelCause !== undefined || this.ending) {
      return Promise.resolve("deny");
    }
    this.permissionCount += 1;
    const id = `${this.id}#${this.permissionCount}`;
    return new Promise((resolve) => {
      this.pending.set(id, { view: { id, runId: this.id, ...request }, resolve });
      signal.addEventListener(
        "abort",
        () => {
          if (!this.pending.delete(id)) return;
          resolve("deny");
          if (this.pending.size === 0 && this.status === "waiting" && !this.ending) {
            void this.setStatus("running");
          }
        },
        { once: true },
      );
      void this.setStatus("waiting");
    });
  }

  private withdrawPending(): void {
    const entries = [...this.pending.values()];
    this.pending.clear();
    for (const entry of entries) entry.resolve("deny");
  }

  private emitPermission(
    request: PermissionRequest,
    answer: PermissionAnswer,
    by: "policy" | "user",
  ): void {
    this.log("permission.decided", answer === "allow" ? "allowed" : "denied");
    this.emit({
      type: "permission",
      toolCallId: request.toolCallId,
      title: request.title,
      kind: request.kind,
      decision: answer === "allow" ? "allowed" : "denied",
      by,
      ...(request.options === undefined
        ? {}
        : { options: request.options.map((option) => ({ ...option })) }),
    });
  }

  private async end(
    outcome: Outcome,
    timing?: { turn: number; completedAt: string },
  ): Promise<void> {
    if (this.ending) return this.finished;
    this.ending = true;
    const { clock } = this.deps;
    clock.clearTimeout(this.turnTimer);
    clock.clearTimeout(this.graceTimer);
    this.withdrawPending();
    this.deps.onChange();
    const session = this.session;
    if (session !== undefined) {
      try {
        await session.stop(this.forced ? 0 : this.settings.killGraceMs);
        this.log("process.stopped", "succeeded");
      } catch (error) {
        this.log("process.stopped", "failed");
        const reason = `could not verify agent cleanup: ${message(error)}`;
        this.deps.warn(reason);
        outcome = {
          status: outcome.status === "finished" ? "failed" : outcome.status,
          reason: outcome.reason ? `${outcome.reason}; ${reason}` : reason,
        };
      }
      const tail = session.stderrTail();
      if (tail !== "") this.emit({ type: "stderr", text: diagnosticText(tail, 64 * 1024) });
    }
    if (outcome.status === "interrupted") delete this.record.endedAt;
    else this.record.endedAt = clock.now().toISOString();
    await this.setStatus(outcome.status, outcome.reason, timing);
    this.memory?.dispose();
    this.resolveFinished();
  }

  private setStatus(
    status: RunStatus,
    reason?: string,
    timing?: { turn: number; completedAt: string },
  ): Promise<void> {
    if (reason !== undefined) reason = diagnosticText(reason);
    this.record.status = status;
    if (reason === undefined) delete this.record.reason;
    else this.record.reason = reason;
    this.emit({ type: "status", status, ...(reason === undefined ? {} : { reason }), ...timing });
    return this.save();
  }

  private save(): Promise<void> {
    return this.deps.store.save({ ...this.record }).catch((error) => {
      this.persistenceFailure();
      this.deps.warn(`could not write the record for run ${this.id}: ${message(error)}`);
    });
  }

  private persistenceFailure(): void {
    if (this.persistenceReported) return;
    this.persistenceReported = true;
    this.log("persistence.failed", "failed");
  }

  private emit(body: RunEventBody | AgentUpdate): void {
    if (body.type === "sessionState") {
      if (JSON.stringify(this.record.sessionState) === JSON.stringify(body.state)) return;
      this.record.sessionState = body.state;
      void this.save();
    }
    const event = { runId: this.id, at: this.deps.clock.now().toISOString(), ...body } as RunEvent;
    this.deps.store.appendEvent(event).catch((error) => {
      this.persistenceFailure();
      this.deps.warn(`could not write events for run ${this.id}: ${message(error)}`);
    });
    this.deps.onEvent(event);
    try {
      this.memory?.event(event);
    } catch {
      this.deps.warn("Memory capture is unavailable.");
    }
  }
}
