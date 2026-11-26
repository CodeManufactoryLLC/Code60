import { createHash, randomUUID } from "node:crypto";
import { statfs } from "node:fs/promises";
import { type DesktopWorkflows, WorkflowCheckoutBusyError } from "../application/index.js";
import {
  type ActionExecutionContext,
  type ActionExecutionOutcome,
  type ActionHandler,
  AutomationError,
  ExecutionRefused,
  repositoryIdentity,
  verifyRepository,
} from "../automation/index.js";
import {
  type Automation,
  type AutomationAction,
  type AutomationActionDraft,
  DEFAULT_WORKFLOW_LANE_LIMIT,
  type Execution,
  type ScheduledWorkflowStatus,
  type WorkflowSnapshot,
} from "../contracts/index.js";
import { type AgentSpec, type CoreDeps, WorkflowProviderError } from "../core/index.js";

type WorkflowAction = Extract<AutomationAction, { type: "workflow" }>;
type WorkflowActionDraft = Extract<AutomationActionDraft, { type: "workflow" }>;

const TERMINAL_STATUSES = new Set<WorkflowSnapshot["status"]>(["completed", "failed", "cancelled"]);

function commandHash(command: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(command)).digest("hex");
}

function mapTerminalOutcome(
  snapshot: WorkflowSnapshot,
  abortedByUser: boolean,
): ActionExecutionOutcome {
  const status =
    snapshot.status === "completed"
      ? ("finished" as const)
      : snapshot.status === "cancelled"
        ? ("cancelled" as const)
        : ("failed" as const);
  const reason =
    status === "finished"
      ? null
      : status === "cancelled"
        ? abortedByUser
          ? ("cancelled_by_user" as const)
          : ("cancelled_by_user" as const)
        : ("workflow_failed" as const);
  return {
    status,
    reason,
    artifact: (current) =>
      current.type === "workflow"
        ? {
            ...current,
            workflowRunId: snapshot.runId,
            workflowStatus: snapshot.status,
            tasksCompleted: snapshot.accepted.length,
            tasksTotal: snapshot.tasks.length,
          }
        : current,
  };
}

function workflowArtifactUpdater(snapshot: WorkflowSnapshot) {
  return (current: Execution["artifact"]) =>
    current.type === "workflow"
      ? {
          ...current,
          workflowRunId: snapshot.runId,
          workflowStatus: snapshot.status as ScheduledWorkflowStatus,
          tasksCompleted: snapshot.accepted.length,
          tasksTotal: snapshot.tasks.length,
        }
      : current;
}

export interface WorkflowActionHandlerOptions {
  deps: CoreDeps;
  workflows: DesktopWorkflows;
  resolveProvider: (providerId: string, cwd: string) => AgentSpec;
  ready?: Promise<void>;
  laneLimit?: number;
}

