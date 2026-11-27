import { z } from "zod";

// Keep code generation disabled when this module is imported directly.
z.config({ jitless: true });

export const HEARTBEAT_STATE_FORMAT = 2;
export const HEARTBEAT_HISTORY_LIMIT = 50;
export const HEARTBEAT_FINDING_LIMIT = 32;
export const HEARTBEAT_STATE_MAX_BYTES = 512 * 1024;
export const HEARTBEAT_INTERVAL_OPTIONS = [5, 15, 30, 60] as const;

export const HEARTBEAT_AREAS = [
  "health",
  "disk",
  "scheduler",
  "runs",
  "sidecars",
  "storage",
  "worktrees",
] as const;
export type HeartbeatArea = (typeof HEARTBEAT_AREAS)[number];

export const HEARTBEAT_AREA_LABELS: Readonly<Record<HeartbeatArea, string>> = {
  health: "Health",
  disk: "Disk",
  scheduler: "Scheduler",
  runs: "Runs",
  sidecars: "Sidecars",
  storage: "Temp files",
  worktrees: "Worktrees",
};

export const HEARTBEAT_BEHAVIORS = ["check", "auto_fix", "auto_clean"] as const;
export type HeartbeatBehavior = (typeof HEARTBEAT_BEHAVIORS)[number];

export const HEARTBEAT_BEHAVIOR_LABELS: Readonly<Record<HeartbeatBehavior, string>> = {
  check: "Checks only",
  auto_fix: "Fixes automatically",
  auto_clean: "Cleans automatically",
};

export const HEARTBEAT_SOURCE_LABELS: Readonly<Record<"manual" | "schedule", string>> = {
  manual: "Human-Triggered",
  schedule: "Scheduler-Triggered",
};

const HEARTBEAT_ACTION_IDS = [
  "passive-health-sweep",
  "disk-pressure-guard",
  "scheduler-drift-audit",
  "dead-owner-reconcile",
  "stuck-execution-watchdog",
  "runtime-self-heal",
  "temp-and-git-hygiene",
  "clean-worktree-prune",
] as const;
export type HeartbeatActionId = (typeof HEARTBEAT_ACTION_IDS)[number];

export interface HeartbeatActionDefinition {
  id: HeartbeatActionId;
  title: string;
  area: HeartbeatArea;
  behavior: HeartbeatBehavior;
  description: string;
  timeoutMs: number;
}

export const HEARTBEAT_ACTIONS: readonly HeartbeatActionDefinition[] = [
  {
    id: "passive-health-sweep",
    title: "Passive health sweep",
    area: "health",
    behavior: "check",
    description:
      "Checks backend services, scheduler status, storage safety, memory, MCP, and quotas without live provider calls.",
    timeoutMs: 20_000,
  },
  {
    id: "disk-pressure-guard",
    title: "Disk pressure guard",
    area: "disk",
    behavior: "auto_fix",
    description:
      "Monitors free space across state, temp, and repository volumes, pausing future schedules below 2 GiB and resuming above 4 GiB.",
    timeoutMs: 10_000,
  },
  {
    id: "scheduler-drift-audit",
    title: "Scheduler drift audit",
    area: "scheduler",
    behavior: "check",
    description:
      "Checks enabled Scheduled Jobs for repository, branch, or provider drift and warns before execution history nears the 5,000 cap.",
    timeoutMs: 15_000,
  },
  {
    id: "dead-owner-reconcile",
    title: "Dead-owner run reconciliation",
    area: "runs",
    behavior: "auto_fix",
    description:
      "Marks active runs whose owning process is verified gone as interrupted without replaying uncertain work.",
    timeoutMs: 15_000,
  },
  {
    id: "stuck-execution-watchdog",
    title: "Stuck run and orphan watchdog",
    area: "runs",
    behavior: "auto_fix",
    description:
      "Recovers wedged stopping runs, stops verified orphan agent processes, and clears verified leftover-agent blocks.",
    timeoutMs: 25_000,
  },
  {
    id: "runtime-self-heal",
    title: "Sidecar and Relay recovery",
    area: "sidecars",
    behavior: "auto_fix",
    description:
      "Retires unresponsive stateless sidecars under a restart cap and flags Relay connection issues.",
    timeoutMs: 15_000,
  },
  {
    id: "temp-and-git-hygiene",
    title: "Stale temporary file cleanup",
    area: "storage",
    behavior: "auto_clean",
    description:
      "Removes orphaned code60-index directories and stale private temp files older than one hour, and prunes dead Git worktree metadata.",
    timeoutMs: 20_000,
  },
  {
    id: "clean-worktree-prune",
    title: "Clean worktree cleanup",
    area: "worktrees",
    behavior: "auto_clean",
    description:
      "Removes terminal zero-diff or discarded code60/* worktrees past the age limit while preserving every worktree with edits.",
    timeoutMs: 30_000,
  },
] as const;

