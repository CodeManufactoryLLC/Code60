import { createHash, randomUUID } from "node:crypto";
import { realpath, stat, statfs } from "node:fs/promises";
import {
  type Automation,
  type AutomationAction,
  type AutomationActionDraft,
  type AutomationDiff,
  type AutomationTranscript,
  DEFAULT_PROMPT_LANE_LIMIT,
  type Execution,
  type RepositoryPin,
} from "../contracts/index.js";
import {
  type Config,
  type CoreDeps,
  DEFAULT_CONFIG,
  isBuiltinCodebaseSearchPermission,
  loadConfig,
  type Orchestrator,
  openWorkspace,
  prepareRuns,
  recordedAgentAlive,
  type SessionResourceFactory,
  UsageError,
} from "../core/index.js";
import { fileCode } from "../platform/index.js";
import { AutomationError } from "./errors.js";
import { type ActionExecutionOutcome, type ActionHandler, ExecutionRefused } from "./handlers.js";

export { ExecutionRefused };

function providerHash(config: Config, name: string): string {
  const agent = Object.hasOwn(config.agents, name) ? config.agents[name] : undefined;
  if (!agent) throw new ExecutionRefused("provider_missing");
  return createHash("sha256").update(JSON.stringify(agent.command)).digest("hex");
}

export async function repositoryIdentity(path: string): Promise<RepositoryPin> {
  const canonical = await realpath(path);
  const info = await stat(canonical, { bigint: true });
  if (!info.isDirectory()) throw new ExecutionRefused("repository_missing");
  return { path: canonical, dev: String(info.dev), ino: String(info.ino) };
}

export async function verifyRepository(repository: RepositoryPin): Promise<void> {
  let current: RepositoryPin;
  try {
    current = await repositoryIdentity(repository.path);
  } catch {
    throw new ExecutionRefused("repository_missing");
  }
  if (
    current.path !== repository.path ||
    current.dev !== repository.dev ||
    current.ino !== repository.ino
  )
    throw new ExecutionRefused("repository_replaced");
}

type PromptAction = Extract<AutomationAction, { type: "prompt" }>;
type PromptActionDraft = Extract<AutomationActionDraft, { type: "prompt" }>;

/** Never inherit global permissions, MCP integrations, prompts or memory. */
export function executionConfig(config: Config, action: PromptAction): Config {
  const agent = config.agents[action.agent];
  if (!agent || providerHash(config, action.agent) !== action.providerHash)
    throw new ExecutionRefused("provider_changed");
  return {
    ...DEFAULT_CONFIG,
    agents: { [action.agent]: { command: [...agent.command] } },
    defaultAgent: action.agent,
    maxParallel: 1,
    turnTimeout: action.turnTimeout,
    permissions: {
      default: "deny",
      ...Object.fromEntries(action.allow.map((kind) => [kind, "allow"])),
    },
    prompts: { ...DEFAULT_CONFIG.prompts },
    worktreeDir: null,
  };
}

async function readPromptEvidence(
  deps: CoreDeps,
  env: Readonly<NodeJS.ProcessEnv>,
  execution: Execution,
  kind: "transcript" | "diff",
): Promise<AutomationTranscript | AutomationDiff> {
  if (execution.artifact.type !== "prompt")
    throw new AutomationError("invalid", "This execution is not a prompt run.");
  const artifact = execution.artifact;
  if (!artifact.runId) throw new AutomationError("not_found", "This occurrence has no agent run.");
  await verifyRepository(artifact.repository);
  const workspace = await openWorkspace(deps, artifact.repository.path, env);
  const record = await workspace.store.read(artifact.runId);
  if (kind === "diff") {
    const pin = artifact.evidence;
    if (
      !pin ||
      record.base !== pin.base ||
      record.branch !== pin.branch ||
      (await realpath(record.worktree)) !== pin.worktree.path
    )
      throw new AutomationError("refused", "No pinned isolated changes are available.");
    await verifyRepository(pin.worktree);
    const text = await deps.git.diff(pin.worktree.path, pin.base);
    return {
      executionId: execution.id,
      runId: record.id,
      text: text.slice(0, 48_000),
      truncated: text.length > 48_000,
    };
  }
  const events = await workspace.store.readEvents(record.id);
  const entries: AutomationTranscript["entries"] = [];
  let size = 0;
  let truncated = false;
  let stream: "message" | "thought" | undefined;
  for (const [index, event] of events.entries()) {
    // Raw protocol records accompany the normalized chunks; never render them twice.
    if (event.type === "acp" || event.type === "sessionState") continue;
    const text =
      "text" in event && typeof event.text === "string"
        ? event.text
        : event.type === "permission"
          ? `${event.kind}: ${event.decision}`
          : event.type === "status"
            ? event.status
            : event.type === "toolCall"
              ? `${event.title}: ${event.status}`
              : "";
    const previous = entries.at(-1);
    const merge = stream === event.type && previous?.type === event.type;
    stream = event.type === "message" || event.type === "thought" ? event.type : undefined;
    if (!text) continue;
    const remaining = 48_000 - size;
    if (remaining <= 0 || (!merge && entries.length >= 500)) {
      truncated = true;
      break;
    }
    if (merge && previous) previous.text += text.slice(0, remaining);
    else
      entries.push({
        key: String(index),
        at: event.at,
        type:
          event.type === "message" ||
          event.type === "thought" ||
          event.type === "prompt" ||
          event.type === "permission" ||
          event.type === "status"
            ? event.type
            : event.type === "toolCall"
              ? "tool"
              : "note",
        text: text.slice(0, remaining),
      });
    size += Math.min(text.length, remaining);
    if (text.length > remaining) truncated = true;
  }
  return {
    executionId: execution.id,
    runId: record.id,
    status: execution.status,
    reason: execution.reason,
    entries,
    truncated,
  };
}

