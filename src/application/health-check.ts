import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import {
  HEALTH_CHECK_IDS,
  type HealthCheckId,
  type HealthCheckItem,
  type HealthCheckMode,
  type HealthCheckRequest,
  type HealthCheckTarget,
  type HealthDeepLink,
  type HealthEnvironmentContext,
  type HealthGroupId,
  type HealthRunScope,
  type HealthSnapshot,
  type HealthStatus,
  type LogStatus,
  type MemorySnapshot,
  type RagStatus,
  rollupHealthStatus,
  type SchedulerStatus,
  type Snapshot,
} from "../bridge/index.js";
import { CODE60_VERSION, stateHome } from "../core/index.js";
import {
  boundedDirectorySize,
  diagnosticMessage,
  inspectPrivateDirectorySafety,
  type PlatformMachineInfo,
  readMachineInfo,
  readVolumeSpace,
  type VolumeProbeInput,
  type VolumeProbeResult,
} from "../platform/index.js";
import { BUNDLED_EMBEDDING_MODEL } from "./embedding-model-info.js";
import { commandIdentity, PROVIDERS } from "./provider-catalog.js";

const execFileAsync = promisify(execFile);

async function raceWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void promise.catch(() => {});
    throw signal.reason instanceof Error ? signal.reason : new Error("Health check timed out.");
  }
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () =>
      reject(signal.reason instanceof Error ? signal.reason : new Error("Health check timed out."));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
    void promise.catch(() => {});
  }
}

const LOW_DISK_ERROR_BYTES = 2 * 1024 ** 3; // 2 GiB scheduler dispatch guard (knowledge/operations/runbooks/low-disk.md)
const LOW_DISK_WARNING_BYTES = 10 * 1024 ** 3; // 10 GiB headroom warning
const LOW_DISK_WARNING_PERCENT = 10;
const CHECKPOINT_QUOTA_BYTES = 256 * 1024 ** 2; // 256 MiB
const DIAGNOSTIC_LOG_QUOTA_BYTES = 20 * 1024 ** 2; // 20 MiB
const PROVIDER_PROBE_CONCURRENCY = 3;

const EMBEDDING_ASSETS: readonly (readonly [string, number, string])[] = [
  ["config.json", 1216, "e426aa684c7f9a95c5f020aa855faf93a24f065f5fad0c9e17b124670cabdea6"],
  ["tokenizer.json", 2561316, "b01c78a902aa4facb2f47f95449f48e2f7bbfea5d2472ee2f6ce92323c6f86e5"],
  [
    "tokenizer_config.json",
    493,
    "f477aeb15ff9f78d3c1ddf2361d2b0b8b20cf55220f839f29a37f3a18efddd89",
  ],
  [
    "special_tokens_map.json",
    280,
    "06e405a36dfe4b9604f484f6a1e619af1a7f7d09e34a8555eb0b77b66318067f",
  ],
  ["README.md", 7439, "d3fcc84f4fa0b18b54e54a62171b7bb363109e776226edd02c96e105c097f494"],
  [
    "onnx/model_quantized.onnx",
    161895621,
    "ed45870251c9f0cf656e78aab0d37a23489066df8a222bb1c8caf8a45f2cb16d",
  ],
];

interface HealthGatewayInfo {
  appVersion: string;
  gatewayVersion: number;
  pid: number;
  origin: string | null;
  webServerEnabled: boolean;
  requirePairing: boolean;
  startedAt: string;
  installMode: "managed" | "source";
}

export interface HealthProviderDescriptor {
  id: string;
  name: string;
  primary: boolean;
  enabled: boolean;
  configured: boolean;
  commandDrifted: boolean;
  commandLabel: string;
}

interface HealthSchedulerSnapshot {
  status: SchedulerStatus;
  error: string | null;
  recentLowDiskCount: number;
  recentFailedCount: number;
}

export interface HealthCheckPorts {
  env: Readonly<NodeJS.ProcessEnv>;
  now?: () => Date;
  gateway(): HealthGatewayInfo;
  appSnapshot(): Snapshot;
  schedulerStatus(): Promise<HealthSchedulerSnapshot>;
  providers(): HealthProviderDescriptor[];
  refreshPath(signal: AbortSignal): Promise<boolean>;
  detectProvider(id: string, signal: AbortSignal): Promise<void>;
  probeProvider(id: string, signal: AbortSignal): Promise<void>;
  gitVersion?(signal: AbortSignal): Promise<string | null>;
  projectGitStatuses?(): Promise<
    Array<{
      id: string;
      label: string;
      status: "ready" | "no_commits" | "not_repository" | "error";
    }>
  >;
  memorySnapshot(): Promise<MemorySnapshot>;
  ragStatus(): Promise<{ status: RagStatus; modelRoot: string }>;
  mcpSummary(): Promise<{
    targetCount: number;
    unavailableProjects: number;
    recoveryPending: number;
    issueCount: number;
  }>;
  keyringAvailable?(): Promise<boolean>;
  logStatus(): LogStatus;
  machineInfo?: () => Promise<PlatformMachineInfo>;
  volumeSpace?: (inputs: readonly VolumeProbeInput[]) => Promise<VolumeProbeResult[]>;
  auditPrivateDir?: typeof inspectPrivateDirectorySafety;
  directorySize?: typeof boundedDirectorySize;
  verifyEmbeddingAssets?: (
    modelRoot: string,
    verifyHashes: boolean,
    signal: AbortSignal,
  ) => Promise<{
    present: number;
    total: number;
    verifiedHashes: boolean;
    mismatched: string[];
  }>;
}

interface CheckMeta {
  id: HealthCheckId;
  group: HealthGroupId;
  title: string;
  question: string;
  mode: HealthCheckMode;
  deepLink?: HealthDeepLink;
}