const HEARTBEAT_ACTION_STATUSES = [
  "pending",
  "running",
  "passed",
  "remediated",
  "warning",
  "escalated",
  "skipped",
  "failed",
] as const;
export type HeartbeatActionStatus = (typeof HEARTBEAT_ACTION_STATUSES)[number];

export const HEARTBEAT_ACTION_STATUS_LABELS: Readonly<Record<HeartbeatActionStatus, string>> = {
  pending: "Pending",
  running: "Running",
  passed: "OK",
  remediated: "Fixed automatically",
  warning: "Needs attention",
  escalated: "Needs attention",
  skipped: "Skipped",
  failed: "Failed",
};

const HEARTBEAT_RUN_STATUSES = [
  "running",
  "healthy",
  "remediated",
  "warning",
  "escalated",
  "failed",
  "cancelled",
] as const;
export type HeartbeatRunStatus = (typeof HEARTBEAT_RUN_STATUSES)[number];

export const HEARTBEAT_RUN_STATUS_LABELS: Readonly<Record<HeartbeatRunStatus, string>> = {
  running: "Running",
  healthy: "Nothing needs attention",
  remediated: "Handled automatically",
  warning: "Needs attention",
  escalated: "Needs attention",
  failed: "Check failed",
  cancelled: "Cancelled",
};

const HEARTBEAT_FINDING_CODES = [
  "health_warning",
  "health_error",
  "low_disk_warning",
  "low_disk_paused",
  "low_disk_resumed",
  "execution_capacity_warning",
  "job_repository_drift",
  "job_base_missing",
  "job_provider_drift",
  "dead_owner_reconciled",
  "dead_owner_candidate",
  "wedged_run_recovered",
  "wedged_run_escalated",
  "orphan_agent_stopped",
  "orphan_agent_unverified",
  "leftover_block_cleared",
  "leftover_block_escalated",
  "sidecar_restarted",
  "sidecar_restart_capped",
  "relay_reconnected",
  "relay_reconnect_failed",
  "temp_artifacts_cleaned",
  "git_worktree_metadata_pruned",
  "clean_worktree_pruned",
  "clean_worktree_candidate",
  "dirty_worktree_retained",
  "unsafe_storage",
  "action_timeout",
  "action_failed",
] as const;
export type HeartbeatFindingCode = (typeof HEARTBEAT_FINDING_CODES)[number];

const HEARTBEAT_FINDING_AUDIENCES = ["user", "audit"] as const;

const HEARTBEAT_REMEDIATIONS = [
  "none",
  "auto_reconciled",
  "auto_cleaned",
  "auto_healed",
  "user_action",
  "escalate",
] as const;

const HEARTBEAT_FINDING_SEVERITIES = ["info", "warning", "error"] as const;

const heartbeatDeepLinkSchema = z.strictObject({
  kind: z.enum(["page", "settings", "relay"]),
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
});
export type HeartbeatDeepLink = z.infer<typeof heartbeatDeepLinkSchema>;

