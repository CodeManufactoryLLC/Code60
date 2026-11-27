import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  DEFAULT_HEARTBEAT_POLICY,
  emitLog,
  HEARTBEAT_HISTORY_LIMIT,
  HEARTBEAT_STATE_FORMAT,
  HEARTBEAT_STATE_MAX_BYTES,
  type HealthCheckItem,
  type HealthSnapshot,
  type HeartbeatFinding,
  type HeartbeatFindingCode,
  type HeartbeatPersistedState,
  type HeartbeatPolicy,
  type HeartbeatRequest,
  type HeartbeatRunRecord,
  type HeartbeatSnapshot,
  heartbeatPersistedStateSchema,
  heartbeatPolicySchema,
  type LogSink,
  type RedactedHeartbeatStatus,
  type ServiceStatus,
} from "../bridge/index.js";
import {
  auditAndPruneWorktrees,
  type CoreDeps,
  checkAndCleanOrphans,
  cleanStaleTempArtifacts,
  findHeartbeatActionDef,
  type HeartbeatActionOutcome,
  type HeartbeatActionRunner,
  type HeartbeatMode,
  heartbeatTargetHash,
  nextOccurrence,
  reconcileWorkspaceRuns,
  runHeartbeatSweep,
  stateHome,
} from "../core/index.js";
import {
  diagnosticMessage,
  fileCode,
  privateDirectory,
  readPrivateJson,
  readVolumeSpace,
  type VolumeProbeInput,
  type VolumeProbeResult,
  writePrivateJson,
} from "../platform/index.js";

const LOW_DISK_PAUSE_BYTES = 2 * 1024 ** 3; // 2 GiB scheduler dispatch floor
const LOW_DISK_RESUME_BYTES = 4 * 1024 ** 3; // 4 GiB hysteresis recovery floor
const LOW_DISK_WARNING_BYTES = 10 * 1024 ** 3; // 10 GiB early headroom warning
const EXECUTION_HISTORY_WARNING_THRESHOLD = 4_000;
const SIDECAR_RESTART_WINDOW_MS = 15 * 60_000;
const SIDECAR_MAX_RESTARTS_PER_WINDOW = 3;

interface ScheduledJobAuditEntry {
  id: string;
  name: string;
  enabled: boolean;
  repositoryPath: string;
  baseBranch: string;
  providerName: string;
  providerHash: string;
}

interface WedgedRunDescriptor {
  runId: string;
  label: string;
  reason: string;
}

interface RuntimeHealOutcome {
  restartedSidecars: number;
  sidecarIssues: string[];
  relayReconnected: boolean;
  relayError: string | null;
}

export interface HeartbeatPorts {
  env: Readonly<NodeJS.ProcessEnv>;
  deps: CoreDeps;
  log?: LogSink;
  now?: () => Date;
  tempDir?: () => string;
  runPassiveHealthCheck: (signal: AbortSignal) => Promise<HealthSnapshot>;
  probeVolumes?: (inputs: readonly VolumeProbeInput[]) => Promise<VolumeProbeResult[]>;
  scheduler: {
    status(): ServiceStatus | null;
    executionCount(): number;
    listEnabledJobs(): ScheduledJobAuditEntry[];
    verifyJobDrift?(
      job: ScheduledJobAuditEntry,
    ): Promise<"ok" | "repository_drift" | "base_missing" | "provider_drift">;
    resolveBlock(): Promise<boolean>;
    pauseAll(): Promise<void>;
    resumeAll(): Promise<void>;
  };
  runtime: {
    repoPaths(): string[];
    pinnedWorktreesAndRuns(): { worktrees: ReadonlySet<string>; runIds: ReadonlySet<string> };
    inspectWedgedRuns(nowMs: number): WedgedRunDescriptor[];
    recoverWedgedRun(runId: string): Promise<boolean>;
    healRuntime(options: {
      canRestartSidecar: boolean;
      mode: HeartbeatMode;
    }): Promise<RuntimeHealOutcome>;
  };
}

const heartbeatRoot = (env: Readonly<NodeJS.ProcessEnv>) =>
  join(stateHome(env), "code60", "heartbeat");

function defaultPersistedState(now: Date): HeartbeatPersistedState {
  return {
    format: HEARTBEAT_STATE_FORMAT,
    revision: 0,
    sequence: 0,
    anchor: now.toISOString(),
    lowDiskPausedByHeartbeat: false,
    policy: { ...DEFAULT_HEARTBEAT_POLICY },
    runs: [],
  };
}