export interface PromptHandlerToolOptions {
  codeTools?: (repositoryPath: string) => SessionResourceFactory | undefined;
  onRepositoryActive?: (repositoryPath: string) => void;
}

export function createPromptActionHandler(
  deps: CoreDeps,
  env: Readonly<NodeJS.ProcessEnv>,
  laneLimit = DEFAULT_PROMPT_LANE_LIMIT,
  tools: PromptHandlerToolOptions = {},
): ActionHandler<"prompt"> {
  const configuration = () => loadConfig(deps.fs, env);

  const inspect = async (execution: Execution): Promise<"gone" | "blocked"> => {
    if (execution.artifact.type !== "prompt") return "blocked";
    const artifact = execution.artifact;
    try {
      await verifyRepository(artifact.repository);
      const workspace = await openWorkspace(deps, artifact.repository.path, env);
      if (!artifact.runId) return "blocked";
      // The record store reports a missing run as a UsageError rather than ENOENT.
      const record = await workspace.store.read(artifact.runId).catch((error) => {
        if (!(error instanceof UsageError) && fileCode(error) !== "ENOENT") throw error;
        return null;
      });
      if (!record) {
        // Only a durable prelaunch claim (or a known prelaunch refusal) proves no process started.
        return execution.status === "claimed" ||
          [
            "low_disk",
            "provider_missing",
            "provider_changed",
            "repository_missing",
            "repository_replaced",
            "base_missing",
          ].includes(execution.reason ?? "")
          ? "gone"
          : "blocked";
      }
      if (
        record.agentPid === undefined &&
        ["running", "waiting", "idle", "interrupted"].includes(record.status)
      )
        return "blocked"; // Crash between spawn and publication of process identity.
      return (await recordedAgentAlive(deps.processes, record)) ? "blocked" : "gone";
    } catch {
      return "blocked";
    }
  };

  return {
    type: "prompt",
    concurrency(action) {
      return {
        lanes: [{ name: "prompt", limit: laneLimit }],
        resources: [`repo:${action.repository.dev}:${action.repository.ino}`],
      };
    },
    async validate(draft: PromptActionDraft): Promise<PromptAction> {
      const repository = await repositoryIdentity(draft.repository);
      const repo = await deps.git.repoInfo(repository.path);
      if (!repo)
        throw new AutomationError("refused", "Choose a Git repository with a local base branch.");
      await deps.git.resolveCommit(repository.path, `refs/heads/${draft.baseBranch}`);
      const hash = providerHash(await configuration(), draft.agent);
      const { repository: _repository, ...fields } = draft;
      return { ...fields, repository, providerHash: hash };
    },
    summarize(action) {
      return {
        agent: action.agent,
        repository: { dev: action.repository.dev, ino: action.repository.ino },
      };
    },
    prepareClaim(action, skipped) {
      return {
        type: "prompt",
        repository: { ...action.repository },
        evidence: null,
        runId: skipped ? null : `auto-${randomUUID()}`,
        denials: 0,
        changedFiles: null,
      };
    },
    inspect,
    async reconcileOnRestart(execution) {
      const state = await inspect(execution);
      if (state === "blocked") {
        return {
          kind: "blocked",
          runId: execution.artifact.type === "prompt" ? execution.artifact.runId : null,
        };
      }
      return { kind: "interrupted", reason: "service_restarted" };
    },
    readEvidence(execution, kind) {
      return readPromptEvidence(deps, env, execution, kind);
    },
    async execute(
      automation: Automation,
      execution: Execution,
      ctx,
    ): Promise<ActionExecutionOutcome> {
      if (automation.action.type !== "prompt" || execution.artifact.type !== "prompt")
        throw new Error("Prompt handler received non-prompt execution");
      const action = automation.action;
      const runId = execution.artifact.runId;
      await verifyRepository(action.repository);
      const disk = await statfs(action.repository.path, { bigint: true });
      if (disk.bavail * disk.bsize < 2n * 1024n * 1024n * 1024n)
        throw new ExecutionRefused("low_disk");
      let base: string;
      try {
        base = await deps.git.resolveCommit(
          action.repository.path,
          `refs/heads/${action.baseBranch}`,
        );
      } catch {
        throw new ExecutionRefused("base_missing");
      }
      const config = executionConfig(await configuration(), action);
      if (ctx.signal.aborted)
        return {
          status: "cancelled",
          reason: ctx.abortKind() === "shutdown" ? "service_stopped" : "cancelled_by_user",
        };
      let orchestrator: Orchestrator | undefined;
      const cancel = () => {
        void orchestrator?.shutdown().catch(() => {});
      };
      ctx.signal.addEventListener("abort", cancel);
      let notice: ReturnType<typeof setTimeout> | undefined;
      let disposed = false;
      const publish = () => {
        if (disposed || notice) return;
        notice = setTimeout(() => {
          notice = undefined;
          try {
            ctx.notify();
          } catch {
            /* Display failures cannot affect execution. */
          }
        }, 50);
      };
      let denials = 0;
      let persistenceFailed = false;
      let unsubscribe = () => {};
      let unwarn = () => {};
      try {
        if (!runId) throw new Error("Missing preclaimed run");
        const { memory: _memory, ...headlessDeps } = deps;
        const git = Object.create(deps.git) as CoreDeps["git"];
        git.addWorktree = async (spec) => {
          await verifyRepository(action.repository);
          await deps.git.addWorktree(spec);
          const evidence = {
            worktree: await repositoryIdentity(spec.path),
            base: spec.base,
            branch: spec.branch,
          };
          await ctx.updateArtifact((current) =>
            current.type === "prompt" ? { ...current, evidence } : current,
          );
        };
        const preparationDeps: CoreDeps = {
          ...headlessDeps,
          newRunId: () => runId,
          git,
          fs: {
            ...deps.fs,
            async writeFile(...args) {
              try {
                await deps.fs.writeFile(...args);
              } catch (error) {
                persistenceFailed = true;
                cancel();
                throw error;
              }
            },
            async appendFile(...args) {
              try {
                await deps.fs.appendFile(...args);
                publish();
              } catch (error) {
                persistenceFailed = true;
                cancel();
                throw error;
              }
            },
            async rename(...args) {
              try {
                await deps.fs.rename(...args);
              } catch (error) {
                persistenceFailed = true;
                cancel();
                throw error;
              }
            },
          },
        };
        tools.onRepositoryActive?.(action.repository.path);
        const sessionResources = tools.codeTools?.(action.repository.path);
        const prepared = await prepareRuns(
          preparationDeps,
          {
            cwd: action.repository.path,
            env,
            mode: "headless",
            prompt: action.prompt,
            agents: [action.agent],
            base,
            workspaceMode: "worktree",
            requireIsolation: true,
            ...(sessionResources ? { sessionResources } : {}),
            ...(sessionResources ? { allowPermission: isBuiltinCodebaseSearchPermission } : {}),
            usageAttribution: {
              surface: "scheduled-job",
              scheduleId: automation.id,
              executionId: execution.id,
              projectId: createHash("sha256")
                .update(action.repository.path)
                .digest("hex")
                .slice(0, 16),
            },
          },
          config,
        );
        orchestrator = prepared.orchestrator;
        unsubscribe = orchestrator.onEvent((event) => {
          if (event.type === "permission" && event.decision === "denied") denials++;
        });
        unwarn = orchestrator.onWarning(() => {
          persistenceFailed = true;
          cancel();
        });
        await verifyRepository(action.repository);
        if (ctx.signal.aborted || persistenceFailed) await orchestrator.shutdown();
        else orchestrator.start();
        await orchestrator.done;
        const [result] = await orchestrator.results();
        if (!result) throw new Error("Missing result");
        const status =
          result.status === "timed_out"
            ? "timed_out"
            : result.status === "finished"
              ? "finished"
              : result.status === "cancelled"
                ? "cancelled"
                : "failed";
        return {
          status,
          reason: persistenceFailed
            ? "persistence_failed"
            : status === "timed_out"
              ? "timed_out"
              : status === "cancelled"
                ? ctx.abortKind() === "shutdown"
                  ? "service_stopped"
                  : "cancelled_by_user"
                : status === "failed"
                  ? "agent_failed"
                  : null,
          artifact: (current) =>
            current.type === "prompt"
              ? { ...current, denials, changedFiles: result.changedFiles }
              : current,
        };
      } finally {
        disposed = true;
        clearTimeout(notice);
        ctx.signal.removeEventListener("abort", cancel);
        unsubscribe();
        unwarn();
        await orchestrator?.shutdown();
      }
    },
  };
}
