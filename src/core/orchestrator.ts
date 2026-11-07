import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { AgentMcpServer, Agents, PermissionAnswer } from "../agents/index.js";
import { DEFAULT_PROMPT_TEMPLATES, type PromptTemplates } from "../contracts/index.js";
import type { Git } from "../git/index.js";
import type { Clock } from "./clock.js";
import { decide, type PolicyOverrides } from "./policy.js";
import type { Processes } from "./processes.js";
import type { RecordStore } from "./records.js";
import { Run } from "./run.js";
import type {
  AgentConfig,
  FinalRunStatus,
  Mode,
  PermissionPolicy,
  RecoveryResult,
  RunEvent,
  RunRecord,
  RunResult,
  RunView,
} from "./types.js";

export const CANCEL_GRACE_MS = 10_000;
export const KILL_GRACE_MS = 5_000;

export interface OrchestratorDeps {
  agents: Agents;
  git: Git;
  store: RecordStore;
  clock: Clock;
  processes: Processes;
  ownerPid: number;
  newRunId?: () => string;
}

export interface OrchestratorOptions {
  mode: Mode;
  /** The first prompt. Without one (desktop app only), each run starts idle and waits for a reply. */
  prompt?: string;
  /** One entry per run, in order. The same agent may appear more than once. */
  agents: readonly { name: string; config: AgentConfig }[];
  /** Existing ended run to recover instead of creating new run records. */
  recovery?: RunRecord;
  /** Full commit hash the worktrees start from. Ignored when `directory` is set. */
  base: string;
  /** Run every agent directly in this directory, without creating worktrees. */
  directory?: string;
  /** Directory to run `git worktree` commands in. */
  repoDir: string;
  /** Parent directory of the run worktrees. */
  worktreeRoot: string;
  turnTimeoutMs: number;
  maxParallel: number;
  policy: PermissionPolicy;
  overrides?: PolicyOverrides;
  env?: Readonly<Record<string, string>>;
  cancelGraceMs?: number;
  killGraceMs?: number;
  /** Prompt templates; defaults to the built-in ones. */
  prompts?: Readonly<PromptTemplates>;
  /** Client-provided MCP servers for a scoped session such as the Code60 orchestrator. */
  mcpServers?: readonly AgentMcpServer[];
  /** Dynamic context prepended to each user turn without changing recorded user text. */
  promptContext?: () => string;
}

/** Drives a set of runs. The CLI renders it; nothing here needs a terminal. */
export interface Orchestrator {
  readonly mode: Mode;
  /** Starts runs up to the parallel limit. Idle runs keep their slot. */
  start(): void;
  runs(): RunView[];
  /** Recorded run events, in order. */
  onEvent(listener: (event: RunEvent) => void): () => void;
  /** Any change to what `runs()` returns, including every event. */
  onChange(listener: () => void): () => void;
  /** Problems that do not change a run's outcome, such as a failed record write. */
  onWarning(listener: (message: string) => void): () => void;
  /** `origin` marks a prompt Code60 generated instead of the user. */
  reply(runId: string, text: string, origin?: "automatic"): void;
  /** Attempts ACP restoration; a handoff offer does not mutate the ended run. */
  restore(runId: string): Promise<RecoveryResult>;
  /** Starts a fresh ACP session whose first turn sends the summary and the user's message. */
  handoff(runId: string, summary: string, text: string, reason: string): Promise<void>;
  finish(runId: string): void;
  /** Resolves after this run's cleanup and final record write, independently of other runs. */
  settled(runId: string): Promise<void>;
  cancelTurn(runId: string): boolean;
  answerPermission(permissionId: string, answer: PermissionAnswer): boolean;
  /** Cancels every active turn and ends every run. With `force`, skips the grace periods. */
  shutdown(force?: boolean): Promise<void>;
  /** Resolves when every run has a final status. */
  readonly done: Promise<void>;
  /** Final results, with changed-file counts. Call after `done`. */
  results(): Promise<RunResult[]>;
}

export function newRunId(clock: Clock): string {
  const iso = clock.now().toISOString();
  const stamp = `${iso.slice(0, 10).replaceAll("-", "")}-${iso.slice(11, 19).replaceAll(":", "")}`;
  return `${stamp}-${randomBytes(3).toString("hex")}`;
}