const CHECK_CATALOG: readonly CheckMeta[] = [
  {
    id: "backend-connection",
    group: "services",
    title: "Backend server connection",
    question: "Is Code60 connected to the backend server?",
    mode: "passive",
    deepLink: { kind: "page", id: "system-manager", label: "System Manager" },
  },
  {
    id: "backend-version",
    group: "services",
    title: "Backend version compatibility",
    question: "Does the backend service have a compatible version?",
    mode: "passive",
    deepLink: { kind: "settings", id: "updates", label: "Updates" },
  },
  {
    id: "mcp-gateway",
    group: "services",
    title: "Local MCP gateway",
    question: "Is the local MCP gateway protocol ready?",
    mode: "passive",
    deepLink: { kind: "page", id: "mcp-servers", label: "MCP Servers" },
  },
  {
    id: "scheduler-status",
    group: "scheduler",
    title: "Scheduler running & version",
    question: "Is the scheduler running, which version is it, and does the version match?",
    mode: "passive",
    deepLink: { kind: "page", id: "system-manager", label: "System Manager" },
  },
  {
    id: "scheduler-registration",
    group: "scheduler",
    title: "Background service registration",
    question: "Is the OS background service installed and active?",
    mode: "passive",
    deepLink: { kind: "page", id: "system-manager", label: "System Manager" },
  },
  {
    id: "scheduler-health",
    group: "scheduler",
    title: "Scheduled jobs state",
    question: "Are scheduled jobs running cleanly without blocks or low-disk skips?",
    mode: "passive",
    deepLink: { kind: "page", id: "automations", label: "Scheduled Jobs" },
  },
  {
    id: "providers-installed",
    group: "providers",
    title: "Installed providers",
    question: "Which providers are installed?",
    mode: "passive",
    deepLink: { kind: "page", id: "providers", label: "Providers" },
  },
  {
    id: "providers-authenticated",
    group: "providers",
    title: "Authenticated providers",
    question: "Which providers are authenticated?",
    mode: "active",
    deepLink: { kind: "page", id: "providers", label: "Providers" },
  },
  {
    id: "git-toolchain",
    group: "providers",
    title: "Git & worktree readiness",
    question: "Is Git installed and are open projects ready for worktrees?",
    mode: "passive",
    deepLink: { kind: "page", id: "chat", label: "Chat" },
  },
  {
    id: "relay-health",
    group: "workspace",
    title: "Relay & history journal",
    question: "Is Relay connected and saving history cleanly?",
    mode: "passive",
    deepLink: { kind: "relay", id: "relay", label: "Relay" },
  },
  {
    id: "database-health",
    group: "workspace",
    title: "Project database",
    question: "Is the project database connected and healthy?",
    mode: "passive",
    deepLink: { kind: "page", id: "chat", label: "Chat" },
  },
  {
    id: "storage-safety",
    group: "workspace",
    title: "Private storage & recovery safety",
    question: "Are Code60 private state directories safe and free of pending recoveries?",
    mode: "passive",
    deepLink: { kind: "page", id: "logs", label: "Logs" },
  },
  {
    id: "memory-health",
    group: "subsystems",
    title: "Memory service",
    question: "Is local agent memory healthy?",
    mode: "passive",
    deepLink: { kind: "settings", id: "memory", label: "Memory" },
  },
  {
    id: "embeddings-rag",
    group: "subsystems",
    title: "Bundled embeddings & RAG",
    question: "Are the offline embedding model and RAG index intact?",
    mode: "passive",
    deepLink: { kind: "page", id: "rag", label: "Retrieval Tests" },
  },
  {
    id: "mcp-servers",
    group: "subsystems",
    title: "MCP servers & credentials",
    question: "Are MCP server configurations valid and free of recovery blocks?",
    mode: "passive",
    deepLink: { kind: "page", id: "mcp-servers", label: "MCP Servers" },
  },
  {
    id: "disk-space",
    group: "storage",
    title: "Machine disk space",
    question: "How much disk space does this machine have?",
    mode: "passive",
  },
  {
    id: "code60-quotas",
    group: "storage",
    title: "Code60 storage & worker capacity",
    question: "How much storage is Code60 using, and is worker capacity available?",
    mode: "passive",
    deepLink: { kind: "page", id: "worktrees", label: "Worktrees" },
  },
  {
    id: "diagnostic-logs",
    group: "storage",
    title: "Diagnostic log store",
    question: "Is diagnostic log capture working without drops or errors?",
    mode: "passive",
    deepLink: { kind: "page", id: "logs", label: "Logs" },
  },
];

function defaultCheckItem(meta: CheckMeta): HealthCheckItem {
  return {
    id: meta.id,
    group: meta.group,
    title: meta.title,
    question: meta.question,
    mode: meta.mode,
    status: "not_checked",
    summary:
      meta.mode === "active"
        ? "Run an active probe to test live authentication."
        : "Not checked yet.",
    checkedAt: null,
    running: false,
    ...(meta.deepLink ? { deepLink: meta.deepLink } : {}),
  };
}

function formatGiB(bytes: number): string {
  const gib = bytes / 1024 ** 3;
  return `${gib >= 100 ? gib.toFixed(0) : gib >= 10 ? gib.toFixed(1) : gib.toFixed(2)} GiB`;
}

function formatMiB(bytes: number): string {
  const mib = bytes / 1024 ** 2;
  return `${mib >= 100 ? mib.toFixed(0) : mib >= 10 ? mib.toFixed(1) : mib.toFixed(2)} MiB`;
}