const heartbeatFindingSchema = z.strictObject({
  code: z.enum(HEARTBEAT_FINDING_CODES),
  audience: z.enum(HEARTBEAT_FINDING_AUDIENCES),
  severity: z.enum(HEARTBEAT_FINDING_SEVERITIES),
  title: z.string().min(1).max(140),
  summary: z.string().min(1).max(300),
  howToFix: z.string().min(1).max(300).optional(),
  remediation: z.enum(HEARTBEAT_REMEDIATIONS),
  targetLabel: z.string().min(1).max(120).optional(),
  targetHash: z
    .string()
    .regex(/^[a-f0-9]{16}$/)
    .optional(),
  runId: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
    .optional(),
  count: z.number().int().min(0).optional(),
  deepLink: heartbeatDeepLinkSchema.optional(),
});
export type HeartbeatFinding = z.infer<typeof heartbeatFindingSchema>;

export interface HeartbeatAttentionItem {
  id: string;
  actionId: HeartbeatActionId;
  actionTitle: string;
  area: HeartbeatArea;
  finding: HeartbeatFinding;
}

const isoInstant = z.iso.datetime();

const heartbeatActionRecordSchema = z.strictObject({
  actionId: z.enum(HEARTBEAT_ACTION_IDS),
  title: z.string().min(1).max(120),
  area: z.enum(HEARTBEAT_AREAS),
  behavior: z.enum(HEARTBEAT_BEHAVIORS),
  status: z.enum(HEARTBEAT_ACTION_STATUSES),
  startedAt: isoInstant.nullable(),
  endedAt: isoInstant.nullable(),
  durationMs: z.number().int().min(0).nullable(),
  summary: z.string().max(400),
  remediatedCount: z.number().int().min(0),
  findings: z.array(heartbeatFindingSchema).max(HEARTBEAT_FINDING_LIMIT),
  deepLink: heartbeatDeepLinkSchema.optional(),
});
export type HeartbeatActionRecord = z.infer<typeof heartbeatActionRecordSchema>;

const heartbeatRunRecordSchema = z.strictObject({
  id: z.uuid(),
  sequence: z.number().int().positive(),
  trigger: z.enum(["schedule", "manual"]),
  mode: z.enum(["maintain", "inspect"]),
  status: z.enum(HEARTBEAT_RUN_STATUSES),
  startedAt: isoInstant,
  endedAt: isoInstant.nullable(),
  durationMs: z.number().int().min(0).nullable(),
  actions: z.array(heartbeatActionRecordSchema).max(HEARTBEAT_ACTION_IDS.length),
});
export type HeartbeatRunRecord = z.infer<typeof heartbeatRunRecordSchema>;

export const heartbeatPolicySchema = z.strictObject({
  enabled: z.boolean(),
  intervalMinutes: z.union([z.literal(5), z.literal(15), z.literal(30), z.literal(60)]),
  autoStopVerifiedOrphans: z.boolean(),
  autoClearVerifiedLeftoverBlock: z.boolean(),
  autoPruneCleanWorktrees: z.boolean(),
  cleanWorktreeMinAgeHours: z.number().int().min(1).max(720),
  autoHealSidecars: z.boolean(),
  lowDiskGuard: z.boolean(),
});
export type HeartbeatPolicy = z.infer<typeof heartbeatPolicySchema>;

export const DEFAULT_HEARTBEAT_POLICY: Readonly<HeartbeatPolicy> = {
  enabled: true,
  intervalMinutes: 15,
  autoStopVerifiedOrphans: true,
  autoClearVerifiedLeftoverBlock: true,
  autoPruneCleanWorktrees: true,
  cleanWorktreeMinAgeHours: 24,
  autoHealSidecars: true,
  lowDiskGuard: true,
};

