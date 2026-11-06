import type { StopReason, ToolKind } from "../agents/index.js";
import type { PermissionRule, PromptTemplates } from "../contracts/index.js";
import type { RunStatus } from "./record-schemas.js";

export type { PermissionRule } from "../contracts/index.js";
export type { RunEvent, RunEventBody, RunRecord, RunStatus } from "./record-schemas.js";
export type { StopReason, ToolKind };

export type FinalRunStatus = Extract<
  RunStatus,
  "finished" | "failed" | "cancelled" | "timed_out" | "interrupted"
>;

export const ACTIVE_STATUSES: ReadonlySet<RunStatus> = new Set([
  "queued",
  "running",
  "waiting",
  "idle",
]);

export type Mode = "interactive" | "headless";

export type PermissionPolicy = Partial<Record<ToolKind, PermissionRule>> & {
  default: PermissionRule;
};

export type RecoveryResult = { type: "restored" } | { type: "handoff-required"; reason: string };

export interface AgentConfig {
  command: readonly [string, ...string[]];
}

export interface Config {
  defaultAgent: string;
  maxParallel: number;
  turnTimeout: string;
  worktreeDir: string | null;
  permissions: PermissionPolicy;
  agents: Readonly<Record<string, AgentConfig>>;
  /** Built-in prompt templates with the user's overrides applied. */
  prompts: Readonly<PromptTemplates>;
}

/** A permission request waiting for the user (desktop app only). */
export interface PendingPermission {
  id: string;
  runId: string;
  toolCallId: string;
  title: string;
  kind: ToolKind;
}

/** What the CLI renders for one run. */
export interface RunView {
  id: string;
  agent: string;
  status: RunStatus;
  reason?: string;
  turns: number;
  branch: string | null;
  worktree: string;
  lastStopReason?: StopReason;
  pending: readonly PendingPermission[];
  /** The run is ending and its agent is being stopped. */
  stopping: boolean;
}

export interface RunResult {
  id: string;
  agent: string;
  status: FinalRunStatus;
  reason: string | null;
  branch: string | null;
  worktree: string;
  /** Null when the worktree was never created or could not be read. */
  changedFiles: number | null;
}

/** Invalid usage or configuration (exit code 2). */
export class UsageError extends Error {
  override name = "UsageError";
}

/** A command refused to act, for example on an active run (exit code 1). */
export class RefusedError extends Error {
  override name = "RefusedError";
}