/** Gateway-composed workflow action handler delegating execution to DesktopWorkflows. */
export function createWorkflowActionHandler(
  options: WorkflowActionHandlerOptions,
): ActionHandler<"workflow"> {
  const { deps, workflows, resolveProvider, laneLimit = DEFAULT_WORKFLOW_LANE_LIMIT } = options;
  const ready = options.ready ?? Promise.resolve();

  const awaitWorkflow = async (
    workflowId: string,
    initialSnapshot: WorkflowSnapshot | undefined,
    ctx: ActionExecutionContext,
  ): Promise<ActionExecutionOutcome> => {
    if (initialSnapshot && TERMINAL_STATUSES.has(initialSnapshot.status)) {
      return mapTerminalOutcome(initialSnapshot, false);
    }

    return new Promise<ActionExecutionOutcome>((resolve) => {
      let settled = false;
      let lastStatus: string | undefined = initialSnapshot?.status;
      let lastCompleted = initialSnapshot?.accepted.length ?? 0;
      let unwatch = () => {};

      const finish = (outcome: ActionExecutionOutcome) => {
        if (settled) return;
        settled = true;
        unwatch();
        ctx.signal.removeEventListener("abort", onAbort);
        resolve(outcome);
      };

      const handleSnapshot = (snapshot: WorkflowSnapshot) => {
        if (settled) return;
        if (TERMINAL_STATUSES.has(snapshot.status)) {
          const abortedByUser = ctx.abortKind() === "user";
          void workflows
            .readScheduledState(workflowId)
            .catch(() => null)
            .finally(() => {
              finish(mapTerminalOutcome(snapshot, abortedByUser));
            });
          return;
        }
        if (snapshot.status !== lastStatus || snapshot.accepted.length !== lastCompleted) {
          lastStatus = snapshot.status;
          lastCompleted = snapshot.accepted.length;
          void ctx
            .updateArtifact(workflowArtifactUpdater(snapshot))
            .then(() => ctx.notify())
            .catch(() => {});
        }
      };

      const onAbort = () => {
        if (settled) return;
        if (ctx.abortKind() === "shutdown") {
          finish({
            status: "cancelled",
            reason: "service_stopped",
            detachedOnShutdown: true,
          });
          return;
        }
        void workflows
          .cancelScheduled(workflowId)
          .then((record) => {
            if (record?.snapshot && TERMINAL_STATUSES.has(record.snapshot.status)) {
              finish(mapTerminalOutcome(record.snapshot, true));
            } else {
              finish({
                status: "cancelled",
                reason: "cancelled_by_user",
                artifact: (current) =>
                  current.type === "workflow"
                    ? { ...current, workflowStatus: "cancelled" }
                    : current,
              });
            }
          })
          .catch(() => {
            finish({
              status: "cancelled",
              reason: "cancelled_by_user",
            });
          });
      };

      unwatch = workflows.observeWorkflow(workflowId, handleSnapshot);
      ctx.signal.addEventListener("abort", onAbort, { once: true });
      if (ctx.signal.aborted) {
        onAbort();
        return;
      }

      // Sync once after subscribing so transitions before subscribe cannot be missed.
      void ready
        .then(() => workflows.readScheduledState(workflowId))
        .then((record) => {
          if (settled) return;
          if (!record) {
            finish({ status: "failed", reason: "workflow_failed" });
            return;
          }
          if (record.state === "preparation_failed") {
            finish({ status: "failed", reason: "preparation_failed" });
            return;
          }
          if (record.snapshot) handleSnapshot(record.snapshot);
        })
        .catch(() => {});
    });
  };

  return {
    type: "workflow",
    concurrency(action) {
      return {
        lanes: [{ name: "workflow", limit: laneLimit }],
        resources: [`repo:${action.repository.dev}:${action.repository.ino}`],
      };
    },
    async validate(draft: WorkflowActionDraft): Promise<WorkflowAction> {
      const repository = await repositoryIdentity(draft.repository);
      const repo = await deps.git.repoInfo(repository.path);
      if (!repo || repo.topLevel !== repository.path)
        throw new AutomationError(
          "refused",
          "Choose a Git repository root with a local base branch.",
        );
      await deps.git.resolveCommit(repository.path, `refs/heads/${draft.baseBranch}`);
      let spec: AgentSpec;
      try {
        spec = resolveProvider(draft.provider, repository.path);
      } catch (error) {
        throw new AutomationError(
          "refused",
          error instanceof Error ? error.message : "Choose an enabled, verified provider.",
        );
      }
      const { repository: _repository, ...fields } = draft;
      return {
        ...fields,
        repository,
        providerHash: commandHash(spec.command),
      };
    },
    summarize(action) {
      return {
        agent: action.provider,
        repository: { dev: action.repository.dev, ino: action.repository.ino },
        taskCount: action.tasks.length,
      };
    },
    prepareClaim(action, skipped) {
      return {
        type: "workflow",
        repository: { ...action.repository },
        evidence: null,
        workflowId: skipped ? null : randomUUID(),
        workflowRunId: null,
        workflowStatus: skipped ? null : "preparing",
        tasksCompleted: 0,
        tasksTotal: action.tasks.length,
      };
    },
    async canDispatch(action) {
      return !(await workflows.hasActiveWorkflowForRepository(action.repository.path));
    },
    async inspect() {
      // DesktopWorkflows + WorkflowEngine own workflow lifecycle and uninstall fencing.
      return "gone";
    },
    async reconcileOnRestart(execution) {
      if (execution.artifact.type !== "workflow" || !execution.artifact.workflowId) {
        return { kind: "interrupted", reason: "service_restarted" };
      }
      const workflowId = execution.artifact.workflowId;
      const record = await workflows.readScheduledState(workflowId, { live: false });
      if (!record) return { kind: "interrupted", reason: "service_restarted" };
      if (record.state === "preparation_failed") {
        return {
          kind: "settled",
          outcome: {
            status: "failed",
            reason: "preparation_failed",
            artifact: (current) =>
              current.type === "workflow" ? { ...current, workflowStatus: "failed" } : current,
          },
        };
      }
      if (!record.snapshot) {
        return { kind: "interrupted", reason: "service_restarted" };
      }
      if (TERMINAL_STATUSES.has(record.snapshot.status)) {
        return { kind: "settled", outcome: mapTerminalOutcome(record.snapshot, false) };
      }
      const repo = execution.artifact.repository;
      return {
        kind: "reattach",
        concurrency: {
          lanes: [{ name: "workflow", limit: laneLimit }],
          resources: [`repo:${repo.dev}:${repo.ino}`],
        },
        resume: (ctx) => awaitWorkflow(workflowId, record.snapshot, ctx),
      };
    },
    async readEvidence(execution, kind) {
      if (execution.artifact.type !== "workflow" || !execution.artifact.workflowId)
        throw new AutomationError("not_found", "This occurrence has no workflow run.");
      if (kind === "transcript")
        throw new AutomationError("not_found", "Open this run in Workflows to view its activity.");
      const diff = await workflows.readScheduledDiff(execution.artifact.workflowId);
      return {
        executionId: execution.id,
        runId: diff.runId,
        text: diff.text,
        truncated: diff.truncated,
      };
    },
    async execute(
      automation: Automation,
      execution: Execution,
      ctx,
    ): Promise<ActionExecutionOutcome> {
      if (automation.action.type !== "workflow" || execution.artifact.type !== "workflow")
        throw new Error("Workflow handler received non-workflow execution");
      const action = automation.action;
      const workflowId = execution.artifact.workflowId;
      if (!workflowId) throw new Error("Missing preclaimed workflow ID");

      await ready;
      await verifyRepository(action.repository);
      const disk = await statfs(action.repository.path, { bigint: true });
      if (disk.bavail * disk.bsize < 2n * 1024n * 1024n * 1024n)
        throw new ExecutionRefused("low_disk");
      try {
        await deps.git.resolveCommit(action.repository.path, `refs/heads/${action.baseBranch}`);
      } catch {
        throw new ExecutionRefused("base_missing");
      }
      let spec: AgentSpec;
      try {
        spec = resolveProvider(action.provider, action.repository.path);
      } catch (error) {
        if (error instanceof WorkflowProviderError) throw new ExecutionRefused("provider_missing");
        throw new ExecutionRefused("provider_missing");
      }
      if (commandHash(spec.command) !== action.providerHash)
        throw new ExecutionRefused("provider_changed");

      if (ctx.signal.aborted) {
        return {
          status: "cancelled",
          reason: ctx.abortKind() === "shutdown" ? "service_stopped" : "cancelled_by_user",
        };
      }

      let record: Awaited<ReturnType<DesktopWorkflows["startScheduled"]>>;
      try {
        record = await workflows.startScheduled({
          workflowId,
          name: automation.name,
          repository: action.repository.path,
          baseBranch: action.baseBranch,
          provider: action.provider,
          tasks: action.tasks,
          repairs: action.repairs,
          retries: action.retries,
          autoApprove: action.autoApprove,
          origin: {
            kind: "scheduled",
            automationId: automation.id,
            automationName: automation.name,
            executionId: execution.id,
            scheduledFor: execution.scheduledFor,
          },
        });
      } catch (error) {
        if (error instanceof WorkflowCheckoutBusyError) throw new ExecutionRefused("busy");
        if (error instanceof WorkflowProviderError) throw new ExecutionRefused("provider_missing");
        throw new ExecutionRefused("preparation_failed");
      }

      const worktreePin = await repositoryIdentity(record.worktree).catch(() => null);
      await ctx.updateArtifact((current) =>
        current.type === "workflow"
          ? {
              ...current,
              evidence: worktreePin
                ? { worktree: worktreePin, base: record.baseline, branch: record.branch }
                : null,
              workflowRunId: record.snapshot?.runId ?? null,
              workflowStatus: (record.snapshot?.status ?? "running") as ScheduledWorkflowStatus,
              tasksCompleted: record.snapshot?.accepted.length ?? 0,
              tasksTotal: action.tasks.length,
            }
          : current,
      );
      ctx.notify();

      return awaitWorkflow(workflowId, record.snapshot, ctx);
    },
  };
}
