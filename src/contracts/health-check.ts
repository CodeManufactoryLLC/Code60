import { z } from "zod";

// Keep code generation disabled when this module is imported directly.
z.config({ jitless: true });

export const HEALTH_GROUP_IDS = [
  "services",
  "scheduler",
  "providers",
  "workspace",
  "subsystems",
  "storage",
] as const;
export type HealthGroupId = (typeof HEALTH_GROUP_IDS)[number];

export const HEALTH_GROUP_LABELS: Readonly<Record<HealthGroupId, string>> = {
  services: "Services & connectivity",
  scheduler: "Background scheduler",
  providers: "Agent providers & toolchain",
  workspace: "Relay, database & storage safety",
  subsystems: "Memory, embeddings & MCP",
  storage: "Disk space & quotas",
};

export const HEALTH_CHECK_IDS = [
  "backend-connection",
  "backend-version",
  "mcp-gateway",
  "scheduler-status",
  "scheduler-registration",
  "scheduler-health",
  "providers-installed",
  "providers-authenticated",
  "git-toolchain",
  "relay-health",
  "database-health",
  "storage-safety",
  "memory-health",
  "embeddings-rag",
  "mcp-servers",
  "disk-space",
  "code60-quotas",
  "diagnostic-logs",
] as const;
export type HealthCheckId = (typeof HEALTH_CHECK_IDS)[number];

const HEALTH_STATUSES = [
  "healthy",
  "warning",
  "error",
  "unavailable",
  "not_configured",
  "not_checked",
  "running",
] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

const HEALTH_CHECK_MODES = ["passive", "active"] as const;
export type HealthCheckMode = (typeof HEALTH_CHECK_MODES)[number];

export const HEALTH_STATUS_LABELS: Readonly<Record<HealthStatus, string>> = {
  healthy: "Healthy",
  warning: "Warning",
  error: "Action needed",
  unavailable: "Unavailable",
  not_configured: "Not configured",
  not_checked: "Not checked",
  running: "Checking",
};

const targetIdSchema = z
  .string({ error: "Invalid health check target" })
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/, "Invalid health check target");

const healthRunScopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("all"),
    includeActive: z.boolean().optional(),
  }),
  z.strictObject({
    kind: z.literal("group"),
    groupId: z.enum(HEALTH_GROUP_IDS),
    includeActive: z.boolean().optional(),
  }),
  z.strictObject({
    kind: z.literal("check"),
    checkId: z.enum(HEALTH_CHECK_IDS),
    targetId: targetIdSchema.optional(),
  }),
]);
export type HealthRunScope = z.infer<typeof healthRunScopeSchema>;

export const healthCheckRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("snapshot") }),
  z.strictObject({ action: z.literal("run"), scope: healthRunScopeSchema }),
  z.strictObject({
    action: z.literal("cancel"),
    checkId: z.enum(HEALTH_CHECK_IDS).optional(),
    targetId: targetIdSchema.optional(),
  }),
]);
export type HealthCheckRequest = z.infer<typeof healthCheckRequestSchema>;

export interface HealthDeepLink {
  kind: "page" | "settings" | "relay";
  id: string;
  label: string;
}

export interface HealthCheckTarget {
  id: string;
  label: string;
  status: HealthStatus;
  summary: string;
  detail?: string;
  checkedAt: string | null;
  durationMs?: number;
  running: boolean;
  canRun: boolean;
  runLabel?: string;
  /** Non-sensitive structured values safe for redacted reports. */
  metrics?: Record<string, string | number | boolean | null>;
}

export interface HealthCheckItem {
  id: HealthCheckId;
  group: HealthGroupId;
  title: string;
  question: string;
  mode: HealthCheckMode;
  status: HealthStatus;
  summary: string;
  detail?: string;
  /** Optional host-identifying detail shown in UI but redacted by default in exports. */
  hostDetail?: string;
  checkedAt: string | null;
  durationMs?: number;
  running: boolean;
  deepLink?: HealthDeepLink;
  targets?: HealthCheckTarget[];
}

interface HealthLocalAddress {
  interfaceName: string;
  family: "IPv4" | "IPv6";
  address: string;
  primary: boolean;
}

export interface HealthEnvironmentContext {
  collectedAt: string;
  platform: string;
  osName: string;
  osRelease: string;
  arch: string;
  cpuModel: string;
  cpuCores: number;
  totalMemoryBytes: number;
  freeMemoryBytes: number;
  uptimeSeconds: number;
  timeZone: string;
  localTimeIso: string;
  code60Version: string;
  gatewayVersion: number;
  nodeVersion: string;
  installMode: "managed" | "source";
  acpProtocol: string;
  mcpProtocol: string;
  databaseSchema: string;
  runRecordFormat: string;
  embeddingModelId: string | null;
  onnxRuntime: string | null;
  shell: string | null;
  pathRecovered: boolean;
  databaseConnected: boolean;
  openProjectCount: number;
  activeWorkerCount: number;
  webServerEnabled: boolean;
  requirePairing: boolean;
  /** Host- and network-identifying context: shown locally, omitted from redacted exports by default. */
  host: {
    hostname: string;
    localAddresses: HealthLocalAddress[];
    primaryPrivateIPv4: string | null;
    proxyConfigured: boolean;
    proxySummary: string | null;
    backendOrigin: string | null;
    stateRoot: string;
    databaseLabel: string | null;
  };
}

