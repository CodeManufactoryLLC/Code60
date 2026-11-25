import { Close, Copy, Launch, Renew } from "@carbon/icons-react";
import {
  ActionableNotification,
  Button,
  Dropdown,
  preview__IconIndicator as IconIndicator,
  InlineLoading,
  ProgressBar,
  StructuredListBody,
  StructuredListCell,
  StructuredListHead,
  StructuredListRow,
  StructuredListWrapper,
  Tab,
  TabList,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableExpandedRow,
  TableExpandHeader,
  TableExpandRow,
  TableHead,
  TableHeader,
  TableRow,
  TableToolbar,
  TableToolbarContent,
  TableToolbarSearch,
  TabPanel,
  TabPanels,
  Tabs,
  Tag,
  Tile,
} from "@carbon/react";
import {
  type ComponentProps,
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type ApplicationClient,
  formatHealthBytes,
  formatHealthDuration,
  formatHealthReport,
  GATEWAY_VERSION,
  HEALTH_CHECK_IDS,
  HEALTH_GROUP_IDS,
  HEALTH_GROUP_LABELS,
  HEALTH_STATUS_LABELS,
  type HealthCheckId,
  type HealthCheckItem,
  type HealthCheckTarget,
  type HealthDeepLink,
  type HealthGroupId,
  type HealthRunScope,
  type HealthSnapshot,
  type HealthStatus,
  rollupHealthStatus,
} from "../bridge/index.js";
import { Checkbox } from "./carbon/choices.js";
import type { ToastTone } from "./overlays.js";
import { PageTitle } from "./page-title.js";

type StatusFilter = "all" | "attention" | "healthy" | "not_checked";
type IconIndicatorKind = ComponentProps<typeof IconIndicator>["kind"];

interface FilterOption<T extends string> {
  id: T;
  label: string;
}

const GROUP_FILTER_OPTIONS: FilterOption<HealthGroupId | "all">[] = [
  { id: "all", label: "All categories" },
  ...HEALTH_GROUP_IDS.map((groupId) => ({
    id: groupId,
    label: HEALTH_GROUP_LABELS[groupId],
  })),
];

const STATUS_FILTER_OPTIONS: FilterOption<StatusFilter>[] = [
  { id: "all", label: "All statuses" },
  { id: "attention", label: "Warnings and issues" },
  { id: "healthy", label: "Healthy" },
  { id: "not_checked", label: "Not checked" },
];

const statusIndicatorKind: Readonly<Record<HealthStatus, IconIndicatorKind>> = {
  healthy: "succeeded",
  warning: "caution-minor",
  error: "failed",
  unavailable: "failed",
  running: "in-progress",
  not_configured: "not-started",
  not_checked: "unknown",
};

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

function StatusIndicator({
  status,
  label,
  size = 16,
}: {
  status: HealthStatus;
  label?: string;
  size?: 16 | 20;
}) {
  return (
    <IconIndicator
      kind={statusIndicatorKind[status]}
      label={label ?? HEALTH_STATUS_LABELS[status]}
      size={size}
      className="health-status-indicator"
    />
  );
}

interface SummaryMetric {
  id: "healthy" | "warning" | "error" | "not_checked" | "running";
  status: HealthStatus;
  label: string;
  value: number;
}

function SummaryMetricStrip({ metrics }: { metrics: readonly SummaryMetric[] }) {
  return (
    <dl className="health-summary-metrics" aria-label="Health status breakdown">
      {metrics.map((metric) => (
        <div
          key={metric.id}
          className="health-summary-metric"
          data-metric={metric.id}
          data-active={metric.value > 0 ? "true" : "false"}
        >
          <dt>
            <StatusIndicator status={metric.status} label={metric.label} />
          </dt>
          <dd className="health-summary-metric-value">{metric.value}</dd>
        </div>
      ))}
    </dl>
  );
}

interface ProgressSegment {
  id: "healthy" | "warning" | "error" | "not_configured" | "running";
  label: string;
  count: number;
}