function healthCheckFixHint(check: HealthCheckItem): string {
  switch (check.id) {
    case "providers-installed":
      return "Install and verify at least one agent provider in Providers.";
    case "providers-authenticated":
      return "Sign in to your selected provider in Providers.";
    case "git-toolchain":
      return "Install Git or ensure it is available on your PATH, then rerun Health Check.";
    case "database-health":
      return "Connect or repair your workspace database in Settings.";
    case "storage-safety":
      return "Fix directory permissions or symlink issues shown in Health Check.";
    case "disk-space":
      return "Free disk space on the affected volume and inspect disk usage in Health Check.";
    case "scheduler-status":
    case "scheduler-registration":
    case "scheduler-health":
      return "Inspect the background scheduler status in System Manager or Health Check.";
    case "mcp-gateway":
    case "mcp-servers":
      return "Check your MCP server configuration and status in MCP.";
    case "memory-health":
    case "embeddings-rag":
      return "Review Memory and embedding assets in Health Check or run npm run prepare:models.";
    case "relay-health":
      return "Check the Relay connection status and reconnect if needed.";
    case "code60-quotas":
    case "diagnostic-logs":
      return "Inspect storage and quota usage in Health Check.";
    default:
      return check.detail
        ? check.detail.slice(0, 260)
        : "Open Health Check to inspect the failing check and resolve it.";
  }
}

function migrateLegacyState(raw: unknown, now: Date): HeartbeatPersistedState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const candidate = raw as Record<string, unknown>;
  if (candidate.format !== 1) return null;
  const parsedPolicy = heartbeatPolicySchema.safeParse(candidate.policy);
  const anchor =
    typeof candidate.anchor === "string" && !Number.isNaN(Date.parse(candidate.anchor))
      ? candidate.anchor
      : now.toISOString();
  return {
    format: HEARTBEAT_STATE_FORMAT,
    revision: typeof candidate.revision === "number" ? candidate.revision : 0,
    sequence: typeof candidate.sequence === "number" ? candidate.sequence : 0,
    anchor,
    lowDiskPausedByHeartbeat: Boolean(candidate.lowDiskPausedByHeartbeat),
    policy: parsedPolicy.success ? parsedPolicy.data : { ...DEFAULT_HEARTBEAT_POLICY },
    runs: [],
  };
}

/**
 * Gateway-hosted autonomous Core Heartbeat service.
 * Owns its anchored interval timer, single-flight execution lock, bounded private
 * state ring buffer (`$XDG_STATE_HOME/code60/heartbeat/state.json`), and SSE subscribers.
 */
export class HeartbeatService {
  private readonly now: () => Date;
  private readonly statePath: string;
  private state: HeartbeatPersistedState;
  private diskState: unknown;
  private loaded = false;
  private stopped = false;
  private storageWarning: string | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private currentRun: HeartbeatRunRecord | null = null;
  private activeAbort: AbortController | null = null;
  private activeFlight: Promise<HeartbeatSnapshot> | null = null;
  private nextRunAt: string | null = null;
  private readonly sidecarRestartStamps: number[] = [];
  private readonly listeners = new Set<(snapshot: HeartbeatSnapshot) => void>();

  constructor(private readonly ports: HeartbeatPorts) {
    this.now = ports.now ?? (() => new Date());
    this.statePath = join(heartbeatRoot(ports.env), "state.json");
    this.state = defaultPersistedState(this.now());
  }

  subscribe(listener: (snapshot: HeartbeatSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const listener of this.listeners) {
      try {
        listener(snap);
      } catch {
        /* Subscriber errors must not affect heartbeat scheduling. */
      }
    }
  }

  async start(): Promise<void> {
    if (this.stopped) return;
    await this.loadState();
    this.scheduleNext();
    this.emit();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.nextRunAt = null;
    this.activeAbort?.abort(new Error("Gateway is stopping"));
    if (this.activeFlight) {
      await this.activeFlight.catch(() => {});
    }
  }