export interface HealthSnapshot {
  revision: number;
  generatedAt: string;
  runningCount: number;
  environment: HealthEnvironmentContext;
  checks: HealthCheckItem[];
}

export function formatHealthBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "Unavailable";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"] as const;
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }
  const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[index]}`;
}

export function formatHealthDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "Unavailable";
  const whole = Math.floor(seconds);
  const days = Math.floor(whole / 86_400);
  const hours = Math.floor((whole % 86_400) / 3_600);
  const minutes = Math.floor((whole % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function rollupHealthStatus(statuses: readonly HealthStatus[]): HealthStatus {
  if (statuses.some((s) => s === "running")) return "running";
  if (statuses.some((s) => s === "error" || s === "unavailable")) return "error";
  if (statuses.some((s) => s === "warning")) return "warning";
  if (statuses.some((s) => s === "healthy")) return "healthy";
  if (statuses.some((s) => s === "not_configured")) return "not_configured";
  return "not_checked";
}

export function formatHealthReport(
  snapshot: HealthSnapshot,
  options: {
    includeHostContext?: boolean;
    clientVersion?: string;
    clientGatewayVersion?: number;
    clientOnline?: boolean;
  } = {},
): string {
  const includeHost = options.includeHostContext === true;
  const env = snapshot.environment;
  const lines: string[] = [
    "# Code60 Health Report",
    `Generated: ${snapshot.generatedAt}`,
    `Mode: ${includeHost ? "Full (includes host & network context)" : "Redacted (host & network identifiers omitted)"}`,
    "",
    "## Environment",
    `- Code60 Backend: ${env.code60Version} (Gateway v${env.gatewayVersion}, ${env.installMode})`,
    ...(options.clientVersion
      ? [
          `- Code60 Client: ${options.clientVersion} (Gateway v${options.clientGatewayVersion ?? env.gatewayVersion})`,
        ]
      : []),
    `- OS: ${env.osName} (${env.platform}/${env.arch}, kernel ${env.osRelease})`,
    `- CPU: ${env.cpuCores} cores (${env.cpuModel})`,
    `- Memory: ${formatHealthBytes(env.freeMemoryBytes)} free / ${formatHealthBytes(env.totalMemoryBytes)} total`,
    `- Uptime: ${formatHealthDuration(env.uptimeSeconds)}`,
    `- Timezone: ${env.timeZone}`,
    `- Node.js: ${env.nodeVersion}`,
    `- Protocols: ACP ${env.acpProtocol}, MCP ${env.mcpProtocol}, DB schema ${env.databaseSchema}, Run format ${env.runRecordFormat}`,
    `- Embeddings: ${env.embeddingModelId ?? "Unavailable"} (${env.onnxRuntime ?? "ONNX unavailable"})`,
    `- Shell PATH recovery: ${env.pathRecovered ? "Recovered" : "Fallback"}`,
    `- Workspace state: database ${env.databaseConnected ? "connected" : "disconnected"}, ${env.openProjectCount} open project(s), ${env.activeWorkerCount} active worker(s)`,
    `- Web Server (Beta): ${env.webServerEnabled ? "Enabled" : "Disabled"} (Pairing ${env.requirePairing ? "required" : "optional"})`,
    ...(options.clientOnline !== undefined
      ? [`- Browser network: ${options.clientOnline ? "Online" : "Offline"}`]
      : []),
  ];
  if (includeHost) {
    const ips = env.host.localAddresses.map(
      (entry) => `${entry.address} (${entry.interfaceName}, ${entry.family})`,
    );
    lines.push(
      `- Hostname: ${env.host.hostname}`,
      `- Local IPs: ${ips.length ? ips.join(", ") : "None detected"}`,
      `- Proxy: ${env.host.proxyConfigured ? (env.host.proxySummary ?? "Configured") : "None"}`,
      `- Backend origin: ${env.host.backendOrigin ?? "Unavailable"}`,
      `- State root: ${env.host.stateRoot}`,
      `- Database: ${env.host.databaseLabel ?? "None"}`,
    );
  }
  lines.push("", "## Checks");
  for (const group of HEALTH_GROUP_IDS) {
    const groupChecks = snapshot.checks.filter((check) => check.group === group);
    if (!groupChecks.length) continue;
    lines.push("", `### ${HEALTH_GROUP_LABELS[group]}`);
    for (const check of groupChecks) {
      const checked = check.checkedAt ? ` (checked ${check.checkedAt})` : "";
      lines.push(
        `- [${HEALTH_STATUS_LABELS[check.status]}] ${check.title}: ${check.summary}${checked}`,
      );
      if (check.detail) lines.push(`  - Detail: ${check.detail}`);
      if (includeHost && check.hostDetail) lines.push(`  - Host: ${check.hostDetail}`);
      for (const target of check.targets ?? []) {
        lines.push(
          `  - ${target.label}: [${HEALTH_STATUS_LABELS[target.status]}] ${target.summary}`,
        );
      }
    }
  }
  return lines.join("\n");
}
