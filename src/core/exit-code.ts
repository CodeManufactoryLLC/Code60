import type { RunStatus } from "./types.js";

export const ExitCode = {
  ok: 0,
  failed: 1,
  usage: 2,
  timedOut: 124,
  cancelled: 130,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

export interface ExitContext {
  /** The process received SIGINT or SIGTERM. */
  signal?: boolean;
  usageError?: boolean;
}

/** Applies the precedence in ARCHITECTURE.md: 2, then 130, then 124, then 1, then 0. */
export function exitCodeFor(
  statuses: readonly RunStatus[],
  context: ExitContext = {},
): ExitCodeValue {
  if (context.usageError) return ExitCode.usage;
  const active = statuses.find(
    (s) => s === "queued" || s === "running" || s === "waiting" || s === "idle",
  );
  if (active !== undefined) {
    throw new Error(`exitCodeFor called with an active run status: ${active}`);
  }
  if (context.signal || statuses.includes("cancelled")) return ExitCode.cancelled;
  if (statuses.includes("timed_out")) return ExitCode.timedOut;
  if (statuses.includes("failed") || statuses.includes("interrupted")) return ExitCode.failed;
  return ExitCode.ok;
}