export async function createOrchestrator(
  deps: OrchestratorDeps,
  options: OrchestratorOptions,
): Promise<Orchestrator> {
  const ownerIdentity = await deps.processes.identity?.(deps.ownerPid);
  if (ownerIdentity === null) throw new Error("Cannot verify the run owner");
  const eventListeners = new Set<(event: RunEvent) => void>();
  const changeListeners = new Set<() => void>();
  const warningListeners = new Set<(message: string) => void>();
  const warned = new Set<string>();
  const notifyChange = () => {
    for (const listener of changeListeners) listener();
  };
  const runDeps = {
    agents: deps.agents,
    git: deps.git,
    store: deps.store,
    clock: deps.clock,
    processes: deps.processes,
    ownerPid: deps.ownerPid,
    ...(ownerIdentity === undefined ? {} : { ownerIdentity }),
    onEvent(event: RunEvent) {
      for (const listener of eventListeners) listener(event);
      notifyChange();
    },
    onChange: notifyChange,
    warn(message: string) {
      if (warned.has(message)) return;
      warned.add(message);
      for (const listener of warningListeners) listener(message);
    },
  };

  const ids = new Set<string>();
  const makeId = () => {
    for (;;) {
      const id = deps.newRunId?.() ?? newRunId(deps.clock);
      if (!ids.has(id)) {
        ids.add(id);
        return id;
      }
    }
  };

  const runSettings = (config: AgentConfig) => ({
    mode: options.mode,
    repoDir: options.repoDir,
    command: config.command,
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(options.mcpServers === undefined ? {} : { mcpServers: options.mcpServers }),
    ...(options.promptContext === undefined ? {} : { promptContext: options.promptContext }),
    turnTimeoutMs: options.turnTimeoutMs,
    cancelGraceMs: options.cancelGraceMs ?? CANCEL_GRACE_MS,
    killGraceMs: options.killGraceMs ?? KILL_GRACE_MS,
    decide: (kind: Parameters<typeof decide>[0]) =>
      decide(kind, options.policy, options.mode, options.overrides),
    prompts: options.prompts ?? DEFAULT_PROMPT_TEMPLATES,
  });
  const startedAt = deps.clock.now().toISOString();
  const runs = options.recovery
    ? [
        (() => {
          const agent = options.agents.find(({ name }) => name === options.recovery?.agent);
          if (!agent) throw new Error(`agent '${options.recovery.agent}' is not configured`);
          return new Run(options.recovery, runDeps, runSettings(agent.config));
        })(),
      ]
    : options.agents.map(({ name, config }) => {
        const id = makeId();
        const record: RunRecord = {
          id,
          agent: name,
          status: "queued",
          firstPrompt: options.prompt ?? "",
          turns: 0,
          ...(options.directory === undefined
            ? {
                base: options.base,
                branch: `code60/${id}`,
                worktree: join(options.worktreeRoot, id),
              }
            : { base: null, branch: null, worktree: options.directory }),
          ownerPid: deps.ownerPid,
          ...(ownerIdentity === undefined ? {} : { ownerIdentity }),
          startedAt,
        };
        return new Run(record, runDeps, runSettings(config));
      });
  if (!options.recovery) await Promise.all(runs.map((run) => run.queue()));

  const queue = options.recovery ? [] : [...runs];
  let active = 0;
  let shuttingDown = false;
  const pump = () => {
    while (!shuttingDown && active < options.maxParallel && queue.length > 0) {
      const run = queue.shift() as Run;
      active += 1;
      void run.start();
      void run.finished.then(() => {
        active -= 1;
        pump();
      });
    }
  };

  const find = (runId: string): Run => {
    const run = runs.find((r) => r.id === runId);
    if (run === undefined) throw new Error(`no run with ID '${runId}'`);
    return run;
  };

  return {
    mode: options.mode,
    start: pump,
    runs: () => runs.map((run) => run.view()),
    settled: (runId) => find(runId).finished,
    onEvent(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    onChange(listener) {
      changeListeners.add(listener);
      return () => changeListeners.delete(listener);
    },
    onWarning(listener) {
      warningListeners.add(listener);
      return () => warningListeners.delete(listener);
    },
    reply: (runId, text, origin) => find(runId).reply(text, origin),
    restore: (runId) => find(runId).restore(),
    handoff: (runId, summary, text, reason) => find(runId).handoff(summary, text, reason),
    finish: (runId) => find(runId).finish(),
    cancelTurn: (runId) => find(runId).cancelTurn("user"),
    answerPermission(permissionId, answer) {
      return runs.some((run) => run.answerPermission(permissionId, answer));
    },
    async shutdown(force = false) {
      shuttingDown = true;
      await Promise.all(runs.map((run) => run.shutdown(force)));
    },
    done: Promise.all(runs.map((run) => run.finished)).then(() => {}),
    async results() {
      return Promise.all(
        runs.map(async (run): Promise<RunResult> => {
          const r = run.record;
          let changedFiles: number | null = null;
          if (run.hasWorktree && r.base !== null) {
            changedFiles = await deps.git
              .changedFiles(r.worktree, r.base)
              .then((files) => files.length)
              .catch(() => null);
          }
          return {
            id: r.id,
            agent: r.agent,
            status: r.status as FinalRunStatus,
            reason: r.reason ?? null,
            branch: r.branch,
            worktree: r.worktree,
            changedFiles,
          };
        }),
      );
    },
  };
}
