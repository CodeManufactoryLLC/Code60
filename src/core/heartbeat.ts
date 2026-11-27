import { createHash } from "node:crypto";
import { lstat, readdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  emitLog,
  HEARTBEAT_ACTIONS,
  HEARTBEAT_FINDING_LIMIT,
  type HeartbeatActionDefinition,
  type HeartbeatActionId,
  type HeartbeatActionRecord,
  type HeartbeatActionStatus,
  type HeartbeatDeepLink,
  type HeartbeatFinding,
  type HeartbeatPolicy,
  type HeartbeatRunRecord,
  type LogSink,
  rollupHeartbeatRunStatus,
} from "../contracts/index.js";
import { diagnosticMessage, samePath } from "../platform/index.js";
import { markInterrupted, stopRun } from "./commands.js";
import type { CoreDeps } from "./index.js";
import { commandDeps, openWorkspace } from "./index.js";
import { recordedAgentAlive } from "./processes.js";
import { ACTIVE_STATUSES, RefusedError, type RunRecord } from "./types.js";

const OWN_BRANCH_RE = /^code60\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const STALE_TEMP_AGE_MS = 60 * 60_000;
const TEMP_INDEX_PREFIX = "code60-index-";
const PRIVATE_TMP_SUFFIX = ".tmp";
const HOUR_MS = 60 * 60_000;

export type HeartbeatMode = "maintain" | "inspect";

export function heartbeatTargetHash(path: string): string {
  return createHash("sha256").update(path).digest("hex").slice(0, 16);
}

export interface HeartbeatActionOutcome {
  status: Exclude<HeartbeatActionStatus, "pending" | "running">;
  summary: string;
  remediatedCount?: number;
  findings?: HeartbeatFinding[];
  deepLink?: HeartbeatDeepLink;
}

export interface HeartbeatActionRunner {
  definition: HeartbeatActionDefinition;
  execute(signal: AbortSignal): Promise<HeartbeatActionOutcome>;
}

export interface TempCleanupFs {
  readdir(path: string): Promise<string[]>;
  lstat(path: string): Promise<{
    isDirectory(): boolean;
    isFile(): boolean;
    isSymbolicLink(): boolean;
    mtimeMs: number;
  }>;
  rm(path: string, options: { recursive?: boolean; force?: boolean }): Promise<void>;
}

const defaultTempCleanupFs: TempCleanupFs = {
  readdir: (path) => readdir(path),
  lstat: (path) => lstat(path),
  rm: (path, options) => rm(path, options),
};

export interface WorkspaceReconcileResult {
  reconciledCount: number;
  candidateCount: number;
  findings: HeartbeatFinding[];
}

/**
 * Reconciles active runs whose owning process is verified gone.
 * In `inspect` mode, reports candidates without mutating run records.
 */
export async function reconcileWorkspaceRuns(
  deps: CoreDeps,
  repoDir: string,
  env: Readonly<Record<string, string | undefined>>,
  mode: HeartbeatMode,
): Promise<WorkspaceReconcileResult> {
  const workspace = await openWorkspace(deps, repoDir, env);
  const records = await workspace.store.list();
  const label = basename(repoDir) || "workspace";
  const targetHash = heartbeatTargetHash(repoDir);

  if (mode === "inspect") {
    let candidates = 0;
    for (const record of records) {
      if (!ACTIVE_STATUSES.has(record.status)) continue;
      const alive = deps.processes.isAlive(record.ownerPid);
      if (!alive) candidates++;
    }
    return {
      reconciledCount: 0,
      candidateCount: candidates,
      findings:
        candidates > 0
          ? [
              {
                code: "dead_owner_candidate",
                audience: "user",
                severity: "warning",
                title: `Stale active run${candidates === 1 ? "" : "s"} in ${label}`,
                summary: `${candidates} active run${candidates === 1 ? "" : "s"} have a dead owning process.`,
                howToFix: "Run a live heartbeat sweep to mark dead-owner runs as interrupted.",
                remediation: "user_action",
                targetLabel: label,
                targetHash,
                count: candidates,
              },
            ]
          : [],
    };
  }

  const changed = await markInterrupted(commandDeps(deps, workspace), records);
  return {
    reconciledCount: changed,
    candidateCount: changed,
    findings:
      changed > 0
        ? [
            {
              code: "dead_owner_reconciled",
              audience: "audit",
              severity: "info",
              title: `Reconciled dead-owner run${changed === 1 ? "" : "s"} in ${label}`,
              summary: `Marked ${changed} dead-owner run${changed === 1 ? "" : "s"} as interrupted in ${label}.`,
              remediation: "auto_reconciled",
              targetLabel: label,
              targetHash,
              count: changed,
            },
          ]
        : [],
  };
}

