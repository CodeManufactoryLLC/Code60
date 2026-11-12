import type { DesktopRun } from "../bridge/index.js";
import type { RunStatus } from "../core/index.js";
import type { IconName } from "./icons.js";
export interface SessionRow {
  id: string;
  shortId: string;
  agent: string;
  status: RunStatus;
  statusLabel: string;
  turns: number;
  approvals: number;
  branch: string | null;
  pid: number | null;
  startedAt: string;
}

/** Table rows for the sessions grid, newest first; live run views take priority over records. */
export function sessionRows(runs: readonly DesktopRun[]): SessionRow[] {
  return runs
    .map((run) => {
      const status = run.view?.status ?? run.record.status;
      return {
        id: run.record.id,
        shortId: run.record.id.slice(-6),
        agent: run.record.agent,
        status,
        statusLabel: `${statusSpec[status].label}${run.record.discardedAt ? " / discarded" : ""}`,
        turns: run.view?.turns ?? run.record.turns,
        approvals: run.view?.pending.length ?? 0,
        branch: run.record.branch,
        pid: run.record.agentPid ?? null,
        startedAt: run.record.startedAt,
      };
    })
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
/**
 * How each run state is written in the interface. Every state has a label and an icon; routine
 * states stay quiet, approval is inverted, and abnormal stops carry a warning and a left rule.
 */
export const statusSpec: Record<
  RunStatus,
  { label: string; icon: IconName; emphasis: "quiet" | "active" | "decision" | "abnormal" }
> = {
  queued: { label: "Queued", icon: "time", emphasis: "quiet" },
  running: { label: "Working", icon: "play--filled", emphasis: "active" },
  waiting: { label: "Needs approval", icon: "pause", emphasis: "decision" },
  idle: { label: "Ready", icon: "chat", emphasis: "active" },
  finished: { label: "Finished", icon: "checkmark", emphasis: "quiet" },
  failed: { label: "Failed", icon: "warning--alt--filled", emphasis: "abnormal" },
  cancelled: { label: "Cancelled", icon: "stop", emphasis: "quiet" },
  timed_out: { label: "Timed out", icon: "warning--alt--filled", emphasis: "abnormal" },
  interrupted: { label: "Interrupted", icon: "warning--alt--filled", emphasis: "abnormal" },
};
