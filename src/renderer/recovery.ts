import type { DesktopRun } from "../bridge/index.js";
import type { RunStatus } from "../core/index.js";

const recoverableStatuses = new Set<RunStatus>([
  "finished",
  "failed",
  "cancelled",
  "timed_out",
  "interrupted",
]);

export function canRecoverRun(status: RunStatus): boolean {
  return recoverableStatuses.has(status);
}

/** Why a chat cannot be resumed by sending a message, or undefined when it can. */
export function continueBlocker(run: DesktopRun): string | undefined {
  if (!canRecoverRun(run.view?.status ?? run.record.status)) return "This run cannot be resumed";
  if (run.record.base === null)
    return "No baseline was captured for this run. Start a new isolated worker.";
  if (run.record.discardedAt) return "This run's worktree was deleted";
  if (run.agentAlive) return "Stop the leftover agent to continue this chat";
  return undefined;
}