export interface OrphanCleanupResult {
  stoppedCount: number;
  escalatedCount: number;
  findings: HeartbeatFinding[];
}

/**
 * Finds ended runs whose recorded agent process is still alive.
 * In `maintain` mode with `autoStopVerifiedOrphans`, invokes `stopRun` which verifies
 * exact command-line / native ownership before signalling and refuses unverified PIDs.
 */
export async function checkAndCleanOrphans(
  deps: CoreDeps,
  repoDir: string,
  env: Readonly<Record<string, string | undefined>>,
  options: {
    mode: HeartbeatMode;
    autoStopVerifiedOrphans: boolean;
  },
): Promise<OrphanCleanupResult> {
  const workspace = await openWorkspace(deps, repoDir, env);
  const records = await workspace.store.list();
  const label = basename(repoDir) || "workspace";
  const targetHash = heartbeatTargetHash(repoDir);
  const cmdDeps = commandDeps(deps, workspace);
  const findings: HeartbeatFinding[] = [];
  let stoppedCount = 0;
  let escalatedCount = 0;

  for (const record of records) {
    if (ACTIVE_STATUSES.has(record.status)) continue;
    if (record.agentPid === undefined) continue;
    const alive = await recordedAgentAlive(deps.processes, record);
    if (!alive) continue;

    if (options.mode === "maintain" && options.autoStopVerifiedOrphans) {
      try {
        const result = await stopRun(cmdDeps, record.id);
        if (result.stopped) {
          stoppedCount++;
          findings.push({
            code: "orphan_agent_stopped",
            audience: "audit",
            severity: "info",
            title: `Stopped orphan agent (${record.id})`,
            summary: `Stopped verified orphan agent process for ended run ${record.id} in ${label}.`,
            remediation: "auto_reconciled",
            targetLabel: label,
            targetHash,
            runId: record.id,
          });
          continue;
        }
      } catch (error) {
        escalatedCount++;
        const reason =
          error instanceof RefusedError
            ? "Process ownership could not be verified; left untouched."
            : diagnosticMessage(error, 160);
        findings.push({
          code: "orphan_agent_unverified",
          audience: "user",
          severity: "error",
          title: `Unverified orphan process for run ${record.id}`,
          summary: `Orphan agent in ${label} could not be stopped automatically. ${reason}`,
          howToFix:
            "Inspect the process in System Manager or your OS process list and stop it manually if it still belongs to Code60.",
          remediation: "escalate",
          targetLabel: label,
          targetHash,
          runId: record.id,
          deepLink: { kind: "page", id: "system-manager", label: "Open System Manager" },
        });
        continue;
      }
    }

    escalatedCount++;
    findings.push({
      code: "orphan_agent_unverified",
      audience: "user",
      severity: "warning",
      title: `Orphan agent process still running (${record.id})`,
      summary: `Ended run ${record.id} in ${label} still has a live agent process.`,
      howToFix:
        options.mode === "inspect"
          ? "Run a live heartbeat sweep or stop the process from System Manager."
          : "Enable automatic orphan cleanup in Policy or stop the process in System Manager.",
      remediation: "user_action",
      targetLabel: label,
      targetHash,
      runId: record.id,
      deepLink: { kind: "page", id: "system-manager", label: "Open System Manager" },
    });
  }

  return { stoppedCount, escalatedCount, findings };
}