async function defaultGitVersion(
  env: Readonly<NodeJS.ProcessEnv>,
  signal: AbortSignal,
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["--version"], {
      env,
      timeout: 3_000,
      maxBuffer: 4096,
      signal,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function defaultVerifyEmbeddingAssets(
  modelRoot: string,
  verifyHashes: boolean,
  signal: AbortSignal,
) {
  const base = join(modelRoot, BUNDLED_EMBEDDING_MODEL.id);
  let present = 0;
  const mismatched: string[] = [];
  for (const [relativePath, expectedSize, expectedHash] of EMBEDDING_ASSETS) {
    signal.throwIfAborted();
    const full = join(base, relativePath);
    try {
      const info = await stat(full);
      if (!info.isFile()) {
        mismatched.push(relativePath);
        continue;
      }
      if (info.size !== expectedSize) {
        mismatched.push(relativePath);
        continue;
      }
      if (verifyHashes) {
        const hash = createHash("sha256");
        for await (const chunk of createReadStream(full)) {
          signal.throwIfAborted();
          hash.update(chunk);
        }
        if (hash.digest("hex") !== expectedHash) {
          mismatched.push(relativePath);
          continue;
        }
      }
      present++;
    } catch {
      mismatched.push(relativePath);
    }
  }
  return { present, total: EMBEDDING_ASSETS.length, verifiedHashes: verifyHashes, mismatched };
}

export function buildProviderDescriptors(
  snapshot: Snapshot,
  commandFor: (id: string) => readonly [string, ...string[]] | undefined,
  savedCommands: Readonly<Record<string, string>> | undefined,
): HealthProviderDescriptor[] {
  const setup = snapshot.agentSetup;
  const enabled = new Set(setup?.enabled ?? []);
  const primary = setup?.primary ?? null;
  const descriptors: HealthProviderDescriptor[] = [];
  for (const provider of PROVIDERS) {
    const command = commandFor(provider.id) ?? provider.command;
    const saved = savedCommands?.[provider.id];
    const drifted = Boolean(saved && command && commandIdentity(command) !== saved);
    descriptors.push({
      id: provider.id,
      name: provider.name,
      primary: primary === provider.id,
      enabled: enabled.has(provider.id),
      configured: Boolean(command),
      commandDrifted: drifted,
      commandLabel: command[0],
    });
  }
  return descriptors;
}

export class HealthCheckService {
  private readonly checks = new Map<HealthCheckId, HealthCheckItem>();
  private readonly flights = new Map<string, AbortController>();
  private readonly listeners = new Set<(snapshot: HealthSnapshot) => void>();
  private environment: HealthEnvironmentContext;
  private revision = 0;
  private pathRecovered = false;
  private disposed = false;

  constructor(private readonly ports: HealthCheckPorts) {
    for (const meta of CHECK_CATALOG) this.checks.set(meta.id, defaultCheckItem(meta));
    this.environment = this.initialEnvironment();
  }

  private nowIso(): string {
    return (this.ports.now?.() ?? new Date()).toISOString();
  }

  private initialEnvironment(): HealthEnvironmentContext {
    const gateway = this.ports.gateway();
    const app = this.ports.appSnapshot();
    const versions = app.versions;
    return {
      collectedAt: this.nowIso(),
      platform: process.platform,
      osName: process.platform,
      osRelease: "",
      arch: process.arch,
      cpuModel: "",
      cpuCores: 0,
      totalMemoryBytes: 0,
      freeMemoryBytes: 0,
      uptimeSeconds: 0,
      timeZone: "UTC",
      localTimeIso: this.nowIso(),
      code60Version: gateway.appVersion,
      gatewayVersion: gateway.gatewayVersion,
      nodeVersion: versions?.node ?? process.versions.node,
      installMode: gateway.installMode,
      acpProtocol: versions?.acpProtocol !== undefined ? String(versions.acpProtocol) : "Unknown",
      mcpProtocol: versions?.mcpProtocol ?? "Unknown",
      databaseSchema:
        versions?.databaseSchema !== undefined ? String(versions.databaseSchema) : "Unknown",
      runRecordFormat:
        versions?.runRecordFormat !== undefined ? String(versions.runRecordFormat) : "Unknown",
      embeddingModelId: versions?.embeddingModel?.id ?? BUNDLED_EMBEDDING_MODEL.id,
      onnxRuntime: versions?.onnxRuntime
        ? `${versions.onnxRuntime.name} ${versions.onnxRuntime.version} (${versions.onnxRuntime.execution})`
        : null,
      shell: this.ports.env.SHELL ?? null,
      pathRecovered: this.pathRecovered,
      databaseConnected: Boolean(app.database),
      openProjectCount: app.openProjects?.length ?? 0,
      activeWorkerCount: app.liveIds.length,
      webServerEnabled: gateway.webServerEnabled,
      requirePairing: gateway.requirePairing,
      host: {
        hostname: "",
        localAddresses: [],
        primaryPrivateIPv4: null,
        proxyConfigured: false,
        proxySummary: null,
        backendOrigin: gateway.origin,
        stateRoot: join(stateHome(this.ports.env), "code60"),
        databaseLabel: app.database ? basename(app.database) : null,
      },
    };
  }

  private async refreshEnvironment(): Promise<void> {
    const gateway = this.ports.gateway();
    const app = this.ports.appSnapshot();
    const versions = app.versions;
    const machine = await (
      this.ports.machineInfo ?? (() => readMachineInfo(this.ports.env))
    )().catch(() => null);
    this.environment = {
      collectedAt: this.nowIso(),
      platform: machine?.platform ?? process.platform,
      osName: machine?.osName ?? process.platform,
      osRelease: machine?.osRelease ?? "",
      arch: machine?.arch ?? process.arch,
      cpuModel: machine?.cpuModel ?? "Unknown CPU",
      cpuCores: machine?.cpuCores ?? 0,
      totalMemoryBytes: machine?.totalMemoryBytes ?? 0,
      freeMemoryBytes: machine?.freeMemoryBytes ?? 0,
      uptimeSeconds: machine?.uptimeSeconds ?? 0,
      timeZone: machine?.timeZone ?? "UTC",
      localTimeIso: machine?.localTimeIso ?? this.nowIso(),
      code60Version: gateway.appVersion,
      gatewayVersion: gateway.gatewayVersion,
      nodeVersion: versions?.node ?? process.versions.node,
      installMode: gateway.installMode,
      acpProtocol: versions?.acpProtocol !== undefined ? String(versions.acpProtocol) : "Unknown",
      mcpProtocol: versions?.mcpProtocol ?? "Unknown",
      databaseSchema:
        versions?.databaseSchema !== undefined ? String(versions.databaseSchema) : "Unknown",
      runRecordFormat:
        versions?.runRecordFormat !== undefined ? String(versions.runRecordFormat) : "Unknown",
      embeddingModelId: versions?.embeddingModel?.id ?? BUNDLED_EMBEDDING_MODEL.id,
      onnxRuntime: versions?.onnxRuntime
        ? `${versions.onnxRuntime.name} ${versions.onnxRuntime.version} (${versions.onnxRuntime.execution})`
        : null,
      shell: this.ports.env.SHELL ?? null,
      pathRecovered: this.pathRecovered,
      databaseConnected: Boolean(app.database),
      openProjectCount: app.openProjects?.length ?? 0,
      activeWorkerCount: app.liveIds.length,
      webServerEnabled: gateway.webServerEnabled,
      requirePairing: gateway.requirePairing,
      host: {
        hostname: machine?.hostname ?? "",
        localAddresses: machine?.localAddresses ?? [],
        primaryPrivateIPv4: machine?.primaryPrivateIPv4 ?? null,
        proxyConfigured: machine?.proxyConfigured ?? false,
        proxySummary: machine?.proxySummary ?? null,
        backendOrigin: gateway.origin,
        stateRoot: join(stateHome(this.ports.env), "code60"),
        databaseLabel: app.database ? basename(app.database) : null,
      },
    };
  }

  subscribe(listener: (snapshot: HealthSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  snapshot(): HealthSnapshot {
    const checks = HEALTH_CHECK_IDS.map((id) => structuredClone(this.checks.get(id)!));
    const runningCount = checks.filter(
      (check) => check.running || check.targets?.some((target) => target.running),
    ).length;
    return {
      revision: this.revision,
      generatedAt: this.nowIso(),
      runningCount,
      environment: structuredClone(this.environment),
      checks,
    };
  }

  private publish(): void {
    if (this.disposed) return;
    this.revision++;
    const current = this.snapshot();
    for (const listener of this.listeners) {
      try {
        listener(current);
      } catch {
        /* Isolate listener errors from health-check orchestration. */
      }
    }
  }

  cancel(checkId?: HealthCheckId, targetId?: string): HealthSnapshot {
    if (!checkId) {
      for (const controller of this.flights.values()) controller.abort(new Error("Cancelled"));
      this.flights.clear();
      for (const item of this.checks.values()) {
        item.running = false;
        if (item.status === "running") item.status = item.checkedAt ? "warning" : "not_checked";
        for (const target of item.targets ?? []) {
          target.running = false;
          if (target.status === "running")
            target.status = target.checkedAt ? "warning" : "not_checked";
        }
      }
      this.publish();
      return this.snapshot();
    }
    const prefix = targetId ? `${checkId}:${targetId}` : checkId;
    for (const [key, controller] of this.flights) {
      if (key === prefix || (!targetId && key.startsWith(`${checkId}:`))) {
        controller.abort(new Error("Cancelled"));
        this.flights.delete(key);
      }
    }
    const item = this.checks.get(checkId);
    if (item) {
      if (targetId && item.targets) {
        const target = item.targets.find((entry) => entry.id === targetId);
        if (target) {
          target.running = false;
          if (target.status === "running")
            target.status = target.checkedAt ? "warning" : "not_checked";
        }
        item.running = item.targets.some((entry) => entry.running);
        if (!item.running)
          item.status = rollupHealthStatus(item.targets.map((entry) => entry.status));
      } else {
        item.running = false;
        if (item.status === "running") item.status = item.checkedAt ? "warning" : "not_checked";
        for (const target of item.targets ?? []) {
          target.running = false;
          if (target.status === "running")
            target.status = target.checkedAt ? "warning" : "not_checked";
        }
      }
      this.publish();
    }
    return this.snapshot();
  }

  dispose(): void {
    this.disposed = true;
    for (const controller of this.flights.values()) controller.abort(new Error("Disposed"));
    this.flights.clear();
    this.listeners.clear();
  }

  async handle(request: HealthCheckRequest): Promise<HealthSnapshot> {
    if (request.action === "snapshot") {
      await this.refreshEnvironment();
      return this.snapshot();
    }
    if (request.action === "cancel") {
      return this.cancel(request.checkId, request.targetId);
    }
    return this.run(request.scope);
  }

  async run(scope: HealthRunScope): Promise<HealthSnapshot> {
    await this.refreshEnvironment();
    if (scope.kind === "check") {
      await this.runSingleCheck(scope.checkId, scope.targetId, true);
      return this.snapshot();
    }
    const includeActive = scope.includeActive === true;
    const selected = CHECK_CATALOG.filter((meta) => {
      if (scope.kind === "group" && meta.group !== scope.groupId) return false;
      if (!includeActive && meta.mode === "active") return false;
      return true;
    });
    const tasks = selected.map((meta) => this.runSingleCheck(meta.id, undefined, includeActive));
    await Promise.allSettled(tasks);
    return this.snapshot();
  }

  private async runSingleCheck(
    checkId: HealthCheckId,
    targetId: string | undefined,
    allowActive: boolean,
  ): Promise<void> {
    if (this.disposed) return;
    if (checkId === "providers-authenticated") {
      await this.runProviderAuthCheck(targetId);
      return;
    }
    const flightKey = targetId ? `${checkId}:${targetId}` : checkId;
    if (this.flights.has(flightKey)) return;
    const abort = new AbortController();
    this.flights.set(flightKey, abort);
    const current = this.checks.get(checkId);
    if (!current) {
      this.flights.delete(flightKey);
      return;
    }
    const started = Date.now();
    current.running = true;
    if (current.status === "not_checked") current.status = "running";
    this.publish();
    const timeoutMs = checkId === "embeddings-rag" && allowActive ? 30_000 : 6_000;
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(timeoutMs)]);
    try {
      const update = await this.executeCheck(checkId, targetId, allowActive, signal);
      if (abort.signal.aborted || this.disposed) return;
      const item = this.checks.get(checkId);
      if (!item) return;
      Object.assign(item, update, {
        running: false,
        checkedAt: this.nowIso(),
        durationMs: Math.max(0, Date.now() - started),
      });
    } catch (error) {
      if (abort.signal.aborted || this.disposed) return;
      const item = this.checks.get(checkId);
      if (!item) return;
      item.running = false;
      item.status = "unavailable";
      item.summary = "Check could not be completed.";
      item.detail = diagnosticMessage(error);
      item.checkedAt = this.nowIso();
      item.durationMs = Math.max(0, Date.now() - started);
    } finally {
      if (this.flights.get(flightKey) === abort) this.flights.delete(flightKey);
      this.publish();
    }
  }

  private async runProviderAuthCheck(targetId?: string): Promise<void> {
    const item = this.checks.get("providers-authenticated");
    if (!item) return;
    const descriptors = this.ports.providers();
    const existingTargets = new Map((item.targets ?? []).map((entry) => [entry.id, entry]));
    const installedSnapshot = this.checks.get("providers-installed")?.targets;
    const installedSet = installedSnapshot
      ? new Set(
          installedSnapshot
            .filter((entry) => entry.status === "healthy" || entry.status === "warning")
            .map((entry) => entry.id),
        )
      : null;

    const targets: HealthCheckTarget[] = descriptors.map((provider) => {
      const prev = existingTargets.get(provider.id);
      return (
        prev ?? {
          id: provider.id,
          label: provider.primary ? `${provider.name} (Primary)` : provider.name,
          status: "not_checked",
          summary: provider.enabled
            ? "Verified in setup. Click Test auth to probe live ACP authentication."
            : "Click Test auth to probe ACP authentication.",
          checkedAt: null,
          running: false,
          canRun: true,
          runLabel: "Test auth",
          metrics: {
            primary: provider.primary,
            enabled: provider.enabled,
            commandDrifted: provider.commandDrifted,
          },
        }
      );
    });
    item.targets = targets;

    const toProbe = targetId
      ? descriptors.filter((provider) => provider.id === targetId)
      : descriptors.filter(
          (provider) => !installedSet || installedSet.has(provider.id) || provider.enabled,
        );

    if (!toProbe.length) {
      item.status = "not_configured";
      item.summary = "No installed providers were found to probe for authentication.";
      item.checkedAt = this.nowIso();
      item.running = false;
      this.publish();
      return;
    }

    const runOne = async (provider: HealthProviderDescriptor) => {
      const key = `providers-authenticated:${provider.id}`;
      if (this.flights.has(key)) return;
      const abort = new AbortController();
      this.flights.set(key, abort);
      const target = item.targets?.find((entry) => entry.id === provider.id);
      if (!target) {
        this.flights.delete(key);
        return;
      }
      const started = Date.now();
      target.running = true;
      target.status = "running";
      target.summary = "Probing ACP authentication…";
      item.running = true;
      this.publish();
      const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(15_000)]);
      try {
        await this.ports.detectProvider(provider.id, signal);
        await this.ports.probeProvider(provider.id, signal);
        if (abort.signal.aborted || this.disposed) return;
        target.status = provider.commandDrifted ? "warning" : "healthy";
        target.summary = provider.commandDrifted
          ? "Authenticated via ACP, but launch command drifted from saved setup."
          : provider.enabled
            ? "Authenticated and enabled."
            : "Authenticated via ACP (not yet added in Providers).";
        delete target.detail;
      } catch (error) {
        if (abort.signal.aborted || this.disposed) return;
        const message = diagnosticMessage(error);
        const missing = /not found/i.test(message);
        target.status = missing ? "not_configured" : provider.enabled ? "error" : "warning";
        target.summary = missing
          ? "Provider executable not installed."
          : "Authentication or ACP handshake failed.";
        target.detail = message;
      } finally {
        if (this.flights.get(key) === abort) this.flights.delete(key);
        target.running = false;
        target.checkedAt = this.nowIso();
        target.durationMs = Math.max(0, Date.now() - started);
        item.running = Boolean(item.targets?.some((entry) => entry.running));
        const evaluated = (item.targets ?? []).filter((entry) => entry.status !== "not_checked");
        const authenticatedCount = evaluated.filter(
          (entry) => entry.status === "healthy" || entry.status === "warning",
        ).length;
        const enabledFailed = (item.targets ?? []).some(
          (entry) => entry.metrics?.enabled === true && entry.status === "error",
        );
        item.status = item.running
          ? "running"
          : enabledFailed
            ? "error"
            : authenticatedCount > 0
              ? "healthy"
              : evaluated.length > 0
                ? "warning"
                : "not_checked";
        item.summary =
          authenticatedCount > 0
            ? `${authenticatedCount} of ${evaluated.length} probed provider(s) authenticated.`
            : evaluated.length > 0
              ? "No probed providers passed ACP authentication."
              : "Run an active probe to test live authentication.";
        item.checkedAt = this.nowIso();
        this.publish();
      }
    };

    // Bounded concurrency for ACP subprocess probes.
    let cursor = 0;
    const workers = Array.from(
      { length: Math.min(PROVIDER_PROBE_CONCURRENCY, toProbe.length) },
      async () => {
        while (cursor < toProbe.length) {
          const next = toProbe[cursor++];
          if (next) await runOne(next);
        }
      },
    );
    await Promise.allSettled(workers);
  }

  private async executeCheck(
    checkId: HealthCheckId,
    targetId: string | undefined,
    allowActive: boolean,
    signal: AbortSignal,
  ): Promise<Partial<HealthCheckItem>> {
    switch (checkId) {
      case "backend-connection": {
        const gateway = this.ports.gateway();
        return {
          status: "healthy",
          summary: `Connected to Code60 backend (PID ${gateway.pid}).`,
          detail: `Started ${gateway.startedAt}. Pairing ${gateway.requirePairing ? "required" : "optional"}; Web Server (Beta) ${gateway.webServerEnabled ? "enabled" : "disabled"}.`,
          ...(gateway.origin ? { hostDetail: `Origin ${gateway.origin}` } : {}),
        };
      }

      case "backend-version": {
        const gateway = this.ports.gateway();
        return {
          status: "healthy",
          summary: `Backend ${gateway.appVersion} (Gateway protocol v${gateway.gatewayVersion}).`,
          detail: `Build mode: ${gateway.installMode}. Client compatibility is verified by the browser against this version.`,
        };
      }

      case "mcp-gateway": {
        const app = this.ports.appSnapshot();
        const protocol = app.versions?.mcpProtocol ?? "Unknown";
        return {
          status: "healthy",
          summary: `Local MCP gateway ready (protocol ${protocol}).`,
          detail: "Scoped per-conversation loopback 127.0.0.1 gateways are created on demand.",
        };
      }

      case "scheduler-status": {
        const sched = await this.ports.schedulerStatus();
        const service = sched.status.service;
        if (sched.error && !service) {
          return {
            status: "error",
            summary: "Scheduler is not running or failed to initialize.",
            detail: sched.error,
          };
        }
        if (!service) {
          return {
            status: "unavailable",
            summary: "Scheduler is not running.",
            detail: "Start the backend service with code60 service start.",
          };
        }
        const versionMatches = service.appVersion === CODE60_VERSION;
        return {
          status: versionMatches ? "healthy" : "warning",
          summary: versionMatches
            ? `Running v${service.appVersion} (protocol v${service.version}, PID ${service.pid}) — matches Code60.`
            : `Running v${service.appVersion}, which does not match Code60 v${CODE60_VERSION}.`,
          detail: versionMatches
            ? `Started ${service.startedAt}.`
            : "Run code60 service repair in a terminal to align the background service with this Code60 version.",
        };
      }

      case "scheduler-registration": {
        const sched = await this.ports.schedulerStatus();
        const { installed, nativeState } = sched.status;
        if (installed && nativeState === "running") {
          return {
            status: "healthy",
            summary: "OS login background service is installed and running.",
            detail: "Managed via per-user launchd / systemd without linger.",
          };
        }
        if (!installed) {
          return {
            status: "not_configured",
            summary: "Login background service is not installed (running in foreground session).",
            detail:
              "Install with code60 service install if you want scheduled jobs after closing the terminal.",
          };
        }
        return {
          status: nativeState === "stopped" ? "warning" : "unavailable",
          summary:
            nativeState === "stopped"
              ? "OS background service is installed but currently stopped."
              : "OS background service status could not be verified.",
          detail: "Inspect with code60 service status or repair with code60 service repair.",
        };
      }

      case "scheduler-health": {
        const sched = await this.ports.schedulerStatus();
        const service = sched.status.service;
        if (!service) {
          return {
            status: "unavailable",
            summary: "Scheduler state unavailable.",
            detail: sched.error ?? "Background scheduler is not active.",
          };
        }
        if (service.block) {
          return {
            status: "error",
            summary:
              service.block.reason === "leftover_agent"
                ? "Blocked by an unfinished scheduled agent process."
                : "Blocked by a scheduler state persistence failure.",
            detail: "Open Apps → System Manager to inspect and recheck once resolved.",
          };
        }
        if (sched.recentLowDiskCount > 0) {
          return {
            status: "warning",
            summary: `${sched.recentLowDiskCount} recent scheduled run(s) skipped due to low disk space (< 2 GiB).`,
            detail: "Free disk space on the state and repository volumes before resuming jobs.",
          };
        }
        if (service.pausedAll) {
          return {
            status: "warning",
            summary: "All scheduled jobs are currently paused.",
            detail: "Resume jobs in Apps → System Manager when ready.",
          };
        }
        if (sched.recentFailedCount > 0) {
          return {
            status: "warning",
            summary: `Scheduler active; ${sched.recentFailedCount} recent failed/interrupted execution(s).`,
            detail: "Inspect execution history in Apps → Scheduled Jobs.",
          };
        }
        return {
          status: "healthy",
          summary: service.activeExecutionId
            ? "Scheduler healthy; one scheduled job is currently running."
            : "Scheduler healthy; no blocks or paused jobs.",
        };
      }

      case "providers-installed": {
        this.pathRecovered = await this.ports.refreshPath(signal).catch(() => false);
        const descriptors = this.ports.providers();
        const filterOne = targetId
          ? descriptors.filter((provider) => provider.id === targetId)
          : descriptors;
        const existingTargets = new Map(
          (this.checks.get("providers-installed")?.targets ?? []).map((entry) => [entry.id, entry]),
        );

        const evaluated = await Promise.all(
          descriptors.map(async (provider): Promise<HealthCheckTarget> => {
            if (targetId && provider.id !== targetId) {
              const previous = existingTargets.get(provider.id);
              if (previous) return previous;
            }
            if (!filterOne.some((entry) => entry.id === provider.id)) {
              return {
                id: provider.id,
                label: provider.primary ? `${provider.name} (Primary)` : provider.name,
                status: "not_checked",
                summary: "Not checked yet.",
                checkedAt: null,
                running: false,
                canRun: true,
                runLabel: "Recheck",
              };
            }
            const started = Date.now();
            try {
              await this.ports.detectProvider(provider.id, signal);
              return {
                id: provider.id,
                label: provider.primary ? `${provider.name} (Primary)` : provider.name,
                status: provider.commandDrifted ? "warning" : "healthy",
                summary: provider.commandDrifted
                  ? `Installed (${provider.commandLabel}), but launch command drifted from saved setup.`
                  : provider.enabled
                    ? `Installed and enabled (${provider.commandLabel}).`
                    : `Installed (${provider.commandLabel}); not yet added in Providers.`,
                checkedAt: this.nowIso(),
                durationMs: Math.max(0, Date.now() - started),
                running: false,
                canRun: true,
                runLabel: "Recheck",
                metrics: {
                  installed: true,
                  enabled: provider.enabled,
                  primary: provider.primary,
                  commandDrifted: provider.commandDrifted,
                },
              };
            } catch (error) {
              return {
                id: provider.id,
                label: provider.primary ? `${provider.name} (Primary)` : provider.name,
                status: provider.enabled ? "error" : "not_configured",
                summary: provider.enabled
                  ? "Enabled in setup, but executable was not found on PATH."
                  : "Not installed.",
                detail: diagnosticMessage(error),
                checkedAt: this.nowIso(),
                durationMs: Math.max(0, Date.now() - started),
                running: false,
                canRun: true,
                runLabel: "Recheck",
                metrics: {
                  installed: false,
                  enabled: provider.enabled,
                  primary: provider.primary,
                },
              };
            }
          }),
        );

        const installedNames = evaluated
          .filter((entry) => entry.metrics?.installed === true)
          .map((entry) => entry.label);
        const missingEnabled = evaluated.filter(
          (entry) => entry.metrics?.enabled === true && entry.metrics?.installed === false,
        );
        const drifted = evaluated.filter((entry) => entry.metrics?.commandDrifted === true);
        const primary = descriptors.find((provider) => provider.primary);
        const status: HealthStatus =
          missingEnabled.length > 0
            ? "error"
            : installedNames.length === 0 || drifted.length > 0 || !primary
              ? "warning"
              : "healthy";
        const summary =
          installedNames.length > 0
            ? `${installedNames.length} of ${descriptors.length} installed: ${installedNames.join(", ")}.`
            : "No supported agent providers were detected on PATH.";
        const detail =
          missingEnabled.length > 0
            ? `Enabled provider(s) missing: ${missingEnabled.map((entry) => entry.label).join(", ")}.`
            : !primary
              ? "No primary provider is configured yet. Open Providers to finish setup."
              : `Primary provider: ${primary.name}.`;
        return { status, summary, detail, targets: evaluated };
      }

      case "git-toolchain": {
        const version = await (
          this.ports.gitVersion ?? ((s: AbortSignal) => defaultGitVersion(this.ports.env, s))
        )(signal);
        if (!version) {
          return {
            status: "error",
            summary: "Git was not found on PATH.",
            detail: "Git is required for isolated project worktrees and workflows.",
          };
        }
        const projects = await (this.ports.projectGitStatuses?.() ?? Promise.resolve([]));
        const notReady = projects.filter((project) => project.status !== "ready");
        if (!projects.length) {
          return {
            status: "healthy",
            summary: `${version} installed. No open projects to check.`,
          };
        }
        if (notReady.length > 0) {
          return {
            status: "warning",
            summary: `${version} installed; ${notReady.length} of ${projects.length} open project(s) need Git setup.`,
            detail: notReady
              .map((project) => `${project.label}: ${project.status.replaceAll("_", " ")}`)
              .join("; "),
          };
        }
        return {
          status: "healthy",
          summary: `${version} installed; all ${projects.length} open project(s) are Git-ready.`,
        };
      }

      case "relay-health": {
        const app = this.ports.appSnapshot();
        const relay = app.chats.find((chat) => chat.kind === "relay");
        if (!relay) {
          return {
            status: "not_configured",
            summary: "Relay conversation is not initialized yet.",
            detail: "Configure a primary provider in Providers to connect Relay.",
          };
        }
        const runStatus = relay.run?.status ?? "disconnected";
        const historyIssue =
          relay.historySaving === "unavailable" || relay.history?.incomplete === true;
        if (relay.error || runStatus === "failed") {
          return {
            status: "error",
            summary: "Relay reported an error.",
            detail: relay.error ?? "Open Relay to inspect and retry connection.",
          };
        }
        if (historyIssue) {
          return {
            status: "warning",
            summary: `Relay is ${runStatus}, with a history-saving warning or recorded gap.`,
            detail:
              relay.historySaving === "unavailable"
                ? "Relay history saving is currently unavailable. See knowledge/operations/runbooks/relay-history.md."
                : "A historical gap is recorded in the Relay journal. See knowledge/operations/runbooks/relay-history.md.",
          };
        }
        if (!relay.run) {
          return {
            status: "warning",
            summary: "Relay is currently disconnected.",
            detail: "Open Relay to reconnect when ready.",
          };
        }
        return {
          status: "healthy",
          summary: `Relay is ${runStatus} and saving history cleanly.`,
        };
      }

      case "database-health": {
        const app = this.ports.appSnapshot();
        if (app.databaseError) {
          return {
            status: "error",
            summary: "Project database reported an error.",
            detail: app.databaseError,
          };
        }
        if (!app.database) {
          return {
            status: "not_configured",
            summary: "No project database is currently connected.",
            detail:
              "Relay, Providers, Workflows, Scheduled Jobs and Health Check work without a database.",
          };
        }
        const openCount = app.openProjects?.length ?? 0;
        const missingWarnings = app.warnings.filter((warning) =>
          /missing|unavailable/i.test(warning),
        );
        const firstWarning = missingWarnings[0];
        if (firstWarning) {
          return {
            status: "warning",
            summary: `Connected (schema ${app.versions?.databaseSchema ?? "5"}), ${openCount} open project(s) with folder warning(s).`,
            detail: firstWarning,
            hostDetail: `Database file: ${basename(app.database)}`,
          };
        }
        return {
          status: "healthy",
          summary: `Connected (schema ${app.versions?.databaseSchema ?? "5"}); ${openCount} open project(s).`,
          hostDetail: `Database file: ${basename(app.database)}`,
        };
      }

      case "storage-safety": {
        const app = this.ports.appSnapshot();
        const audit = this.ports.auditPrivateDir ?? inspectPrivateDirectorySafety;
        const root = join(stateHome(this.ports.env), "code60");
        const dirs = [
          { id: "gateway", label: "Gateway state", path: join(root, "gateway") },
          { id: "relay", label: "Relay history", path: join(root, "relay") },
          { id: "logs", label: "Diagnostic logs", path: join(root, "logs") },
          { id: "automations", label: "Scheduler state", path: join(root, "automations") },
          { id: "workflows", label: "Workflow state", path: join(root, "workflows") },
        ];
        const audited = await Promise.all(
          dirs.map(async (dir) => ({ ...dir, result: await audit(dir.path) })),
        );
        const unsafe = audited.filter(
          (entry) => entry.result.status === "unsafe" || entry.result.status === "error",
        );
        const interruptedUndo = app.chats.filter((chat) => chat.checkpoint?.phase === "undoing");
        const targets: HealthCheckTarget[] = audited.map((entry) => ({
          id: entry.id,
          label: entry.label,
          status:
            entry.result.status === "ok"
              ? "healthy"
              : entry.result.status === "missing"
                ? "not_configured"
                : "error",
          summary:
            entry.result.status === "ok"
              ? "Private permissions and ownership verified."
              : entry.result.status === "missing"
                ? "Directory not created yet."
                : `Unsafe or unreadable (${entry.result.code ?? "error"}).`,
          checkedAt: this.nowIso(),
          running: false,
          canRun: false,
        }));
        if (unsafe.length > 0) {
          return {
            status: "error",
            summary: `${unsafe.length} private storage directory(s) failed safety verification.`,
            detail: unsafe
              .map((entry) => `${entry.label}: ${entry.result.code ?? entry.result.status}`)
              .join("; "),
            targets,
          };
        }
        if (interruptedUndo.length > 0) {
          return {
            status: "warning",
            summary: `${interruptedUndo.length} conversation(s) have an interrupted checkpoint/Undo recovery pending.`,
            detail: "Open the affected chat to explicitly complete recovery.",
            targets,
          };
        }
        return {
          status: "healthy",
          summary:
            "All existing private state directories passed ownership & permission checks; no pending recoveries.",
          targets,
        };
      }

      case "memory-health": {
        const memory = await raceWithSignal(this.ports.memorySnapshot(), signal);
        if (memory.warning) {
          return {
            status: "warning",
            summary: `Memory is ${memory.settings.enabled ? "On" : "Off"} with a service warning.`,
            detail: memory.warning,
          };
        }
        if (!memory.settings.enabled) {
          return {
            status: "not_configured",
            summary: `Memory is Off (${memory.count} saved record(s) preserved).`,
            detail: "Session-local continuity remains available while Memory is Off.",
          };
        }
        const retention = memory.settings.retentionDays
          ? `${memory.settings.retentionDays}-day retention`
          : "no auto-deletion";
        return {
          status: "healthy",
          summary: `Memory is On (${memory.count} record(s), ${retention}).`,
        };
      }

      case "embeddings-rag": {
        const { status: rag, modelRoot } = await this.ports.ragStatus();
        const verifier = this.ports.verifyEmbeddingAssets ?? defaultVerifyEmbeddingAssets;
        const assets = await verifier(modelRoot, allowActive, signal);
        const app = this.ports.appSnapshot();
        const onnx = app.versions?.onnxRuntime;
        if (assets.present < assets.total) {
          return {
            status: "warning",
            summary: `Bundled embedding assets incomplete (${assets.present}/${assets.total} verified).`,
            detail: `Missing or mismatched: ${assets.mismatched.join(", ")}. Run npm run prepare:models in source development.`,
          };
        }
        if (rag.error) {
          return {
            status: "warning",
            summary: "Embedding model files are intact, but the RAG index reported an error.",
            detail: rag.error,
          };
        }
        const hashNote = assets.verifiedHashes
          ? "SHA-256 checksums verified."
          : "File presence & sizes verified (run active check to verify SHA-256 checksums).";
        const ragNote = rag.index
          ? `RAG index has ${rag.index.chunks} chunk(s) across ${rag.index.conversations} conversation(s).`
          : "No manual RAG snapshot built for the current database.";
        return {
          status: onnx ? "healthy" : "warning",
          summary: onnx
            ? `Embedding model intact (${assets.present}/${assets.total}) with ${onnx.name} ${onnx.version}.`
            : `Embedding model files present (${assets.present}/${assets.total}), ONNX Runtime unavailable.`,
          detail: `${hashNote} ${ragNote}`,
        };
      }

      case "mcp-servers": {
        const mcp = await this.ports.mcpSummary();
        const keyringOk = this.ports.keyringAvailable
          ? await this.ports.keyringAvailable().catch(() => false)
          : undefined;
        if (mcp.recoveryPending > 0 || mcp.issueCount > 0) {
          return {
            status: "error",
            summary: `MCP configuration issues detected (${mcp.recoveryPending} pending recovery, ${mcp.issueCount} validation issue(s)).`,
            detail: "Open Apps → MCP Servers to inspect or complete recovery.",
          };
        }
        if (mcp.unavailableProjects > 0) {
          return {
            status: "warning",
            summary: `MCP configurations valid across ${mcp.targetCount} target(s), with ${mcp.unavailableProjects} unavailable project(s).`,
            detail: "Open Apps → MCP Servers for details.",
          };
        }
        if (keyringOk === false) {
          return {
            status: "warning",
            summary: `MCP configurations valid (${mcp.targetCount} target(s)), but OS credential store is unavailable.`,
            detail: "Servers requiring saved credentials may need temporary session storage.",
          };
        }
        return {
          status: "healthy",
          summary:
            keyringOk === true
              ? `MCP configurations valid (${mcp.targetCount} target(s)); OS credential store available.`
              : `MCP configurations valid (${mcp.targetCount} target(s)); no recovery blocks.`,
        };
      }

      case "disk-space": {
        const app = this.ports.appSnapshot();
        const inputs: VolumeProbeInput[] = [
          {
            id: "state",
            label: "Code60 state & home",
            path: join(stateHome(this.ports.env), "code60"),
          },
          ...(app.database
            ? [{ id: "database", label: "Project database", path: dirname(app.database) }]
            : []),
          ...(app.openProjects?.[0]?.path
            ? [{ id: "projects", label: "Open project volume", path: app.openProjects[0].path }]
            : []),
          { id: "temp", label: "Temporary directory", path: tmpdir() },
        ];
        const filtered = targetId ? inputs.filter((entry) => entry.id === targetId) : inputs;
        const probed = await (this.ports.volumeSpace ?? readVolumeSpace)(
          filtered.length ? filtered : inputs,
        );
        const targets: HealthCheckTarget[] = probed.map((vol) => {
          if (vol.availableBytes === null || vol.totalBytes === null) {
            return {
              id: vol.id,
              label: vol.label,
              status: "unavailable",
              summary: vol.error ?? "Disk space unavailable.",
              checkedAt: this.nowIso(),
              running: false,
              canRun: true,
              runLabel: "Recheck",
            };
          }
          const freePct = vol.freePercent ?? 0;
          const status: HealthStatus =
            vol.availableBytes < LOW_DISK_ERROR_BYTES
              ? "error"
              : vol.availableBytes < LOW_DISK_WARNING_BYTES || freePct < LOW_DISK_WARNING_PERCENT
                ? "warning"
                : "healthy";
          const shared = vol.sharedWith ? ` (same volume as ${vol.sharedWith})` : "";
          return {
            id: vol.id,
            label: vol.label,
            status,
            summary: `${formatGiB(vol.availableBytes)} free of ${formatGiB(vol.totalBytes)} (${freePct.toFixed(0)}%)${shared}`,
            ...(status === "error"
              ? { detail: "Below the 2 GiB minimum required by scheduled automations." }
              : {}),
            checkedAt: this.nowIso(),
            running: false,
            canRun: true,
            runLabel: "Recheck",
            metrics: {
              availableBytes: vol.availableBytes,
              totalBytes: vol.totalBytes,
              freePercent: Math.round(freePct),
            },
          };
        });
        const stateVol = probed.find((vol) => vol.id === "state") ?? probed[0];
        const worst = rollupHealthStatus(targets.map((entry) => entry.status));
        const summary =
          stateVol && stateVol.availableBytes !== null && stateVol.totalBytes !== null
            ? `${formatGiB(stateVol.availableBytes)} free of ${formatGiB(stateVol.totalBytes)} (${(stateVol.freePercent ?? 0).toFixed(0)}%) on primary volume.`
            : "Disk space could not be inspected.";
        const detail =
          worst === "error"
            ? "At least one volume is below the 2 GiB scheduler floor (see knowledge/operations/runbooks/low-disk.md)."
            : worst === "warning"
              ? "Disk headroom is below 10 GiB or 10% on at least one volume."
              : "Ample free space across inspected volumes (scheduler minimum: 2 GiB).";
        return { status: worst, summary, detail, targets };
      }

      case "code60-quotas": {
        const app = this.ports.appSnapshot();
        const sizeFn = this.ports.directorySize ?? boundedDirectorySize;
        const root = join(stateHome(this.ports.env), "code60");
        const logsSize = await sizeFn(
          join(root, "logs"),
          { maxEntries: 2_000, maxDepth: 3 },
          signal,
        );
        const checkpointsRoot = app.database
          ? join(dirname(app.database), ".code60_workspace", "checkpoints")
          : join(root, "relay", "checkpoints");
        const checkpointsSize = await sizeFn(
          checkpointsRoot,
          { maxEntries: 4_000, maxDepth: 4 },
          signal,
        );
        const worktreeCount = app.worktrees?.worktrees.length ?? 0;
        const activeWorkers = app.liveIds.length;
        const maxParallel = app.maxParallel;
        const nearCheckpointCap = checkpointsSize.bytes >= CHECKPOINT_QUOTA_BYTES * 0.85;
        const nearLogCap = logsSize.bytes >= DIAGNOSTIC_LOG_QUOTA_BYTES * 0.9;
        const atWorkerCap = activeWorkers >= maxParallel && maxParallel > 0;
        const status: HealthStatus =
          nearCheckpointCap || nearLogCap || atWorkerCap ? "warning" : "healthy";
        const summary = `Workers: ${activeWorkers}/${maxParallel} active · Worktrees: ${worktreeCount} · Logs: ${formatMiB(logsSize.bytes)} / 20 MiB · Checkpoints: ${formatMiB(checkpointsSize.bytes)} / 256 MiB.`;
        const detail = atWorkerCap
          ? "Worker concurrency limit reached; finish or stop idle workers to free slots."
          : nearCheckpointCap
            ? "Checkpoint rollback storage is approaching its 256 MiB rolling quota."
            : undefined;
        return { status, summary, ...(detail ? { detail } : {}) };
      }

      case "diagnostic-logs": {
        const logs = this.ports.logStatus();
        if (logs.unavailable || logs.persistenceFailures > 0) {
          return {
            status: "error",
            summary: `Diagnostic log storage unavailable (${logs.persistenceFailures} persistence failure(s)).`,
            detail:
              "See knowledge/operations/runbooks/diagnostics.md. Diagnostics are optional and do not block agents.",
          };
        }
        if (logs.dropped > 0) {
          return {
            status: "warning",
            summary: `Diagnostic log capture active; ${logs.dropped} record(s) dropped under backpressure.`,
            detail: "Open Apps → Data Viewer → Logs to inspect captured events.",
          };
        }
        return {
          status: "healthy",
          summary: "Diagnostic log capture healthy (0 dropped, 0 persistence failures).",
        };
      }

      default: {
        return {
          status: "unavailable",
          summary: "Unknown health check.",
        };
      }
    }
  }
}