function SegmentedProgressBar({
  completed,
  total,
  percent,
  segments,
}: {
  completed: number;
  total: number;
  percent: number;
  segments: readonly ProgressSegment[];
}) {
  const nonEmpty = segments.filter((segment) => segment.count > 0);
  const breakdown = nonEmpty.map((segment) => `${segment.count} ${segment.label.toLowerCase()}`);
  const valueText =
    breakdown.length > 0
      ? `${completed} of ${total} completed (${percent}%): ${breakdown.join(", ")}`
      : `${completed} of ${total} completed (${percent}%)`;

  return (
    <div
      className="health-segmented-progress"
      role="progressbar"
      aria-label="Health check completion"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={completed}
      aria-valuetext={valueText}
    >
      {nonEmpty.map((segment) => {
        const widthPercent = total > 0 ? (segment.count / total) * 100 : 0;
        const rounded = Math.round(widthPercent);
        return (
          <span
            key={segment.id}
            className="health-progress-segment"
            data-segment={segment.id}
            style={{ width: `${widthPercent}%` }}
            title={`${segment.label}: ${segment.count} of ${total} (${rounded}%)`}
          />
        );
      })}
    </div>
  );
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return "Not checked";
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatCompletedTime(iso: string | null): string {
  if (!iso) return "Not yet completed";
  try {
    return new Date(iso).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function buildCompletionToast(
  scope: HealthRunScope,
  checks: readonly HealthCheckItem[],
): { text: string; tone: ToastTone } {
  const toneFor = (status: HealthStatus): ToastTone => {
    if (status === "error" || status === "unavailable") return "error";
    if (status === "warning") return "warning";
    return "success";
  };
  if (scope.kind === "check") {
    const check = checks.find((item) => item.id === scope.checkId);
    if (check && scope.targetId) {
      const target = check.targets?.find((entry) => entry.id === scope.targetId);
      if (target) {
        return {
          text: `${target.label} check complete: ${HEALTH_STATUS_LABELS[target.status]}.`,
          tone: toneFor(target.status),
        };
      }
    }
    if (check) {
      return {
        text: `${check.title} complete: ${HEALTH_STATUS_LABELS[check.status]}.`,
        tone: toneFor(check.status),
      };
    }
  }
  const relevant =
    scope.kind === "group" ? checks.filter((item) => item.group === scope.groupId) : checks;
  let healthy = 0;
  let warning = 0;
  let issue = 0;
  for (const check of relevant) {
    if (check.status === "healthy") healthy++;
    else if (check.status === "warning") warning++;
    else if (check.status === "error" || check.status === "unavailable") issue++;
  }
  const rollup = rollupHealthStatus(relevant.map((item) => item.status));
  const label = scope.kind === "group" ? HEALTH_GROUP_LABELS[scope.groupId] : "Health check";
  const detail =
    issue === 0 && warning === 0
      ? `${healthy} ${pluralize(healthy, "check", "checks")} healthy.`
      : `${healthy} healthy, ${warning} ${pluralize(warning, "warning", "warnings")}, ${issue} ${pluralize(issue, "issue", "issues")}.`;
  return { text: `${label} complete: ${detail}`, tone: toneFor(rollup) };
}

function TargetList({
  check,
  busy,
  onRun,
  onCancel,
}: {
  check: HealthCheckItem;
  busy: boolean;
  onRun: (scope: HealthRunScope) => void;
  onCancel: (checkId: HealthCheckId, targetId: string) => void;
}) {
  const targets = check.targets ?? [];
  return (
    <StructuredListWrapper
      isCondensed
      isFlush
      aria-label={`${check.title} details`}
      className="health-target-list"
    >
      <StructuredListHead>
        <StructuredListRow head>
          <StructuredListCell head>Status</StructuredListCell>
          <StructuredListCell head>Target</StructuredListCell>
          <StructuredListCell head>Result</StructuredListCell>
          <StructuredListCell head>Checked</StructuredListCell>
          <StructuredListCell head>Action</StructuredListCell>
        </StructuredListRow>
      </StructuredListHead>
      <StructuredListBody>
        {targets.map((target: HealthCheckTarget) => {
          const freePercent =
            typeof target.metrics?.freePercent === "number" ? target.metrics.freePercent : null;
          const availablePercent =
            freePercent !== null ? Math.max(0, Math.min(100, freePercent)) : null;
          return (
            <StructuredListRow
              key={target.id}
              data-target-id={target.id}
              data-status={target.status}
            >
              <StructuredListCell noWrap>
                <StatusIndicator status={target.status} />
              </StructuredListCell>
              <StructuredListCell className="health-target-label">
                {target.label}
              </StructuredListCell>
              <StructuredListCell>
                <div className="health-target-result">
                  <span>{target.summary}</span>
                  {target.detail && <span className="health-detail-text">{target.detail}</span>}
                  {availablePercent !== null && (
                    <div className="health-target-meter">
                      <ProgressBar
                        label={`${target.label} available disk space`}
                        hideLabel
                        size="small"
                        value={availablePercent}
                        max={100}
                        status="active"
                      />
                    </div>
                  )}
                </div>
              </StructuredListCell>
              <StructuredListCell noWrap>
                <div className="health-meta-row">
                  <time className="health-timestamp" dateTime={target.checkedAt ?? undefined}>
                    {formatTimestamp(target.checkedAt)}
                  </time>
                  {target.durationMs !== undefined && (
                    <span className="health-duration">{target.durationMs} ms</span>
                  )}
                </div>
              </StructuredListCell>
              <StructuredListCell noWrap>
                {target.canRun &&
                  (target.running ? (
                    <div className="health-row-actions">
                      <InlineLoading description="Checking…" />
                      <Button
                        kind="danger--ghost"
                        size="sm"
                        renderIcon={Close}
                        aria-label={`Cancel ${target.label}`}
                        onClick={() => onCancel(check.id, target.id)}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      kind="ghost"
                      size="sm"
                      renderIcon={Renew}
                      disabled={busy}
                      aria-label={`${target.runLabel ?? "Recheck"} ${target.label}`}
                      onClick={() =>
                        onRun({ kind: "check", checkId: check.id, targetId: target.id })
                      }
                    >
                      {target.runLabel ?? "Recheck"}
                    </Button>
                  ))}
              </StructuredListCell>
            </StructuredListRow>
          );
        })}
      </StructuredListBody>
    </StructuredListWrapper>
  );
}

function EnvironmentList({
  env,
  clientVersion,
  clientOnline,
}: {
  env: HealthSnapshot["environment"];
  clientVersion?: string;
  clientOnline: boolean;
}) {
  const ipv4 = env.host.localAddresses.filter((entry) => entry.family === "IPv4");
  const preferredAddresses = ipv4.length ? ipv4 : env.host.localAddresses;
  const shownAddresses = preferredAddresses.slice(0, 3);
  const extraAddresses = env.host.localAddresses.length - shownAddresses.length;

  return (
    <StructuredListWrapper
      isFlush
      aria-label="Machine and environment context"
      className="health-environment-list"
    >
      <StructuredListHead>
        <StructuredListRow head>
          <StructuredListCell head>Property</StructuredListCell>
          <StructuredListCell head>Value</StructuredListCell>
        </StructuredListRow>
      </StructuredListHead>
      <StructuredListBody>
        <StructuredListRow>
          <StructuredListCell noWrap className="health-env-property">
            Operating system
          </StructuredListCell>
          <StructuredListCell>{env.osName}</StructuredListCell>
        </StructuredListRow>
        <StructuredListRow>
          <StructuredListCell noWrap className="health-env-property">
            CPU &amp; architecture
          </StructuredListCell>
          <StructuredListCell>
            <div className="health-env-value-stack">
              <span>{env.cpuModel}</span>
              <div className="health-inline-tags">
                <Tag size="sm" type="outline">
                  {env.arch}
                </Tag>
                <Tag size="sm" type="outline">
                  {env.cpuCores} {pluralize(env.cpuCores, "core", "cores")}
                </Tag>
              </div>
            </div>
          </StructuredListCell>
        </StructuredListRow>
        <StructuredListRow>
          <StructuredListCell noWrap className="health-env-property">
            Memory (RAM)
          </StructuredListCell>
          <StructuredListCell>
            <div className="health-env-value-stack">
              <span>{formatHealthBytes(env.freeMemoryBytes)} free</span>
              <span className="health-detail-text">
                of {formatHealthBytes(env.totalMemoryBytes)} total
              </span>
            </div>
          </StructuredListCell>
        </StructuredListRow>
        <StructuredListRow>
          <StructuredListCell noWrap className="health-env-property">
            Hostname
          </StructuredListCell>
          <StructuredListCell>
            <code className="health-code-value">{env.host.hostname || "Unavailable"}</code>
          </StructuredListCell>
        </StructuredListRow>
        <StructuredListRow>
          <StructuredListCell noWrap className="health-env-property">
            Local IP addresses
          </StructuredListCell>
          <StructuredListCell
            title={env.host.localAddresses
              .map((entry) => `${entry.address} (${entry.interfaceName})`)
              .join(", ")}
          >
            {env.host.localAddresses.length ? (
              <ul className="health-ip-list">
                {shownAddresses.map((entry) => (
                  <li key={`${entry.interfaceName}-${entry.address}`}>
                    <code className="health-code-value">{entry.address}</code>
                    <Tag size="sm" type="outline">
                      {entry.interfaceName}
                    </Tag>
                  </li>
                ))}
                {extraAddresses > 0 && (
                  <li>
                    <Tag size="sm" type="gray">
                      +{extraAddresses} more
                    </Tag>
                  </li>
                )}
              </ul>
            ) : (
              "None detected"
            )}
          </StructuredListCell>
        </StructuredListRow>
        <StructuredListRow>
          <StructuredListCell noWrap className="health-env-property">
            Network &amp; proxy
          </StructuredListCell>
          <StructuredListCell>
            <div className="health-env-value-stack">
              <IconIndicator
                kind={clientOnline ? "succeeded" : "failed"}
                label={clientOnline ? "Browser online" : "Browser offline"}
              />
              <span className="health-detail-text">
                Proxy: {env.host.proxyConfigured ? (env.host.proxySummary ?? "Configured") : "None"}
              </span>
            </div>
          </StructuredListCell>
        </StructuredListRow>
        <StructuredListRow>
          <StructuredListCell noWrap className="health-env-property">
            Timezone
          </StructuredListCell>
          <StructuredListCell>{env.timeZone}</StructuredListCell>
        </StructuredListRow>
        <StructuredListRow>
          <StructuredListCell noWrap className="health-env-property">
            System uptime
          </StructuredListCell>
          <StructuredListCell>{formatHealthDuration(env.uptimeSeconds)}</StructuredListCell>
        </StructuredListRow>
        <StructuredListRow>
          <StructuredListCell noWrap className="health-env-property">
            Code60 &amp; Gateway
          </StructuredListCell>
          <StructuredListCell>
            <div className="health-env-value-stack">
              <span>Backend {env.code60Version}</span>
              {clientVersion && <span className="health-detail-text">Client {clientVersion}</span>}
              <div className="health-inline-tags">
                <Tag size="sm" type="outline">
                  Gateway v{env.gatewayVersion}
                </Tag>
                <Tag size="sm" type="outline">
                  {env.installMode}
                </Tag>
              </div>
            </div>
          </StructuredListCell>
        </StructuredListRow>
        <StructuredListRow>
          <StructuredListCell noWrap className="health-env-property">
            Runtime &amp; protocols
          </StructuredListCell>
          <StructuredListCell>
            <div className="health-inline-tags">
              <Tag size="sm" type="outline">
                Node {env.nodeVersion}
              </Tag>
              <Tag size="sm" type="outline">
                ACP {env.acpProtocol}
              </Tag>
              <Tag size="sm" type="outline">
                MCP {env.mcpProtocol}
              </Tag>
              <Tag size="sm" type="outline">
                Schema {env.databaseSchema}
              </Tag>
            </div>
          </StructuredListCell>
        </StructuredListRow>
        <StructuredListRow>
          <StructuredListCell noWrap className="health-env-property">
            Embeddings &amp; ONNX
          </StructuredListCell>
          <StructuredListCell>
            <div className="health-env-value-stack">
              <span>{env.embeddingModelId ?? "Unavailable"}</span>
              <span className="health-detail-text">{env.onnxRuntime ?? "ONNX unavailable"}</span>
            </div>
          </StructuredListCell>
        </StructuredListRow>
        <StructuredListRow>
          <StructuredListCell noWrap className="health-env-property">
            Shell &amp; PATH
          </StructuredListCell>
          <StructuredListCell>
            <div className="health-env-value-stack">
              <code className="health-code-value">{env.shell ?? "Default shell"}</code>
              <IconIndicator
                kind={env.pathRecovered ? "succeeded" : "informative"}
                label={env.pathRecovered ? "Desktop PATH recovered" : "Using process PATH"}
              />
            </div>
          </StructuredListCell>
        </StructuredListRow>
        <StructuredListRow>
          <StructuredListCell noWrap className="health-env-property">
            Backend origin
          </StructuredListCell>
          <StructuredListCell>
            <code className="health-code-value">{env.host.backendOrigin ?? "Loopback"}</code>
          </StructuredListCell>
        </StructuredListRow>
        <StructuredListRow>
          <StructuredListCell noWrap className="health-env-property">
            State directory
          </StructuredListCell>
          <StructuredListCell>
            <code className="health-code-value">{env.host.stateRoot}</code>
          </StructuredListCell>
        </StructuredListRow>
      </StructuredListBody>
    </StructuredListWrapper>
  );
}

export function HealthCheckPage({
  api,
  active,
  clientVersion,
  onNavigate,
  onNotify,
}: {
  api: Pick<ApplicationClient, "healthCheck" | "onHealthChanged">;
  active: boolean;
  clientVersion?: string;
  onNavigate?: (link: HealthDeepLink) => void;
  onNotify?: (text: string, tone?: ToastTone) => void;
}) {
  const [snapshot, setSnapshot] = useState<HealthSnapshot>();
  const [error, setError] = useState("");
  const [disconnected, setDisconnected] = useState(false);
  const [includeHostInReport, setIncludeHostInReport] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const [clientOnline, setClientOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [lastCompletedAt, setLastCompletedAt] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState(0);
  const [query, setQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState<HealthGroupId | "all">("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [expandedIds, setExpandedIds] = useState<readonly HealthCheckId[]>([]);
  const mounted = useRef(true);
  const activeRunToken = useRef(0);
  const onNotifyRef = useRef(onNotify);
  onNotifyRef.current = onNotify;
  const copyCheckboxId = useId();
  const groupSelectId = useId();
  const statusSelectId = useId();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const updateOnline = () => setClientOnline(navigator.onLine);
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, []);

  const execute = useCallback(
    async (
      request: Parameters<NonNullable<ApplicationClient["healthCheck"]>>[0],
    ): Promise<void> => {
      if (!api.healthCheck) {
        setDisconnected(true);
        setError("Health Check service is unavailable in this session.");
        return;
      }
      const token = request.action === "run" ? ++activeRunToken.current : activeRunToken.current;
      if (request.action === "cancel") activeRunToken.current++;
      try {
        const next = await api.healthCheck(request);
        if (!mounted.current) return;
        setSnapshot(next);
        setDisconnected(false);
        setError("");
        if (request.action === "run" && token === activeRunToken.current) {
          setLastCompletedAt(next.generatedAt);
          const toast = buildCompletionToast(request.scope, next.checks);
          onNotifyRef.current?.(toast.text, toast.tone);
        }
      } catch (cause) {
        if (!mounted.current) return;
        setDisconnected(true);
        const message =
          cause instanceof Error
            ? cause.message
            : "Could not reach the Code60 backend server. Check whether Code60 is running and retry.";
        setError(message);
        if (request.action === "run" && token === activeRunToken.current) {
          onNotifyRef.current?.("Health check failed: could not reach Code60 backend.", "error");
        }
      }
    },
    [api],
  );

  useEffect(() => {
    if (!active) return;
    const off = api.onHealthChanged?.((next) => {
      if (!mounted.current) return;
      setSnapshot(next);
      setDisconnected(false);
      setError("");
    });
    void execute({ action: "run", scope: { kind: "all", includeActive: false } });
    return () => {
      off?.();
      void api.healthCheck?.({ action: "cancel" }).catch(() => {});
    };
  }, [active, api, execute]);

  const effectiveChecks = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.checks.map((check) => {
      if (check.id === "backend-connection" && disconnected) {
        return {
          ...check,
          status: "unavailable" as const,
          summary: "Disconnected from the Code60 backend server.",
          detail: error || "Start the backend service or reload this browser tab.",
          running: false,
        };
      }
      if (check.id === "backend-version") {
        const gatewayMatch = snapshot.environment.gatewayVersion === GATEWAY_VERSION;
        const versionMismatch =
          Boolean(clientVersion) && clientVersion !== snapshot.environment.code60Version;
        if (!gatewayMatch) {
          return {
            ...check,
            status: "error" as const,
            summary: `Incompatible Gateway protocol: backend v${snapshot.environment.gatewayVersion} vs client v${GATEWAY_VERSION}.`,
            detail: "Reload the browser tab or run code60 open after updating.",
          };
        }
        if (versionMismatch) {
          return {
            ...check,
            status: "warning" as const,
            summary: `Backend ${snapshot.environment.code60Version} differs from loaded browser client ${clientVersion}.`,
            detail: "Refresh the browser tab to load matching client assets.",
          };
        }
        return {
          ...check,
          status: "healthy" as const,
          summary: `Compatible: backend ${snapshot.environment.code60Version} (Gateway v${snapshot.environment.gatewayVersion}).`,
        };
      }
      return check;
    });
  }, [snapshot, disconnected, error, clientVersion]);

  const overallStatus = useMemo<HealthStatus>(() => {
    if (disconnected) return "unavailable";
    if (!effectiveChecks.length) return "running";
    return rollupHealthStatus(effectiveChecks.map((check) => check.status));
  }, [disconnected, effectiveChecks]);

  const counts = useMemo(() => {
    const summary = {
      healthy: 0,
      warning: 0,
      error: 0,
      notConfigured: 0,
      notChecked: 0,
      running: 0,
    };
    for (const check of effectiveChecks) {
      if (check.running || check.status === "running") summary.running++;
      else if (check.status === "healthy") summary.healthy++;
      else if (check.status === "warning") summary.warning++;
      else if (check.status === "error" || check.status === "unavailable") summary.error++;
      else if (check.status === "not_configured") summary.notConfigured++;
      else if (check.status === "not_checked") summary.notChecked++;
    }
    return summary;
  }, [effectiveChecks]);

  const runningCount = snapshot?.runningCount ?? 0;

  const summaryMetrics = useMemo<SummaryMetric[]>(() => {
    const base: SummaryMetric[] = [
      { id: "healthy", status: "healthy", label: "Healthy", value: counts.healthy },
      { id: "warning", status: "warning", label: "Warnings", value: counts.warning },
      { id: "error", status: "error", label: "Issues", value: counts.error },
      { id: "not_checked", status: "not_checked", label: "Not checked", value: counts.notChecked },
    ];
    if (runningCount > 0) {
      base.push({ id: "running", status: "running", label: "Running", value: runningCount });
    }
    return base;
  }, [counts, runningCount]);

  const progress = useMemo(() => {
    const total = effectiveChecks.length || HEALTH_CHECK_IDS.length;
    const completed = effectiveChecks.filter(
      (check) => !check.running && check.status !== "not_checked",
    ).length;
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { completed, total, percent };
  }, [effectiveChecks]);

  const progressSegments = useMemo<ProgressSegment[]>(
    () => [
      { id: "healthy", label: "Healthy", count: counts.healthy },
      { id: "warning", label: "Warnings", count: counts.warning },
      { id: "error", label: "Issues", count: counts.error },
      { id: "not_configured", label: "Not configured", count: counts.notConfigured },
      { id: "running", label: "Running", count: counts.running },
    ],
    [counts],
  );

  const latestCompletedIso = useMemo(() => {
    let latest = lastCompletedAt;
    for (const check of effectiveChecks) {
      if (check.checkedAt && (!latest || check.checkedAt > latest)) latest = check.checkedAt;
    }
    return latest;
  }, [effectiveChecks, lastCompletedAt]);

  const filteredChecks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return effectiveChecks.filter((check) => {
      if (groupFilter !== "all" && check.group !== groupFilter) return false;
      if (
        statusFilter === "attention" &&
        check.status !== "warning" &&
        check.status !== "error" &&
        check.status !== "unavailable"
      ) {
        return false;
      }
      if (statusFilter === "healthy" && check.status !== "healthy") return false;
      if (statusFilter === "not_checked" && check.status !== "not_checked") return false;
      if (!needle) return true;
      const haystack = [
        check.title,
        check.question,
        check.summary,
        check.detail ?? "",
        HEALTH_GROUP_LABELS[check.group],
        ...(check.targets?.map((target) => `${target.label} ${target.summary}`) ?? []),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [effectiveChecks, groupFilter, statusFilter, query]);

  const allFilteredExpanded =
    filteredChecks.length > 0 && filteredChecks.every((check) => expandedIds.includes(check.id));

  const toggleRow = (checkId: HealthCheckId) => {
    setExpandedIds((current) =>
      current.includes(checkId) ? current.filter((id) => id !== checkId) : [...current, checkId],
    );
  };

  const toggleAllRows = () => {
    setExpandedIds(allFilteredExpanded ? [] : filteredChecks.map((check) => check.id));
  };

  const handleRun = useCallback(
    (scope: HealthRunScope) => {
      void execute({ action: "run", scope });
    },
    [execute],
  );

  const handleCancel = useCallback(
    (checkId?: HealthCheckId, targetId?: string) => {
      void execute({
        action: "cancel",
        ...(checkId ? { checkId } : {}),
        ...(targetId ? { targetId } : {}),
      });
    },
    [execute],
  );

  const copyReport = async () => {
    if (!snapshot) return;
    try {
      const report = formatHealthReport(
        { ...snapshot, checks: effectiveChecks },
        {
          includeHostContext: includeHostInReport,
          ...(clientVersion ? { clientVersion } : {}),
          clientGatewayVersion: GATEWAY_VERSION,
          clientOnline,
        },
      );
      await navigator.clipboard.writeText(report);
      setCopyStatus(
        includeHostInReport
          ? "Full health report copied (includes host & network context)."
          : "Redacted health report copied.",
      );
    } catch {
      setCopyStatus("Could not copy health report.");
    }
  };

  const env = snapshot?.environment;
  const selectedGroupHasActive =
    groupFilter !== "all" &&
    effectiveChecks.some((check) => check.group === groupFilter && check.mode === "active");
  const selectedGroupRunning =
    groupFilter !== "all" &&
    effectiveChecks.some((check) => check.group === groupFilter && check.running);

  return (
    <section className="health-check-page" aria-label="Health Check">
      <header className="table-controls">
        <PageTitle
          page="health-check"
          className="table-title"
          actions={[
            {
              id: "health-check-refresh",
              label: "Recheck passive",
              run: () => handleRun({ kind: "all", includeActive: false }),
              disabled: runningCount > 0,
            },
            {
              id: "health-check-run-all",
              label: "Run all checks",
              run: () => handleRun({ kind: "all", includeActive: true }),
              disabled: runningCount > 0,
            },
          ]}
        />
      </header>

      <section
        className="health-progress-section"
        aria-label="Health check progress"
        data-running={runningCount > 0 ? "true" : "false"}
      >
        <div className="health-progress-header">
          <span className="health-progress-label">
            {runningCount > 0 ? "Running health checks…" : "Completed checks"}
          </span>
          <div className="health-progress-numbers" role="status">
            <span className="health-progress-count">
              <strong>
                {progress.completed} of {progress.total}
              </strong>{" "}
              completed
            </span>
            <span className="health-progress-percent">{progress.percent}%</span>
          </div>
        </div>
        <SegmentedProgressBar
          completed={progress.completed}
          total={progress.total}
          percent={progress.percent}
          segments={progressSegments}
        />
      </section>

      <Tile className="health-summary-tile" aria-labelledby="health-summary-heading">
        <div className="health-summary-top">
          <div className="health-summary-heading-group">
            <div className="health-summary-title-row">
              <h2 id="health-summary-heading">System health</h2>
              <StatusIndicator status={overallStatus} size={20} />
            </div>
            <p
              className="health-summary-last-run"
              title={latestCompletedIso ?? undefined}
              data-testid="health-last-completed"
            >
              Last completed: {formatCompletedTime(latestCompletedIso)}
            </p>
          </div>
          <div className="health-summary-actions">
            {runningCount > 0 ? (
              <Button
                kind="danger--ghost"
                size="md"
                renderIcon={Close}
                onClick={() => handleCancel()}
              >
                Cancel running
              </Button>
            ) : (
              <>
                <Button
                  kind="tertiary"
                  size="md"
                  renderIcon={Renew}
                  onClick={() => handleRun({ kind: "all", includeActive: false })}
                >
                  Recheck passive
                </Button>
                <Button
                  kind="primary"
                  size="md"
                  renderIcon={Renew}
                  onClick={() => handleRun({ kind: "all", includeActive: true })}
                >
                  Run all checks
                </Button>
              </>
            )}
          </div>
        </div>

        {disconnected ? (
          <p className="health-summary-disconnected" role="status">
            Cannot reach Code60 backend server.
          </p>
        ) : (
          <SummaryMetricStrip metrics={summaryMetrics} />
        )}

        <div className="health-report-bar">
          <div className="health-report-controls">
            <Button
              kind="ghost"
              size="sm"
              renderIcon={Copy}
              disabled={!snapshot}
              onClick={() => void copyReport()}
            >
              Copy health report
            </Button>
            <div className="health-report-opt-in">
              <Checkbox
                id={copyCheckboxId}
                labelText="Include host & network details (IP, hostname, paths)"
                checked={includeHostInReport}
                onChange={(_event, { checked }) => {
                  setIncludeHostInReport(checked);
                  setCopyStatus("");
                }}
              />
            </div>
          </div>
          {copyStatus && (
            <span className="health-copy-status" role="status">
              {copyStatus}
            </span>
          )}
        </div>
      </Tile>

      {error && (
        <div className="health-alert">
          <ActionableNotification
            kind="error"
            inline
            lowContrast
            hideCloseButton
            title="Backend connection unavailable"
            subtitle={error}
            actionButtonLabel="Retry connection"
            onActionButtonClick={() => handleRun({ kind: "all", includeActive: false })}
          />
        </div>
      )}

      <Tabs
        selectedIndex={selectedTab}
        onChange={({ selectedIndex }) => setSelectedTab(selectedIndex)}
      >
        <TabList aria-label="Health Check sections">
          <Tab>Checks ({effectiveChecks.length})</Tab>
          <Tab>Environment</Tab>
        </TabList>
        <TabPanels>
          <TabPanel>
            <TableContainer className="health-checks-table-container">
              <TableToolbar aria-label="Filter and run health checks">
                <TableToolbarContent>
                  <TableToolbarSearch
                    persistent
                    labelText="Filter health checks"
                    placeholder="Filter checks by name, category, or result"
                    value={query}
                    onChange={(event) => {
                      const next = typeof event === "string" ? event : event.target.value;
                      setQuery(next);
                    }}
                    onClear={() => setQuery("")}
                  />
                  <div className="health-toolbar-filter">
                    <Dropdown
                      id={groupSelectId}
                      titleText="Category"
                      hideLabel
                      label="All categories"
                      size="lg"
                      items={GROUP_FILTER_OPTIONS}
                      itemToString={(item) => item?.label ?? ""}
                      selectedItem={
                        GROUP_FILTER_OPTIONS.find((item) => item.id === groupFilter) ?? null
                      }
                      onChange={({ selectedItem }) => {
                        if (selectedItem) setGroupFilter(selectedItem.id);
                      }}
                    />
                  </div>
                  <div className="health-toolbar-filter">
                    <Dropdown
                      id={statusSelectId}
                      titleText="Status"
                      hideLabel
                      label="All statuses"
                      size="lg"
                      items={STATUS_FILTER_OPTIONS}
                      itemToString={(item) => item?.label ?? ""}
                      selectedItem={
                        STATUS_FILTER_OPTIONS.find((item) => item.id === statusFilter) ?? null
                      }
                      onChange={({ selectedItem }) => {
                        if (selectedItem) setStatusFilter(selectedItem.id);
                      }}
                    />
                  </div>
                  {groupFilter !== "all" && (
                    <Button
                      kind="ghost"
                      size="lg"
                      renderIcon={Renew}
                      disabled={disconnected || selectedGroupRunning}
                      aria-label={`Recheck ${HEALTH_GROUP_LABELS[groupFilter]}`}
                      onClick={() =>
                        handleRun({
                          kind: "group",
                          groupId: groupFilter,
                          includeActive: selectedGroupHasActive,
                        })
                      }
                    >
                      Recheck category
                    </Button>
                  )}
                </TableToolbarContent>
              </TableToolbar>
              <div className="health-table-scroll">
                <Table size="md" aria-label="Health checks">
                  <TableHead>
                    <TableRow>
                      <TableExpandHeader
                        id="health-check-expand-header"
                        enableToggle
                        isExpanded={allFilteredExpanded}
                        aria-label={
                          allFilteredExpanded ? "Collapse all checks" : "Expand all checks"
                        }
                        onExpand={toggleAllRows}
                      />
                      <TableHeader>Status</TableHeader>
                      <TableHeader>Check</TableHeader>
                      <TableHeader>Category</TableHeader>
                      <TableHeader className="health-col-items">Items</TableHeader>
                      <TableHeader>Mode</TableHeader>
                      <TableHeader>Summary</TableHeader>
                      <TableHeader>Checked</TableHeader>
                      <TableHeader>Actions</TableHeader>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredChecks.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="health-table-empty">
                          {effectiveChecks.length === 0
                            ? "Running initial health checks…"
                            : "No health checks match the current filter."}
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredChecks.map((check) => {
                        const expanded = expandedIds.includes(check.id);
                        const actionLabel = check.mode === "active" ? "Run probe" : "Recheck";
                        const targetCount = check.targets?.length ?? 0;
                        const detailId = `health-check-detail-${check.id}`;
                        return (
                          <Fragment key={check.id}>
                            <TableExpandRow
                              isExpanded={expanded}
                              aria-label={`${expanded ? "Collapse" : "Expand"} ${check.title}`}
                              {...(expanded ? { "aria-controls": detailId } : {})}
                              expandHeader="health-check-expand-header"
                              onExpand={() => toggleRow(check.id)}
                              data-check-id={check.id}
                              data-status={check.status}
                              aria-busy={check.running}
                            >
                              <TableCell className="health-cell-nowrap">
                                <StatusIndicator status={check.status} />
                              </TableCell>
                              <TableCell className="health-cell-check">
                                <span className="health-check-name">{check.title}</span>
                              </TableCell>
                              <TableCell className="health-cell-category">
                                {HEALTH_GROUP_LABELS[check.group]}
                              </TableCell>
                              <TableCell className="health-cell-items">
                                {targetCount > 0 ? targetCount : "—"}
                              </TableCell>
                              <TableCell className="health-cell-nowrap">
                                <Tag
                                  size="sm"
                                  type={check.mode === "active" ? "cool-gray" : "outline"}
                                >
                                  {check.mode === "active" ? "Active probe" : "Passive"}
                                </Tag>
                              </TableCell>
                              <TableCell className="health-cell-summary">{check.summary}</TableCell>
                              <TableCell className="health-cell-nowrap">
                                <div className="health-checked-cell">
                                  <time
                                    className="health-timestamp"
                                    dateTime={check.checkedAt ?? undefined}
                                  >
                                    {formatTimestamp(check.checkedAt)}
                                  </time>
                                  {check.durationMs !== undefined && (
                                    <span className="health-duration">{check.durationMs} ms</span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="health-cell-nowrap">
                                <div className="health-row-actions">
                                  {check.running ? (
                                    <>
                                      <InlineLoading description="Checking…" />
                                      <Button
                                        kind="danger--ghost"
                                        size="sm"
                                        renderIcon={Close}
                                        aria-label={`Cancel ${check.title}`}
                                        onClick={() => handleCancel(check.id)}
                                      >
                                        Cancel
                                      </Button>
                                    </>
                                  ) : (
                                    <Button
                                      kind="ghost"
                                      size="sm"
                                      renderIcon={Renew}
                                      disabled={disconnected}
                                      aria-label={`${actionLabel} ${check.title}`}
                                      onClick={() =>
                                        handleRun({ kind: "check", checkId: check.id })
                                      }
                                    >
                                      {actionLabel}
                                    </Button>
                                  )}
                                  {check.deepLink && onNavigate && (
                                    <Button
                                      kind="ghost"
                                      size="sm"
                                      hasIconOnly
                                      renderIcon={Launch}
                                      iconDescription={`Open ${check.deepLink.label}`}
                                      tooltipPosition="left"
                                      onClick={() => {
                                        if (check.deepLink) onNavigate(check.deepLink);
                                      }}
                                    />
                                  )}
                                </div>
                              </TableCell>
                            </TableExpandRow>
                            {expanded && (
                              <TableExpandedRow id={detailId} colSpan={9}>
                                <div className="health-expanded-body">
                                  <p className="health-expanded-question">{check.question}</p>
                                  {check.detail && (
                                    <p className="health-expanded-detail">{check.detail}</p>
                                  )}
                                  {check.hostDetail && (
                                    <p className="health-expanded-detail">
                                      <code className="health-code-value">{check.hostDetail}</code>
                                    </p>
                                  )}
                                  {check.targets && check.targets.length > 0 && (
                                    <TargetList
                                      check={check}
                                      busy={disconnected}
                                      onRun={handleRun}
                                      onCancel={handleCancel}
                                    />
                                  )}
                                </div>
                              </TableExpandedRow>
                            )}
                          </Fragment>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </TableContainer>
          </TabPanel>
          <TabPanel>
            {env ? (
              <EnvironmentList
                env={env}
                clientOnline={clientOnline}
                {...(clientVersion ? { clientVersion } : {})}
              />
            ) : (
              <p className="health-table-empty">Environment context is not yet available.</p>
            )}
          </TabPanel>
        </TabPanels>
      </Tabs>
    </section>
  );
}