export interface TempArtifactsCleanupResult {
  cleanedCount: number;
  candidateCount: number;
  findings: HeartbeatFinding[];
}

/**
 * Cleans orphaned `code60-index-*` temporary directories in `tempDir` and stale
 * `*.tmp` staging files in Code60 private state directories older than 1 hour.
 * Never follows symlinks or deletes lock files.
 */
export async function cleanStaleTempArtifacts(
  tempDir: string,
  privateStateDirs: readonly string[],
  nowMs: number,
  mode: HeartbeatMode,
  fsOps: TempCleanupFs = defaultTempCleanupFs,
): Promise<TempArtifactsCleanupResult> {
  let cleanedCount = 0;
  let candidateCount = 0;

  const tempEntries = await fsOps.readdir(tempDir).catch(() => []);
  for (const name of tempEntries) {
    if (!name.startsWith(TEMP_INDEX_PREFIX)) continue;
    const full = join(tempDir, name);
    const info = await fsOps.lstat(full).catch(() => null);
    if (!info || info.isSymbolicLink() || !info.isDirectory()) continue;
    if (nowMs - info.mtimeMs < STALE_TEMP_AGE_MS) continue;
    candidateCount++;
    if (mode === "maintain") {
      await fsOps.rm(full, { recursive: true, force: true }).catch(() => {});
      cleanedCount++;
    }
  }

  for (const dir of privateStateDirs) {
    const entries = await fsOps.readdir(dir).catch(() => []);
    for (const name of entries) {
      if (!name.endsWith(PRIVATE_TMP_SUFFIX) || name.startsWith(".writer")) continue;
      const full = join(dir, name);
      const info = await fsOps.lstat(full).catch(() => null);
      if (!info || info.isSymbolicLink() || !info.isFile()) continue;
      if (nowMs - info.mtimeMs < STALE_TEMP_AGE_MS) continue;
      candidateCount++;
      if (mode === "maintain") {
        await fsOps.rm(full, { force: true }).catch(() => {});
        cleanedCount++;
      }
    }
  }

  const findings: HeartbeatFinding[] = [];
  if (mode === "maintain" && cleanedCount > 0) {
    findings.push({
      code: "temp_artifacts_cleaned",
      audience: "audit",
      severity: "info",
      title: "Cleaned stale temporary files",
      summary: `Removed ${cleanedCount} stale temporary artifact${cleanedCount === 1 ? "" : "s"} older than one hour.`,
      remediation: "auto_cleaned",
      count: cleanedCount,
    });
  } else if (mode === "inspect" && candidateCount > 0) {
    findings.push({
      code: "temp_artifacts_cleaned",
      audience: "audit",
      severity: "info",
      title: "Stale temporary files ready to clean",
      summary: `${candidateCount} stale temporary artifact${candidateCount === 1 ? "" : "s"} eligible for removal.`,
      remediation: "none",
      count: candidateCount,
    });
  }

  return { cleanedCount, candidateCount, findings };
}

export interface WorktreePruneOptions {
  mode: HeartbeatMode;
  autoPruneCleanWorktrees: boolean;
  minAgeHours: number;
  pinnedWorktrees?: ReadonlySet<string>;
  pinnedRunIds?: ReadonlySet<string>;
  log?: LogSink;
  operationId?: string;
}

export interface WorktreePruneResult {
  prunedCount: number;
  cleanCandidateCount: number;
  dirtyRetainedCount: number;
  findings: HeartbeatFinding[];
}

function recordTerminalMs(record: RunRecord): number | null {
  const iso = record.endedAt ?? record.discardedAt;
  if (!iso) return null;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : null;
}