export const heartbeatPersistedStateSchema = z.strictObject({
  format: z.literal(HEARTBEAT_STATE_FORMAT),
  revision: z.number().int().min(0),
  sequence: z.number().int().min(0),
  anchor: isoInstant,
  lowDiskPausedByHeartbeat: z.boolean(),
  policy: heartbeatPolicySchema,
  runs: z.array(heartbeatRunRecordSchema).max(HEARTBEAT_HISTORY_LIMIT),
});
export type HeartbeatPersistedState = z.infer<typeof heartbeatPersistedStateSchema>;

export interface HeartbeatSnapshot {
  revision: number;
  policy: HeartbeatPolicy;
  nextRunAt: string | null;
  running: boolean;
  lowDiskPausedByHeartbeat: boolean;
  currentRun: HeartbeatRunRecord | null;
  lastCompletedRun: HeartbeatRunRecord | null;
  recentRuns: HeartbeatRunRecord[];
  storageWarning: string | null;
}

export const heartbeatRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("snapshot") }),
  z.strictObject({
    action: z.literal("run"),
    mode: z.enum(["maintain", "inspect"]).default("maintain"),
  }),
  z.strictObject({ action: z.literal("cancel") }),
  z.strictObject({
    action: z.literal("updatePolicy"),
    policy: heartbeatPolicySchema,
  }),
]);
export type HeartbeatRequest = z.input<typeof heartbeatRequestSchema>;

/** Redacted, host-identifier-free summary safe for read-only orchestrator MCP awareness. */
export interface RedactedHeartbeatStatus {
  enabled: boolean;
  intervalMinutes: number;
  running: boolean;
  lowDiskPausedByHeartbeat: boolean;
  nextRunAt: string | null;
  lastRun: {
    trigger: "schedule" | "manual";
    mode: "maintain" | "inspect";
    status: HeartbeatRunStatus;
    startedAt: string;
    endedAt: string | null;
    durationMs: number | null;
    remediatedCount: number;
    warningCount: number;
    escalatedCount: number;
    findingCodes: HeartbeatFindingCode[];
  } | null;
}

export function rollupHeartbeatRunStatus(
  actions: readonly HeartbeatActionRecord[],
  cancelled = false,
): HeartbeatRunStatus {
  if (cancelled) return "cancelled";
  if (actions.some((action) => action.status === "running")) return "running";
  if (actions.some((action) => action.status === "failed")) return "failed";
  if (actions.some((action) => action.status === "escalated")) return "escalated";
  if (actions.some((action) => action.status === "warning")) return "warning";
  if (actions.some((action) => action.status === "remediated")) return "remediated";
  return "healthy";
}

export function collectHeartbeatAttentionItems(
  run: HeartbeatRunRecord | null | undefined,
): HeartbeatAttentionItem[] {
  if (!run) return [];
  const items: HeartbeatAttentionItem[] = [];
  for (const action of run.actions) {
    for (const finding of action.findings) {
      if (finding.audience !== "user") continue;
      items.push({
        id: `${action.actionId}:${finding.code}:${finding.runId ?? finding.targetHash ?? finding.title}`,
        actionId: action.actionId,
        actionTitle: action.title,
        area: action.area,
        finding,
      });
    }
  }
  const rank = { error: 0, warning: 1, info: 2 } as const;
  return items.sort((a, b) => rank[a.finding.severity] - rank[b.finding.severity]);
}

export function formatHeartbeatDuration(durationMs: number | null | undefined): string {
  if (durationMs === null || durationMs === undefined || !Number.isFinite(durationMs)) return "—";
  const safe = Math.max(0, Math.round(durationMs));
  if (safe < 1000) return `${safe} ms`;
  if (safe < 60_000) return `${(safe / 1000).toFixed(safe < 10_000 ? 2 : 1)} s`;
  const minutes = Math.floor(safe / 60_000);
  const seconds = Math.round((safe % 60_000) / 1000);
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}