  private async loadState(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const root = heartbeatRoot(this.ports.env);
      await privateDirectory(root);
      const raw = await readPrivateJson(this.statePath, HEARTBEAT_STATE_MAX_BYTES);
      const migrated = migrateLegacyState(raw, this.now());
      if (migrated) {
        this.state = migrated;
        this.diskState = raw;
        this.storageWarning = null;
        await this.persistState();
        return;
      }
      this.state = heartbeatPersistedStateSchema.parse(raw);
      this.diskState = raw;
      this.storageWarning = null;
    } catch (error) {
      if (fileCode(error) === "ENOENT") {
        this.state = defaultPersistedState(this.now());
        this.diskState = undefined;
        await this.persistState();
      } else {
        // Preserve corrupt/unsafe state untouched and surface warning without crashing Gateway.
        this.state = defaultPersistedState(this.now());
        this.diskState = undefined;
        this.storageWarning = `Heartbeat state could not be loaded: ${diagnosticMessage(error, 200)}`;
      }
    }
  }

  private async persistState(): Promise<void> {
    if (this.storageWarning && this.diskState === undefined) {
      // Do not overwrite an unreadable/unsafe file on disk.
      return;
    }
    try {
      const root = heartbeatRoot(this.ports.env);
      await privateDirectory(root);
      const next: HeartbeatPersistedState = {
        ...this.state,
        runs: this.state.runs.slice(0, HEARTBEAT_HISTORY_LIMIT),
      };
      const parsed = heartbeatPersistedStateSchema.parse(next);
      await writePrivateJson(this.statePath, parsed, this.diskState, HEARTBEAT_STATE_MAX_BYTES);
      this.state = parsed;
      this.diskState = structuredClone(parsed);
      this.storageWarning = null;
    } catch (error) {
      this.storageWarning = `Heartbeat state could not be saved: ${diagnosticMessage(error, 200)}`;
    }
  }

  private scheduleNext(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.stopped || !this.state.policy.enabled) {
      this.nextRunAt = null;
      return;
    }
    const now = this.now();
    const upcoming = nextOccurrence(
      {
        type: "interval",
        everyMinutes: this.state.policy.intervalMinutes,
        anchor: this.state.anchor,
      },
      now,
    );
    this.nextRunAt = upcoming.toISOString();
    const delayMs = Math.max(1_000, upcoming.getTime() - now.getTime());
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.triggerRun("schedule", "maintain")
        .catch(() => {})
        .finally(() => {
          if (!this.stopped) {
            this.scheduleNext();
            this.emit();
          }
        });
    }, delayMs);
    this.timer.unref?.();
  }

  snapshot(): HeartbeatSnapshot {
    return structuredClone({
      revision: this.state.revision,
      policy: this.state.policy,
      nextRunAt: this.nextRunAt,
      running: this.currentRun !== null,
      lowDiskPausedByHeartbeat: this.state.lowDiskPausedByHeartbeat,
      currentRun: this.currentRun,
      lastCompletedRun: this.state.runs[0] ?? null,
      recentRuns: this.state.runs,
      storageWarning: this.storageWarning,
    });
  }

  redactedStatus(): RedactedHeartbeatStatus {
    const latest = this.currentRun ?? this.state.runs[0] ?? null;
    let remediatedCount = 0;
    let warningCount = 0;
    let escalatedCount = 0;
    const codes = new Set<HeartbeatFindingCode>();
    if (latest) {
      for (const action of latest.actions) {
        remediatedCount += action.remediatedCount;
        if (action.status === "warning") warningCount++;
        if (action.status === "escalated" || action.status === "failed") escalatedCount++;
        for (const finding of action.findings) codes.add(finding.code);
      }
    }
    return {
      enabled: this.state.policy.enabled,
      intervalMinutes: this.state.policy.intervalMinutes,
      running: this.currentRun !== null,
      lowDiskPausedByHeartbeat: this.state.lowDiskPausedByHeartbeat,
      nextRunAt: this.nextRunAt,
      lastRun: latest
        ? {
            trigger: latest.trigger,
            mode: latest.mode,
            status: latest.status,
            startedAt: latest.startedAt,
            endedAt: latest.endedAt,
            durationMs: latest.durationMs,
            remediatedCount,
            warningCount,
            escalatedCount,
            findingCodes: [...codes],
          }
        : null,
    };
  }

  async handle(request: HeartbeatRequest): Promise<HeartbeatSnapshot> {
    await this.loadState();
    switch (request.action) {
      case "snapshot":
        return this.snapshot();
      case "run":
        return this.triggerRun("manual", request.mode ?? "maintain");
      case "cancel":
        this.activeAbort?.abort(new Error("Cancelled by user"));
        if (this.activeFlight) await this.activeFlight.catch(() => {});
        return this.snapshot();
      case "updatePolicy": {
        this.state = {
          ...this.state,
          revision: this.state.revision + 1,
          policy: { ...request.policy },
        };
        await this.persistState();
        this.scheduleNext();
        this.emit();
        return this.snapshot();
      }
    }
  }

  async triggerRun(
    trigger: "schedule" | "manual",
    mode: HeartbeatMode,
  ): Promise<HeartbeatSnapshot> {
    await this.loadState();
    if (this.activeFlight) {
      return this.activeFlight;
    }
    const abort = new AbortController();
    this.activeAbort = abort;
    const runId = randomUUID();
    const sequence = this.state.sequence + 1;
    const policy = { ...this.state.policy };
    const runners = this.buildRunners(mode, policy, runId);

    let flight!: Promise<HeartbeatSnapshot>;
    flight = (async () => {
      try {
        const completed = await runHeartbeatSweep({
          id: runId,
          sequence,
          trigger,
          mode,
          policy,
          runners,
          now: this.now,
          signal: abort.signal,
          onProgress: (progress) => {
            this.currentRun = progress.endedAt === null ? progress : null;
            this.emit();
          },
        });
        this.currentRun = null;
        this.state = {
          ...this.state,
          revision: this.state.revision + 1,
          sequence,
          runs: [completed, ...this.state.runs].slice(0, HEARTBEAT_HISTORY_LIMIT),
        };
        await this.persistState();
        this.logCompletedSweep(completed);
        this.emit();
        return this.snapshot();
      } finally {
        this.currentRun = null;
        if (this.activeAbort === abort) this.activeAbort = null;
        if (this.activeFlight === flight) this.activeFlight = null;
      }
    })();

    this.activeFlight = flight;
    return flight;
  }

  private logCompletedSweep(run: HeartbeatRunRecord): void {
    if (!this.ports.log) return;
    if (run.status === "healthy") return; // Successful healthy sweeps do not spam diagnostic logs.
    emitLog(this.ports.log, {
      event: "heartbeat.sweep",
      operationId: run.id,
      severity:
        run.status === "failed" || run.status === "escalated"
          ? "error"
          : run.status === "warning"
            ? "warning"
            : "info",
      outcome:
        run.status === "cancelled" ? "cancelled" : run.status === "failed" ? "failed" : "succeeded",
      ...(run.durationMs === null ? {} : { durationMs: run.durationMs }),
    });
  }

  private allRepoPaths(): string[] {
    const seen = new Set<string>();
    for (const p of this.ports.runtime.repoPaths()) seen.add(p);
    for (const job of this.ports.scheduler.listEnabledJobs()) seen.add(job.repositoryPath);
    return [...seen];
  }

  private canRestartSidecar(): boolean {
    const cutoff = this.now().getTime() - SIDECAR_RESTART_WINDOW_MS;
    while (this.sidecarRestartStamps.length > 0 && (this.sidecarRestartStamps[0] ?? 0) < cutoff) {
      this.sidecarRestartStamps.shift();
    }
    return this.sidecarRestartStamps.length < SIDECAR_MAX_RESTARTS_PER_WINDOW;
  }

  private buildRunners(
    mode: HeartbeatMode,
    policy: HeartbeatPolicy,
    operationId: string,
  ): HeartbeatActionRunner[] {
    return [
      {
        definition: findHeartbeatActionDef("passive-health-sweep"),
        execute: async (signal): Promise<HeartbeatActionOutcome> => {
          const health = await this.ports.runPassiveHealthCheck(signal);
          const warnings = health.checks.filter((c) => c.status === "warning");
          const errors = health.checks.filter(
            (c) => c.status === "error" || c.status === "unavailable",
          );
          const findings: HeartbeatFinding[] = [];
          for (const check of errors) {
            findings.push({
              code: check.id === "storage-safety" ? "unsafe_storage" : "health_error",
              audience: "user",
              severity: "error",
              title: check.title.slice(0, 140),
              summary: check.summary.slice(0, 300),
              howToFix: healthCheckFixHint(check),
              remediation: "escalate",
              deepLink: check.deepLink ?? {
                kind: "page",
                id: "health-check",
                label: "Open Health Check",
              },
            });
          }
          for (const check of warnings) {
            findings.push({
              code: "health_warning",
              audience: "user",
              severity: "warning",
              title: check.title.slice(0, 140),
              summary: check.summary.slice(0, 300),
              howToFix: healthCheckFixHint(check),
              remediation: "user_action",
              deepLink: check.deepLink ?? {
                kind: "page",
                id: "health-check",
                label: "Open Health Check",
              },
            });
          }
          if (errors.length > 0) {
            return {
              status: "escalated",
              summary: `${errors.length} health check error${errors.length === 1 ? "" : "s"} and ${warnings.length} warning${warnings.length === 1 ? "" : "s"} detected.`,
              findings,
              deepLink: { kind: "page", id: "health-check", label: "Open Health Check" },
            };
          }
          if (warnings.length > 0) {
            return {
              status: "warning",
              summary: `${warnings.length} passive health warning${warnings.length === 1 ? "" : "s"} detected across ${health.checks.length} checks.`,
              findings,
              deepLink: { kind: "page", id: "health-check", label: "Open Health Check" },
            };
          }
          return {
            status: "passed",
            summary: `All ${health.checks.length} passive health checks passed.`,
          };
        },
      },
      {
        definition: findHeartbeatActionDef("disk-pressure-guard"),
        execute: async (): Promise<HeartbeatActionOutcome> => {
          if (!policy.lowDiskGuard) {
            return { status: "skipped", summary: "Disabled by Heartbeat policy." };
          }
          const stateDir = join(stateHome(this.ports.env), "code60");
          const tmp = this.ports.tempDir?.() ?? tmpdir();
          const inputs: VolumeProbeInput[] = [
            { id: "state", label: "Code60 state volume", path: stateDir },
            { id: "tmp", label: "Temporary volume", path: tmp },
            ...this.allRepoPaths().map((p) => ({
              id: `repo:${heartbeatTargetHash(p)}`,
              label: basename(p) || "Repository",
              path: p,
            })),
          ];
          const probe = this.ports.probeVolumes ?? readVolumeSpace;
          const results = await probe(inputs);
          const lowVolumes = results.filter(
            (v) => v.availableBytes !== null && v.availableBytes < LOW_DISK_PAUSE_BYTES,
          );
          const warnVolumes = results.filter(
            (v) =>
              v.availableBytes !== null &&
              v.availableBytes >= LOW_DISK_PAUSE_BYTES &&
              v.availableBytes < LOW_DISK_WARNING_BYTES,
          );
          const allAboveResume = results.every(
            (v) => v.availableBytes === null || v.availableBytes >= LOW_DISK_RESUME_BYTES,
          );
          const sched = this.ports.scheduler.status();
          const findings: HeartbeatFinding[] = [];

          if (lowVolumes.length > 0) {
            const first = lowVolumes[0]!;
            const canAutoPause =
              mode === "maintain" &&
              sched !== null &&
              !sched.pausedAll &&
              sched.block?.reason !== "persistence_failed";
            if (canAutoPause) {
              await this.ports.scheduler.pauseAll();
              this.state.lowDiskPausedByHeartbeat = true;
              emitLog(this.ports.log, {
                event: "heartbeat.self_heal",
                operationId,
                severity: "warning",
                outcome: "succeeded",
              });
              findings.push({
                code: "low_disk_paused",
                audience: "user",
                severity: "error",
                title: `Low disk space on ${first.label}`,
                summary: `${first.label} dropped below 2 GiB free. Future Scheduled Jobs are paused automatically.`,
                howToFix:
                  "Free disk space above 4 GiB on that volume so Heartbeat can resume Scheduled Jobs automatically.",
                remediation: "auto_healed",
                targetLabel: first.label,
                deepLink: { kind: "page", id: "health-check", label: "Open Health Check" },
              });
              return {
                status: "remediated",
                summary: `Paused Scheduled Jobs due to low disk space on ${first.label}.`,
                remediatedCount: 1,
                findings,
                deepLink: { kind: "page", id: "system-manager", label: "Open System Manager" },
              };
            }
            findings.push({
              code: "low_disk_warning",
              audience: "user",
              severity: "error",
              title: `Low disk space on ${first.label}`,
              summary: `${lowVolumes.length} volume${lowVolumes.length === 1 ? " is" : "s are"} below the 2 GiB safety floor.`,
              howToFix:
                "Free disk space above 4 GiB on the affected volume before running new scheduled jobs.",
              remediation: "escalate",
              targetLabel: first.label,
              count: lowVolumes.length,
              deepLink: { kind: "page", id: "health-check", label: "Open Health Check" },
            });
            return {
              status: "escalated",
              summary: `Low disk space below 2 GiB on ${first.label}.`,
              findings,
              deepLink: { kind: "page", id: "health-check", label: "Inspect Disk Space" },
            };
          }

          if (
            this.state.lowDiskPausedByHeartbeat &&
            allAboveResume &&
            mode === "maintain" &&
            sched !== null &&
            sched.pausedAll &&
            sched.block === null
          ) {
            await this.ports.scheduler.resumeAll();
            this.state.lowDiskPausedByHeartbeat = false;
            emitLog(this.ports.log, {
              event: "heartbeat.self_heal",
              operationId,
              severity: "info",
              outcome: "succeeded",
            });
            return {
              status: "remediated",
              summary: "Disk headroom recovered above 4 GiB; resumed future Scheduled Jobs.",
              remediatedCount: 1,
              findings: [
                {
                  code: "low_disk_resumed",
                  audience: "audit",
                  severity: "info",
                  title: "Resumed Scheduled Jobs after disk recovery",
                  summary:
                    "All monitored volumes exceed 4 GiB free; resumed Scheduled Jobs paused by Heartbeat.",
                  remediation: "auto_healed",
                },
              ],
            };
          }

          if (warnVolumes.length > 0) {
            return {
              status: "warning",
              summary: `${warnVolumes.length} volume${warnVolumes.length === 1 ? " has" : "s have"} under 10 GiB free.`,
              findings: warnVolumes.map((v) => ({
                code: "low_disk_warning" as const,
                audience: "user" as const,
                severity: "warning" as const,
                title: `Disk space running low on ${v.label}`,
                summary: `${v.label} has less than 10 GiB free space remaining.`,
                howToFix:
                  "Reclaim space by removing unused worktrees or temporary files before space drops below 2 GiB.",
                remediation: "user_action" as const,
                targetLabel: v.label,
                deepLink: { kind: "page", id: "health-check", label: "Open Health Check" },
              })),
            };
          }

          return {
            status: "passed",
            summary: `Disk headroom is healthy across ${results.length} checked volume${results.length === 1 ? "" : "s"}.`,
          };
        },
      },
      {
        definition: findHeartbeatActionDef("scheduler-drift-audit"),
        execute: async (): Promise<HeartbeatActionOutcome> => {
          const findings: HeartbeatFinding[] = [];
          const execCount = this.ports.scheduler.executionCount();
          if (execCount >= EXECUTION_HISTORY_WARNING_THRESHOLD) {
            findings.push({
              code: "execution_capacity_warning",
              audience: "user",
              severity: "warning",
              title: "Scheduled Jobs history approaching limit",
              summary: `Scheduled Jobs execution history has ${execCount} of 5,000 entries.`,
              howToFix:
                "Review Scheduled Jobs cadence or prune old job history before it reaches the 5,000-entry limit.",
              remediation: "user_action",
              count: execCount,
              deepLink: { kind: "page", id: "automations", label: "Open Scheduled Jobs" },
            });
          }
          const jobs = this.ports.scheduler.listEnabledJobs();
          if (this.ports.scheduler.verifyJobDrift) {
            for (const job of jobs) {
              const drift = await this.ports.scheduler
                .verifyJobDrift(job)
                .catch(() => "repository_drift" as const);
              if (drift === "ok") continue;
              const code =
                drift === "base_missing"
                  ? "job_base_missing"
                  : drift === "provider_drift"
                    ? "job_provider_drift"
                    : "job_repository_drift";
              const howToFix =
                drift === "base_missing"
                  ? "Update the job's base branch in Scheduled Jobs or recreate the missing branch."
                  : drift === "provider_drift"
                    ? "Select an installed, verified provider for this job in Scheduled Jobs."
                    : "Update the job's repository path in Scheduled Jobs or disable the job.";
              findings.push({
                code,
                audience: "user",
                severity: "warning",
                title: `Scheduled job "${job.name}" needs update`,
                summary: `Detected ${drift.replaceAll("_", " ")} on "${job.name}".`,
                howToFix,
                remediation: "user_action",
                targetLabel: job.name,
                targetHash: heartbeatTargetHash(job.repositoryPath),
                deepLink: { kind: "page", id: "automations", label: "Open Scheduled Jobs" },
              });
            }
          }
          if (findings.length > 0) {
            return {
              status: "warning",
              summary: `${findings.length} scheduled-job drift or capacity warning${findings.length === 1 ? "" : "s"} found.`,
              findings,
              deepLink: { kind: "page", id: "automations", label: "Open Scheduled Jobs" },
            };
          }
          return {
            status: "passed",
            summary: `Checked ${jobs.length} enabled scheduled job${jobs.length === 1 ? "" : "s"} and history capacity (${execCount}/5,000).`,
          };
        },
      },
      {
        definition: findHeartbeatActionDef("dead-owner-reconcile"),
        execute: async (): Promise<HeartbeatActionOutcome> => {
          const repos = this.allRepoPaths();
          let reconciled = 0;
          let candidates = 0;
          const findings: HeartbeatFinding[] = [];
          for (const repo of repos) {
            const res = await reconcileWorkspaceRuns(this.ports.deps, repo, this.ports.env, mode);
            reconciled += res.reconciledCount;
            candidates += res.candidateCount;
            findings.push(...res.findings);
          }
          if (reconciled > 0) {
            emitLog(this.ports.log, {
              event: "heartbeat.reconciled",
              operationId,
              outcome: "succeeded",
            });
            return {
              status: "remediated",
              summary: `Marked ${reconciled} dead-owner run${reconciled === 1 ? "" : "s"} interrupted across ${repos.length} repo${repos.length === 1 ? "" : "s"}.`,
              remediatedCount: reconciled,
              findings,
            };
          }
          if (candidates > 0) {
            return {
              status: "warning",
              summary: `Found ${candidates} dead-owner run${candidates === 1 ? "" : "s"} needing reconciliation (dry run).`,
              findings,
            };
          }
          return {
            status: "passed",
            summary: `No dead-owner active runs across ${repos.length} monitored repo${repos.length === 1 ? "" : "s"}.`,
          };
        },
      },
      {
        definition: findHeartbeatActionDef("stuck-execution-watchdog"),
        execute: async (): Promise<HeartbeatActionOutcome> => {
          const findings: HeartbeatFinding[] = [];
          let remediated = 0;
          let escalated = 0;

          // 1. Live wedged runs in ApplicationHost
          const wedged = this.ports.runtime.inspectWedgedRuns(this.now().getTime());
          for (const item of wedged) {
            if (mode === "maintain") {
              const recovered = await this.ports.runtime
                .recoverWedgedRun(item.runId)
                .catch(() => false);
              if (recovered) {
                remediated++;
                findings.push({
                  code: "wedged_run_recovered",
                  audience: "audit",
                  severity: "info",
                  title: `Recovered wedged run (${item.label})`,
                  summary: `Stopped wedged run ${item.runId} (${item.label}): ${item.reason}`,
                  remediation: "auto_reconciled",
                  runId: item.runId,
                  targetLabel: item.label,
                });
              } else {
                escalated++;
                findings.push({
                  code: "wedged_run_escalated",
                  audience: "user",
                  severity: "error",
                  title: `Wedged run ${item.runId} (${item.label})`,
                  summary: `Run ${item.runId} could not be stopped automatically.`,
                  howToFix: "Open System Manager to inspect and stop the stuck agent process.",
                  remediation: "escalate",
                  runId: item.runId,
                  targetLabel: item.label,
                  deepLink: { kind: "page", id: "system-manager", label: "Open System Manager" },
                });
              }
            } else {
              escalated++;
              findings.push({
                code: "wedged_run_escalated",
                audience: "user",
                severity: "warning",
                title: `Wedged run ${item.runId} (${item.label})`,
                summary: `Run ${item.runId} appears wedged (${item.reason}).`,
                howToFix: "Run a live heartbeat sweep or stop the run in System Manager.",
                remediation: "user_action",
                runId: item.runId,
                targetLabel: item.label,
                deepLink: { kind: "page", id: "system-manager", label: "Open System Manager" },
              });
            }
          }

          // 2. Orphan agent processes on ended runs
          for (const repo of this.allRepoPaths()) {
            const orphanRes = await checkAndCleanOrphans(this.ports.deps, repo, this.ports.env, {
              mode,
              autoStopVerifiedOrphans: policy.autoStopVerifiedOrphans,
            });
            remediated += orphanRes.stoppedCount;
            escalated += orphanRes.escalatedCount;
            findings.push(...orphanRes.findings);
          }

          // 3. Scheduler leftover_agent block recheck & auto-clear
          const schedStatus = this.ports.scheduler.status();
          if (schedStatus?.block?.reason === "leftover_agent") {
            if (mode === "maintain" && policy.autoClearVerifiedLeftoverBlock) {
              const cleared = await this.ports.scheduler.resolveBlock().catch(() => false);
              if (cleared) {
                remediated++;
                findings.push({
                  code: "leftover_block_cleared",
                  audience: "audit",
                  severity: "info",
                  title: "Cleared scheduler leftover-agent block",
                  summary:
                    "Verified leftover agent process is gone and cleared the scheduler block.",
                  remediation: "auto_reconciled",
                });
              } else {
                escalated++;
                findings.push({
                  code: "leftover_block_escalated",
                  audience: "user",
                  severity: "error",
                  title: "Scheduler blocked by leftover agent",
                  summary:
                    "Scheduler remains blocked by a live or unverifiable leftover agent process.",
                  howToFix:
                    "Confirm the old agent process has exited in System Manager, then clear the scheduler block.",
                  remediation: "escalate",
                  deepLink: { kind: "page", id: "system-manager", label: "Open System Manager" },
                });
              }
            } else {
              escalated++;
              findings.push({
                code: "leftover_block_escalated",
                audience: "user",
                severity: "warning",
                title: "Scheduler blocked by leftover agent",
                summary: "Scheduler has an active leftover_agent block preventing scheduled runs.",
                howToFix:
                  mode === "inspect"
                    ? "Run a live heartbeat sweep to verify and clear the block, or inspect in System Manager."
                    : "Inspect the leftover process in System Manager and clear the scheduler block.",
                remediation: "user_action",
                deepLink: { kind: "page", id: "system-manager", label: "Open System Manager" },
              });
            }
          }

          if (remediated > 0) {
            emitLog(this.ports.log, {
              event: "heartbeat.reconciled",
              operationId,
              outcome: "succeeded",
            });
          }

          if (escalated > 0) {
            return {
              status: "escalated",
              summary: `${remediated} stuck item${remediated === 1 ? "" : "s"} resolved; ${escalated} require manual attention.`,
              remediatedCount: remediated,
              findings,
              deepLink: { kind: "page", id: "system-manager", label: "Open System Manager" },
            };
          }
          if (remediated > 0) {
            return {
              status: "remediated",
              summary: `Resolved ${remediated} stuck execution or orphan process item${remediated === 1 ? "" : "s"}.`,
              remediatedCount: remediated,
              findings,
            };
          }
          return {
            status: "passed",
            summary: "No wedged runs, orphan processes, or scheduler blocks detected.",
          };
        },
      },
      {
        definition: findHeartbeatActionDef("runtime-self-heal"),
        execute: async (): Promise<HeartbeatActionOutcome> => {
          if (!policy.autoHealSidecars) {
            return { status: "skipped", summary: "Disabled by Heartbeat policy." };
          }
          const canRestart = this.canRestartSidecar();
          const result = await this.ports.runtime.healRuntime({
            canRestartSidecar: canRestart,
            mode,
          });
          const findings: HeartbeatFinding[] = [];
          let remediated = 0;

          if (result.restartedSidecars > 0) {
            for (let i = 0; i < result.restartedSidecars; i++) {
              this.sidecarRestartStamps.push(this.now().getTime());
            }
            remediated += result.restartedSidecars;
            findings.push({
              code: "sidecar_restarted",
              audience: "audit",
              severity: "info",
              title: "Restarted unresponsive sidecar",
              summary: `Retired ${result.restartedSidecars} unresponsive stateless sidecar${result.restartedSidecars === 1 ? "" : "s"} for fresh restart.`,
              remediation: "auto_healed",
              count: result.restartedSidecars,
            });
          }
          for (const issue of result.sidecarIssues) {
            findings.push({
              code: canRestart ? "health_warning" : "sidecar_restart_capped",
              audience: "user",
              severity: canRestart ? "warning" : "error",
              title: canRestart ? "Sidecar warning" : "Sidecar restart limit reached",
              summary: issue,
              howToFix: canRestart
                ? "Inspect Memory and sidecar health in Health Check."
                : "Automatic restarts are paused to prevent a crash loop. Check Health Check or System Manager for the underlying error.",
              remediation: canRestart ? "user_action" : "escalate",
              deepLink: { kind: "page", id: "health-check", label: "Open Health Check" },
            });
          }
          if (result.relayReconnected) {
            remediated++;
            findings.push({
              code: "relay_reconnected",
              audience: "audit",
              severity: "info",
              title: "Reconnected Relay",
              summary: "Reconnected Relay after transient transport drop and storage validation.",
              remediation: "auto_healed",
            });
          }
          if (result.relayError) {
            findings.push({
              code: "relay_reconnect_failed",
              audience: "user",
              severity: "warning",
              title: "Relay connection needs attention",
              summary: result.relayError,
              howToFix: "Open Relay to check provider connectivity and resume your conversation.",
              remediation: "user_action",
              deepLink: { kind: "relay", id: "relay", label: "Open Relay" },
            });
          }

          if (remediated > 0) {
            emitLog(this.ports.log, {
              event: "heartbeat.self_heal",
              operationId,
              outcome: "succeeded",
            });
          }
          if (findings.some((f) => f.severity === "error")) {
            return {
              status: "escalated",
              summary: "Sidecar restart cap reached; manual inspection required.",
              remediatedCount: remediated,
              findings,
            };
          }
          if (findings.some((f) => f.severity === "warning")) {
            return {
              status: "warning",
              summary: result.relayError ?? result.sidecarIssues[0] ?? "Runtime warning detected.",
              remediatedCount: remediated,
              findings,
            };
          }
          if (remediated > 0) {
            return {
              status: "remediated",
              summary: `Completed ${remediated} runtime recovery action${remediated === 1 ? "" : "s"}.`,
              remediatedCount: remediated,
              findings,
            };
          }
          return {
            status: "passed",
            summary: "Relay and stateless sidecars are responsive.",
          };
        },
      },
      {
        definition: findHeartbeatActionDef("temp-and-git-hygiene"),
        execute: async (signal): Promise<HeartbeatActionOutcome> => {
          const tmp = this.ports.tempDir?.() ?? tmpdir();
          const stateRoot = join(stateHome(this.ports.env), "code60");
          const privateDirs = [
            join(stateRoot, "heartbeat"),
            join(stateRoot, "automations"),
            join(stateRoot, "gateway"),
          ];
          const tempRes = await cleanStaleTempArtifacts(
            tmp,
            privateDirs,
            this.now().getTime(),
            mode,
          );
          const findings: HeartbeatFinding[] = [...tempRes.findings];
          let prunedRepos = 0;

          if (mode === "maintain" && this.ports.deps.git.pruneWorktrees) {
            for (const repo of this.allRepoPaths()) {
              try {
                await this.ports.deps.git.pruneWorktrees(repo, "1.hour.ago", signal);
                prunedRepos++;
              } catch {
                // Non-Git directories or locked repos are safely skipped.
              }
            }
          }

          const totalRemediated = tempRes.cleanedCount;
          if (totalRemediated > 0) {
            return {
              status: "remediated",
              summary: `Cleaned ${totalRemediated} stale temporary artifact${totalRemediated === 1 ? "" : "s"} and pruned Git worktree metadata across ${prunedRepos} repo${prunedRepos === 1 ? "" : "s"}.`,
              remediatedCount: totalRemediated,
              findings,
            };
          }
          return {
            status: "passed",
            summary:
              mode === "maintain"
                ? `No stale temp artifacts found; checked Git worktree metadata across ${prunedRepos} repo${prunedRepos === 1 ? "" : "s"}.`
                : tempRes.candidateCount > 0
                  ? `${tempRes.candidateCount} stale temporary artifact${tempRes.candidateCount === 1 ? "" : "s"} eligible for cleanup (dry run).`
                  : "No stale temporary artifacts found.",
            findings,
          };
        },
      },
      {
        definition: findHeartbeatActionDef("clean-worktree-prune"),
        execute: async (): Promise<HeartbeatActionOutcome> => {
          const repos = this.allRepoPaths();
          const pinned = this.ports.runtime.pinnedWorktreesAndRuns();
          let pruned = 0;
          let candidates = 0;
          let dirtyRetained = 0;
          const findings: HeartbeatFinding[] = [];

          for (const repo of repos) {
            const res = await auditAndPruneWorktrees(this.ports.deps, repo, this.ports.env, {
              mode,
              autoPruneCleanWorktrees: policy.autoPruneCleanWorktrees,
              minAgeHours: policy.cleanWorktreeMinAgeHours,
              pinnedWorktrees: pinned.worktrees,
              pinnedRunIds: pinned.runIds,
              ...(this.ports.log ? { log: this.ports.log, operationId } : {}),
            });
            pruned += res.prunedCount;
            candidates += res.cleanCandidateCount;
            dirtyRetained += res.dirtyRetainedCount;
            findings.push(...res.findings);
          }

          if (pruned > 0) {
            return {
              status: "remediated",
              summary: `Pruned ${pruned} clean code60/* worktree${pruned === 1 ? "" : "s"}; preserved ${dirtyRetained} worktree${dirtyRetained === 1 ? "" : "s"} with edits.`,
              remediatedCount: pruned,
              findings,
              deepLink: { kind: "page", id: "worktrees", label: "Open Worktrees" },
            };
          }
          if (!policy.autoPruneCleanWorktrees && candidates > 0) {
            return {
              status: "passed",
              summary: `${candidates} clean worktree${candidates === 1 ? "" : "s"} eligible (auto-prune disabled); ${dirtyRetained} dirty worktree${dirtyRetained === 1 ? "" : "s"} preserved.`,
              findings,
              deepLink: { kind: "page", id: "worktrees", label: "Open Worktrees" },
            };
          }
          return {
            status: "passed",
            summary:
              dirtyRetained > 0
                ? `No clean worktrees past ${policy.cleanWorktreeMinAgeHours}h to prune; preserved ${dirtyRetained} worktree${dirtyRetained === 1 ? "" : "s"} with edits.`
                : `No eligible code60/* worktrees to prune across ${repos.length} repo${repos.length === 1 ? "" : "s"}.`,
            findings,
          };
        },
      },
    ];
  }
}