async function isPinnedWorktree(
  worktreePath: string,
  pinnedWorktrees: ReadonlySet<string> | undefined,
): Promise<boolean> {
  if (!pinnedWorktrees || pinnedWorktrees.size === 0) return false;
  if (pinnedWorktrees.has(worktreePath)) return true;
  for (const pinned of pinnedWorktrees) {
    if (await samePath(worktreePath, pinned)) return true;
  }
  return false;
}

/**
 * Audits `code60/*` worktrees in a repository and applies the 7-guard safety checklist
 * for clean worktree removal:
 * 1. Branch matches `^code60\/[A-Za-z0-9][A-Za-z0-9._-]*$`.
 * 2. Matching terminal RunRecord with age >= `minAgeHours`.
 * 3. `recordedAgentAlive()` is verified false.
 * 4. Not pinned by any active review, checkpoint, workflow, or scheduled execution.
 * 5. `changedFiles(worktree, base)` is empty OR `record.discardedAt` is already set.
 * 6. Removed via `git.removeWorktree(repoDir, worktree, branch)`.
 * 7. Atomically stamps `discardedAt` on `run.json`, preserving `run.json` and `events.jsonl`.
 */
export async function auditAndPruneWorktrees(
  deps: CoreDeps,
  repoDir: string,
  env: Readonly<Record<string, string | undefined>>,
  options: WorktreePruneOptions,
): Promise<WorktreePruneResult> {
  const workspace = await openWorkspace(deps, repoDir, env);
  if (!workspace.repo) {
    return { prunedCount: 0, cleanCandidateCount: 0, dirtyRetainedCount: 0, findings: [] };
  }

  const label = basename(workspace.repo.topLevel) || "repository";
  const targetHash = heartbeatTargetHash(workspace.repo.topLevel);
  const nowMs = deps.clock.now().getTime();
  const minAgeMs = Math.max(1, options.minAgeHours) * HOUR_MS;
  const [worktrees, records] = await Promise.all([
    deps.git.listWorktrees(workspace.repo.topLevel, { sizes: false }),
    workspace.store.list(),
  ]);

  const byBranch = new Map<string, RunRecord>();
  for (const record of records) {
    if (record.branch) byBranch.set(record.branch, record);
  }

  let prunedCount = 0;
  let cleanCandidateCount = 0;
  let dirtyRetainedCount = 0;
  const findings: HeartbeatFinding[] = [];

  for (const wt of worktrees) {
    // Guard 1: strictly Code60-owned branch naming.
    if (!wt.branch || !OWN_BRANCH_RE.test(wt.branch)) continue;
    const record = byBranch.get(wt.branch);
    // Guard 2: must have a matching terminal run record past minimum age.
    if (!record || ACTIVE_STATUSES.has(record.status)) continue;
    if (record.base === null || record.branch === null) continue;
    if (!(await samePath(wt.path, record.worktree))) continue;
    const endedMs = recordTerminalMs(record);
    if (endedMs === null || nowMs - endedMs < minAgeMs) continue;
    // Guard 3: verified dead agent process.
    if (await recordedAgentAlive(deps.processes, record)) continue;
    // Guard 4: not pinned by any active review, checkpoint, workflow, or scheduled job.
    if (options.pinnedRunIds?.has(record.id)) continue;
    if (await isPinnedWorktree(wt.path, options.pinnedWorktrees)) continue;

    // Guard 5: zero unpreserved changes against base, OR already marked discardedAt.
    let clean = record.discardedAt !== undefined;
    if (!clean) {
      try {
        const files = await deps.git.changedFiles(record.worktree, record.base);
        clean = files.length === 0;
      } catch {
        // Unreadable diff state fails closed: never remove an unverified worktree.
        dirtyRetainedCount++;
        continue;
      }
    }

    if (!clean) {
      dirtyRetainedCount++;
      continue;
    }

    cleanCandidateCount++;
    if (options.mode === "maintain" && options.autoPruneCleanWorktrees) {
      try {
        // Guard 6: remove via git.removeWorktree (enforces own-branch & samePath under coordinateMetadata).
        await deps.git.removeWorktree(workspace.repo.topLevel, record.worktree, record.branch);
        // Guard 7: stamp discardedAt atomically while preserving run.json & events.jsonl.
        if (!record.discardedAt) {
          record.discardedAt = deps.clock.now().toISOString();
          await workspace.store.save(record);
        }
        prunedCount++;
        if (options.log && options.operationId) {
          emitLog(options.log, {
            event: "heartbeat.worktree_pruned",
            operationId: options.operationId,
            runId: record.id,
            projectId: targetHash,
            outcome: "succeeded",
          });
        }
      } catch {
        // Removal failure is isolated; worktree stays intact.
      }
    }
  }

  if (prunedCount > 0) {
    findings.push({
      code: "clean_worktree_pruned",
      audience: "audit",
      severity: "info",
      title: `Pruned clean worktree${prunedCount === 1 ? "" : "s"} in ${label}`,
      summary: `Pruned ${prunedCount} clean code60/* worktree${prunedCount === 1 ? "" : "s"} in ${label}.`,
      remediation: "auto_cleaned",
      targetLabel: label,
      targetHash,
      count: prunedCount,
    });
  } else if (cleanCandidateCount > 0) {
    findings.push({
      code: "clean_worktree_candidate",
      audience: "audit",
      severity: "info",
      title: `Clean worktree${cleanCandidateCount === 1 ? "" : "s"} ready to prune in ${label}`,
      summary: `${cleanCandidateCount} clean code60/* worktree${cleanCandidateCount === 1 ? "" : "s"} in ${label} eligible for cleanup.`,
      remediation: "none",
      targetLabel: label,
      targetHash,
      count: cleanCandidateCount,
      deepLink: { kind: "page", id: "worktrees", label: "Open Worktrees" },
    });
  }

  if (dirtyRetainedCount > 0) {
    findings.push({
      code: "dirty_worktree_retained",
      audience: "audit",
      severity: "info",
      title: `Preserved worktree${dirtyRetainedCount === 1 ? "" : "s"} with edits in ${label}`,
      summary: `Preserved ${dirtyRetainedCount} ended worktree${dirtyRetainedCount === 1 ? "" : "s"} with edits in ${label}.`,
      remediation: "none",
      targetLabel: label,
      targetHash,
      count: dirtyRetainedCount,
      deepLink: { kind: "page", id: "worktrees", label: "Open Worktrees" },
    });
  }

  return { prunedCount, cleanCandidateCount, dirtyRetainedCount, findings };
}

function createInitialHeartbeatActions(
  definitions: readonly HeartbeatActionDefinition[] = HEARTBEAT_ACTIONS,
): HeartbeatActionRecord[] {
  return definitions.map((def) => ({
    actionId: def.id,
    title: def.title,
    area: def.area,
    behavior: def.behavior,
    status: "pending",
    startedAt: null,
    endedAt: null,
    durationMs: null,
    summary: "Waiting to run.",
    remediatedCount: 0,
    findings: [],
  }));
}

/**
 * Runs a single-flight sequence of heartbeat actions with per-action deadlines,
 * exact initiation/termination/duration timestamps, fault isolation, and progress callbacks.
 */
export async function runHeartbeatSweep(options: {
  id: string;
  sequence: number;
  trigger: "schedule" | "manual";
  mode: HeartbeatMode;
  policy: HeartbeatPolicy;
  runners: readonly HeartbeatActionRunner[];
  now: () => Date;
  signal: AbortSignal;
  onProgress?: (run: HeartbeatRunRecord) => void;
}): Promise<HeartbeatRunRecord> {
  const startedDate = options.now();
  const startedMs = startedDate.getTime();
  const actions = createInitialHeartbeatActions(options.runners.map((r) => r.definition));

  const run: HeartbeatRunRecord = {
    id: options.id,
    sequence: options.sequence,
    trigger: options.trigger,
    mode: options.mode,
    status: "running",
    startedAt: startedDate.toISOString(),
    endedAt: null,
    durationMs: null,
    actions,
  };
  options.onProgress?.(structuredClone(run));

  for (let i = 0; i < options.runners.length; i++) {
    const runner = options.runners[i];
    const record = actions[i];
    if (!runner || !record) continue;

    if (options.signal.aborted) {
      record.status = "skipped";
      record.summary = "Skipped because the heartbeat was cancelled.";
      continue;
    }

    const actionStart = options.now();
    record.status = "running";
    record.startedAt = actionStart.toISOString();
    record.summary = "Running…";
    options.onProgress?.(structuredClone(run));

    const actionAbort = new AbortController();
    const onParentAbort = () => actionAbort.abort(options.signal.reason);
    options.signal.addEventListener("abort", onParentAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      actionAbort.abort(new Error("Action timed out"));
    }, runner.definition.timeoutMs);
    timer.unref?.();

    try {
      const outcome = await runner.execute(actionAbort.signal);
      const actionEnd = options.now();
      record.endedAt = actionEnd.toISOString();
      record.durationMs = Math.max(0, actionEnd.getTime() - actionStart.getTime());
      record.status = outcome.status;
      record.summary = outcome.summary.slice(0, 400);
      record.remediatedCount = Math.max(0, outcome.remediatedCount ?? 0);
      record.findings = (outcome.findings ?? []).slice(0, HEARTBEAT_FINDING_LIMIT);
      if (outcome.deepLink) record.deepLink = outcome.deepLink;
    } catch (error) {
      const actionEnd = options.now();
      record.endedAt = actionEnd.toISOString();
      record.durationMs = Math.max(0, actionEnd.getTime() - actionStart.getTime());
      if (options.signal.aborted && !timedOut) {
        record.status = "skipped";
        record.summary = "Cancelled before completion.";
      } else if (timedOut) {
        const seconds = Math.round(runner.definition.timeoutMs / 1000);
        record.status = "failed";
        record.summary = `Timed out after ${seconds}s.`;
        record.findings = [
          {
            code: "action_timeout",
            audience: "user",
            severity: "error",
            title: `${runner.definition.title} timed out`,
            summary: `${runner.definition.title} exceeded its ${seconds}s deadline.`,
            howToFix:
              "Rerun Heartbeat once host load settles, or check System Manager for stalled processes.",
            remediation: "escalate",
            deepLink: { kind: "page", id: "system-manager", label: "Open System Manager" },
          },
        ];
      } else {
        const message = diagnosticMessage(error, 200);
        record.status = "failed";
        record.summary = diagnosticMessage(error, 300);
        record.findings = [
          {
            code: "action_failed",
            audience: "user",
            severity: "error",
            title: `${runner.definition.title} failed`,
            summary: message,
            howToFix:
              "Inspect the error detail below and check Health Check or System Manager before rerunning Heartbeat.",
            remediation: "escalate",
            deepLink: { kind: "page", id: "health-check", label: "Open Health Check" },
          },
        ];
      }
    } finally {
      clearTimeout(timer);
      options.signal.removeEventListener("abort", onParentAbort);
    }

    options.onProgress?.(structuredClone(run));
  }

  const endedDate = options.now();
  run.endedAt = endedDate.toISOString();
  run.durationMs = Math.max(0, endedDate.getTime() - startedMs);
  run.status = rollupHeartbeatRunStatus(actions, options.signal.aborted);
  options.onProgress?.(structuredClone(run));
  return run;
}

export function findHeartbeatActionDef(id: HeartbeatActionId): HeartbeatActionDefinition {
  const def = HEARTBEAT_ACTIONS.find((entry) => entry.id === id);
  if (!def) throw new Error(`Unknown heartbeat action: ${id}`);
  return def;
}
