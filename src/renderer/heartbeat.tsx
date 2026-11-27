import { Chat, Close, Launch, Play, Renew } from "@carbon/icons-react";
import {
  ActionableNotification,
  Button,
  Dropdown,
  preview__IconIndicator as IconIndicator,
  InlineLoading,
  ProgressBar,
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
  Toggle,
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
  collectHeartbeatAttentionItems,
  DEFAULT_HEARTBEAT_POLICY,
  formatHeartbeatDuration,
  HEARTBEAT_ACTION_STATUS_LABELS,
  HEARTBEAT_ACTIONS,
  HEARTBEAT_AREA_LABELS,
  HEARTBEAT_AREAS,
  HEARTBEAT_BEHAVIOR_LABELS,
  HEARTBEAT_BEHAVIORS,
  HEARTBEAT_INTERVAL_OPTIONS,
  HEARTBEAT_RUN_STATUS_LABELS,
  HEARTBEAT_SOURCE_LABELS,
  type HeartbeatActionRecord,
  type HeartbeatActionStatus,
  type HeartbeatArea,
  type HeartbeatAttentionItem,
  type HeartbeatBehavior,
  type HeartbeatDeepLink,
  type HeartbeatPolicy,
  type HeartbeatRunRecord,
  type HeartbeatRunStatus,
  type HeartbeatSnapshot,
} from "../bridge/index.js";
import type { ToastTone } from "./overlays.js";
import { PageTitle } from "./page-title.js";
import { useDocumentVisible } from "./use-document-visible.js";

type IconIndicatorKind = ComponentProps<typeof IconIndicator>["kind"];
type ActionOutcomeFilter = "all" | "attention" | "fixed" | "ok";

const actionIndicatorKind: Readonly<Record<HeartbeatActionStatus, IconIndicatorKind>> = {
  pending: "not-started",
  running: "in-progress",
  passed: "succeeded",
  remediated: "succeeded",
  warning: "caution-minor",
  escalated: "failed",
  skipped: "not-started",
  failed: "failed",
};

const runIndicatorKind: Readonly<Record<HeartbeatRunStatus, IconIndicatorKind>> = {
  running: "in-progress",
  healthy: "succeeded",
  remediated: "succeeded",
  warning: "caution-minor",
  escalated: "failed",
  failed: "failed",
  cancelled: "not-started",
};

const AREA_FILTER_OPTIONS: Array<{ id: HeartbeatArea | "all"; label: string }> = [
  { id: "all", label: "All areas" },
  ...HEARTBEAT_AREAS.map((id) => ({ id, label: HEARTBEAT_AREA_LABELS[id] })),
];

const BEHAVIOR_FILTER_OPTIONS: Array<{ id: HeartbeatBehavior | "all"; label: string }> = [
  { id: "all", label: "All behaviors" },
  ...HEARTBEAT_BEHAVIORS.map((id) => ({ id, label: HEARTBEAT_BEHAVIOR_LABELS[id] })),
];

const OUTCOME_FILTER_OPTIONS: Array<{ id: ActionOutcomeFilter; label: string }> = [
  { id: "all", label: "All outcomes" },
  { id: "attention", label: "Needs attention" },
  { id: "fixed", label: "Fixed automatically" },
  { id: "ok", label: "OK" },
];

const INTERVAL_DROPDOWN_ITEMS = HEARTBEAT_INTERVAL_OPTIONS.map((minutes) => ({
  id: minutes,
  label: `Every ${minutes} minutes`,
}));

const WORKTREE_AGE_OPTIONS = [
  { id: 1, label: "1 hour" },
  { id: 6, label: "6 hours" },
  { id: 24, label: "24 hours (default)" },
  { id: 72, label: "3 days (72 hours)" },
  { id: 168, label: "7 days (168 hours)" },
] as const;

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function defaultPlaceholderActions(): HeartbeatActionRecord[] {
  return HEARTBEAT_ACTIONS.map((def) => ({
    actionId: def.id,
    title: def.title,
    area: def.area,
    behavior: def.behavior,
    status: "pending",
    startedAt: null,
    endedAt: null,
    durationMs: null,
    summary: def.description,
    remediatedCount: 0,
    findings: [],
  }));
}

function isActionMutedByPolicy(
  action: HeartbeatActionRecord,
  policy: HeartbeatPolicy,
  runMode: "maintain" | "inspect" | undefined,
): boolean {
  if (action.behavior === "check") return false;
  if (runMode === "inspect") return true;
  switch (action.actionId) {
    case "disk-pressure-guard":
      return !policy.lowDiskGuard;
    case "runtime-self-heal":
      return !policy.autoHealSidecars;
    case "clean-worktree-prune":
      return !policy.autoPruneCleanWorktrees;
    case "stuck-execution-watchdog":
      return !policy.autoStopVerifiedOrphans && !policy.autoClearVerifiedLeftoverBlock;
    default:
      return false;
  }
}

function formatHeartbeatChatPrompt(item: HeartbeatAttentionItem): string {
  const lines = [
    `Help me resolve a Code60 Heartbeat issue: ${item.finding.title}`,
    `Area: ${HEARTBEAT_AREA_LABELS[item.area]}`,
    `Observed: ${item.finding.summary}`,
  ];
  if (item.finding.howToFix) {
    lines.push(`Suggested fix: ${item.finding.howToFix}`);
  }
  lines.push("Walk me through fixing this safely.");
  return lines.join("\n");
}

export function HeartbeatPage({
  api,
  active,
  onNotify,
  onNavigate,
  onAskChat,
}: {
  api: Pick<ApplicationClient, "heartbeat" | "onHeartbeatChanged">;
  active: boolean;
  onNotify?(message: string, tone?: ToastTone): void;
  onNavigate?(link: HeartbeatDeepLink, prompt?: string): void;
  onAskChat?(prompt: string): void;
}) {
  const visible = useDocumentVisible() && active;
  const [snapshot, setSnapshot] = useState<HeartbeatSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [areaFilter, setAreaFilter] = useState<HeartbeatArea | "all">("all");
  const [behaviorFilter, setBehaviorFilter] = useState<HeartbeatBehavior | "all">("all");
  const [outcomeFilter, setOutcomeFilter] = useState<ActionOutcomeFilter>("all");
  const [search, setSearch] = useState("");
  const [expandedActions, setExpandedActions] = useState<Set<string>>(() => new Set());
  const [expandedHistory, setExpandedHistory] = useState<Set<string>>(() => new Set());
  const generation = useRef(0);
  const statusHeadingId = useId();
  const attentionHeadingId = useId();

  const loadSnapshot = useCallback(async () => {
    if (!api.heartbeat) {
      setError("Heartbeat service is unavailable in this session.");
      setLoading(false);
      return;
    }
    const owner = ++generation.current;
    try {
      const next = await api.heartbeat({ action: "snapshot" });
      if (owner !== generation.current) return;
      setSnapshot(next);
      setError("");
    } catch (cause) {
      if (owner !== generation.current) return;
      setError(cause instanceof Error ? cause.message : "Could not load Heartbeat status.");
    } finally {
      if (owner === generation.current) setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (!visible) return;
    void loadSnapshot();
    const off = api.onHeartbeatChanged?.((next) => {
      setSnapshot(next);
      setLoading(false);
    });
    return () => {
      generation.current++;
      off?.();
    };
  }, [api, visible, loadSnapshot]);

  const triggerRun = useCallback(
    async (mode: "maintain" | "inspect") => {
      if (!api.heartbeat || busy) return;
      setBusy(true);
      setError("");
      const owner = generation.current;
      try {
        const next = await api.heartbeat({ action: "run", mode });
        if (owner !== generation.current) return;
        setSnapshot(next);
        onNotify?.(
          mode === "inspect" ? "Heartbeat dry run completed." : "Heartbeat sweep completed.",
          "info",
        );
      } catch (cause) {
        if (owner !== generation.current) return;
        setError(cause instanceof Error ? cause.message : "Heartbeat run failed.");
      } finally {
        if (owner === generation.current) setBusy(false);
      }
    },
    [api, busy, onNotify],
  );

  const handleCancel = useCallback(async () => {
    if (!api.heartbeat) return;
    setError("");
    try {
      const next = await api.heartbeat({ action: "cancel" });
      setSnapshot(next);
      onNotify?.("Heartbeat cancelled.", "info");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not cancel Heartbeat.");
    }
  }, [api, onNotify]);

  const updatePolicy = useCallback(
    async (patch: Partial<HeartbeatPolicy>) => {
      if (!api.heartbeat) return;
      const current = snapshot?.policy ?? DEFAULT_HEARTBEAT_POLICY;
      const nextPolicy: HeartbeatPolicy = { ...current, ...patch };
      setError("");
      try {
        const next = await api.heartbeat({ action: "updatePolicy", policy: nextPolicy });
        setSnapshot(next);
        onNotify?.("Heartbeat policy saved.", "info");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not save Heartbeat policy.");
      }
    },
    [api, snapshot?.policy, onNotify],
  );

  const displayedRun: HeartbeatRunRecord | null =
    snapshot?.currentRun ?? snapshot?.lastCompletedRun ?? null;
  const actions = displayedRun?.actions ?? defaultPlaceholderActions();
  const isRunning = snapshot?.running === true || busy;
  const attentionItems = useMemo(
    () => collectHeartbeatAttentionItems(displayedRun),
    [displayedRun],
  );

  const progress = useMemo(() => {
    const total = actions.length;
    const completed = actions.filter(
      (a) => a.status !== "pending" && a.status !== "running",
    ).length;
    const autoFixed = actions.reduce((sum, a) => sum + a.remediatedCount, 0);
    return { total, completed, autoFixed };
  }, [actions]);

  const filteredActions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return actions.filter((action) => {
      if (areaFilter !== "all" && action.area !== areaFilter) return false;
      if (behaviorFilter !== "all" && action.behavior !== behaviorFilter) return false;
      if (outcomeFilter === "attention") {
        if (
          action.status !== "warning" &&
          action.status !== "escalated" &&
          action.status !== "failed"
        )
          return false;
      } else if (outcomeFilter === "fixed" && action.status !== "remediated") {
        return false;
      } else if (outcomeFilter === "ok" && action.status !== "passed") {
        return false;
      }
      if (!q) return true;
      return (
        action.title.toLowerCase().includes(q) ||
        action.summary.toLowerCase().includes(q) ||
        action.actionId.toLowerCase().includes(q) ||
        action.findings.some(
          (f) =>
            f.title.toLowerCase().includes(q) ||
            f.summary.toLowerCase().includes(q) ||
            (f.howToFix?.toLowerCase().includes(q) ?? false),
        )
      );
    });
  }, [actions, areaFilter, behaviorFilter, outcomeFilter, search]);

  const toggleActionExpanded = (id: string) => {
    setExpandedActions((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleHistoryExpanded = (id: string) => {
    setExpandedHistory((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const policy = snapshot?.policy ?? DEFAULT_HEARTBEAT_POLICY;
  const history = snapshot?.recentRuns ?? [];

  const verdictLabel = (() => {
    if (isRunning) return "Running heartbeat";
    if (!displayedRun) return "Not yet run";
    if (attentionItems.length > 0) {
      return `${attentionItems.length} item${attentionItems.length === 1 ? "" : "s"} need${attentionItems.length === 1 ? "s" : ""} attention`;
    }
    if (displayedRun.status === "failed") return "Check failed";
    if (displayedRun.status === "cancelled") return "Cancelled";
    return "Nothing needs attention";
  })();

  const verdictKind: IconIndicatorKind = (() => {
    if (isRunning) return "in-progress";
    if (!displayedRun) return "not-started";
    if (attentionItems.some((item) => item.finding.severity === "error")) return "failed";
    if (attentionItems.length > 0) return "caution-minor";
    return runIndicatorKind[displayedRun.status];
  })();

  return (
    <section className="heartbeat-page" aria-label="Heartbeat">
      <header className="table-controls">
        <PageTitle
          page="heartbeat"
          className="table-title"
          actions={[
            {
              id: "heartbeat-dry-run",
              label: "Dry run",
              run: () => void triggerRun("inspect"),
              disabled: isRunning,
            },
            {
              id: "heartbeat-run-now",
              label: isRunning ? "Running…" : "Run heartbeat",
              run: () => void triggerRun("maintain"),
              disabled: isRunning,
            },
          ]}
        />
      </header>

      {error && (
        <ActionableNotification
          kind="error"
          title="Heartbeat error"
          subtitle={error}
          actionButtonLabel="Retry"
          onActionButtonClick={() => void loadSnapshot()}
          lowContrast
          className="heartbeat-notification"
        />
      )}

      {snapshot?.storageWarning && (
        <ActionableNotification
          kind="warning"
          title="Heartbeat persistence warning"
          subtitle={snapshot.storageWarning}
          lowContrast
          hideCloseButton
          className="heartbeat-notification"
        />
      )}

      <section className="heartbeat-status-section" aria-labelledby={statusHeadingId}>
        <div className="heartbeat-status-header">
          <div className="heartbeat-verdict-row">
            <IconIndicator kind={verdictKind} label="" size={20} />
            <h2 id={statusHeadingId}>{verdictLabel}</h2>
            {displayedRun && (
              <Tag type={displayedRun.trigger === "manual" ? "blue" : "cool-gray"} size="sm">
                {HEARTBEAT_SOURCE_LABELS[displayedRun.trigger]}
              </Tag>
            )}
            {displayedRun?.mode === "inspect" && (
              <Tag type="purple" size="sm">
                Dry run
              </Tag>
            )}
            {attentionItems.length === 0 && progress.autoFixed > 0 && (
              <Tag type="teal" size="sm">
                {progress.autoFixed} fixed automatically
              </Tag>
            )}
            {snapshot?.lowDiskPausedByHeartbeat && (
              <Tag type="red" size="sm">
                Low-disk pause active
              </Tag>
            )}
          </div>

          <div className="heartbeat-summary-controls">
            {isRunning ? (
              <>
                <InlineLoading description="Heartbeat in progress…" />
                <Button
                  kind="danger--tertiary"
                  size="sm"
                  renderIcon={Close}
                  onClick={() => void handleCancel()}
                >
                  Cancel heartbeat
                </Button>
              </>
            ) : (
              <>
                <Button
                  kind="tertiary"
                  size="sm"
                  renderIcon={Renew}
                  onClick={() => void triggerRun("inspect")}
                  disabled={loading}
                >
                  Dry run
                </Button>
                <Button
                  kind="primary"
                  size="sm"
                  renderIcon={Play}
                  onClick={() => void triggerRun("maintain")}
                  disabled={loading}
                >
                  Run heartbeat
                </Button>
              </>
            )}
          </div>
        </div>

        <dl className="heartbeat-timing-strip" aria-label="Last heartbeat timing">
          <div className="heartbeat-timing-item" data-timing="initiated">
            <dt>Initiated</dt>
            <dd title={displayedRun?.startedAt ?? undefined}>
              {formatTimestamp(displayedRun?.startedAt)}
            </dd>
          </div>
          <div className="heartbeat-timing-item" data-timing="terminated">
            <dt>Terminated</dt>
            <dd title={displayedRun?.endedAt ?? undefined}>
              {displayedRun
                ? displayedRun.endedAt
                  ? formatTimestamp(displayedRun.endedAt)
                  : "In progress…"
                : "—"}
            </dd>
          </div>
          <div className="heartbeat-timing-item" data-timing="duration">
            <dt>Duration</dt>
            <dd>
              {displayedRun
                ? displayedRun.durationMs !== null
                  ? formatHeartbeatDuration(displayedRun.durationMs)
                  : "Running…"
                : "—"}
            </dd>
          </div>
          <div className="heartbeat-timing-item" data-timing="next">
            <dt>Next scheduled</dt>
            <dd title={snapshot?.nextRunAt ?? undefined}>
              {policy.enabled ? formatTimestamp(snapshot?.nextRunAt) : "Paused"}
            </dd>
          </div>
        </dl>

        {isRunning && (
          <div className="heartbeat-progress-wrap">
            <ProgressBar
              label="Sweep progress"
              helperText={`${progress.completed} of ${progress.total} checks finished`}
              value={progress.completed}
              max={Math.max(1, progress.total)}
            />
          </div>
        )}
      </section>

      {attentionItems.length > 0 && (
        <section className="heartbeat-attention-section" aria-labelledby={attentionHeadingId}>
          <h3 id={attentionHeadingId}>Needs attention</h3>
          <ul className="heartbeat-attention-list">
            {attentionItems.map((item) => {
              const link = item.finding.deepLink;
              return (
                <li key={item.id} className="heartbeat-attention-item">
                  <div className="heartbeat-attention-body">
                    <div className="heartbeat-attention-title-row">
                      <IconIndicator
                        kind={item.finding.severity === "error" ? "failed" : "caution-minor"}
                        label={item.finding.severity === "error" ? "Error" : "Warning"}
                      />
                      <span className="heartbeat-attention-title">{item.finding.title}</span>
                      <Tag type="outline" size="sm">
                        {HEARTBEAT_AREA_LABELS[item.area]}
                      </Tag>
                    </div>
                    <p className="heartbeat-attention-summary">{item.finding.summary}</p>
                    {item.finding.howToFix && (
                      <p className="heartbeat-attention-fix">
                        <strong>Fix:</strong> {item.finding.howToFix}
                      </p>
                    )}
                  </div>
                  <div className="heartbeat-attention-action">
                    {onAskChat && (
                      <Button
                        kind="ghost"
                        size="sm"
                        renderIcon={Chat}
                        onClick={() => onAskChat(formatHeartbeatChatPrompt(item))}
                      >
                        Ask Chat
                      </Button>
                    )}
                    {link && onNavigate ? (
                      <Button
                        kind="tertiary"
                        size="sm"
                        renderIcon={Launch}
                        onClick={() =>
                          onNavigate(
                            link,
                            link.kind === "relay" || (link.kind === "page" && link.id === "chat")
                              ? formatHeartbeatChatPrompt(item)
                              : undefined,
                          )
                        }
                      >
                        {link.label}
                      </Button>
                    ) : (
                      displayedRun?.mode === "inspect" && (
                        <Button
                          kind="tertiary"
                          size="sm"
                          renderIcon={Play}
                          disabled={isRunning}
                          onClick={() => void triggerRun("maintain")}
                        >
                          Run heartbeat
                        </Button>
                      )
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <Tabs>
        <TabList aria-label="Heartbeat details">
          <Tab>What ran</Tab>
          <Tab>History</Tab>
          <Tab>Policy</Tab>
        </TabList>
        <TabPanels>
          <TabPanel className="heartbeat-tab-panel">
            <TableContainer className="heartbeat-table-container">
              <TableToolbar>
                <TableToolbarContent>
                  <TableToolbarSearch
                    persistent
                    placeholder="Filter checks or findings"
                    value={search}
                    onChange={(event) => {
                      const target =
                        event && typeof event === "object" && "target" in event
                          ? (event.target as HTMLInputElement)
                          : null;
                      setSearch(target?.value ?? "");
                    }}
                  />
                  <div className="heartbeat-toolbar-filter">
                    <Dropdown
                      id="heartbeat-area-filter"
                      titleText=""
                      label="Area"
                      size="sm"
                      items={AREA_FILTER_OPTIONS}
                      itemToString={(item) => item?.label ?? ""}
                      selectedItem={
                        AREA_FILTER_OPTIONS.find((opt) => opt.id === areaFilter) ??
                        AREA_FILTER_OPTIONS[0]
                      }
                      onChange={({ selectedItem }) => setAreaFilter(selectedItem?.id ?? "all")}
                    />
                  </div>
                  <div className="heartbeat-toolbar-filter">
                    <Dropdown
                      id="heartbeat-behavior-filter"
                      titleText=""
                      label="Behavior"
                      size="sm"
                      items={BEHAVIOR_FILTER_OPTIONS}
                      itemToString={(item) => item?.label ?? ""}
                      selectedItem={
                        BEHAVIOR_FILTER_OPTIONS.find((opt) => opt.id === behaviorFilter) ??
                        BEHAVIOR_FILTER_OPTIONS[0]
                      }
                      onChange={({ selectedItem }) => setBehaviorFilter(selectedItem?.id ?? "all")}
                    />
                  </div>
                  <div className="heartbeat-toolbar-filter">
                    <Dropdown
                      id="heartbeat-outcome-filter"
                      titleText=""
                      label="Outcome"
                      size="sm"
                      items={OUTCOME_FILTER_OPTIONS}
                      itemToString={(item) => item?.label ?? ""}
                      selectedItem={
                        OUTCOME_FILTER_OPTIONS.find((opt) => opt.id === outcomeFilter) ??
                        OUTCOME_FILTER_OPTIONS[0]
                      }
                      onChange={({ selectedItem }) => setOutcomeFilter(selectedItem?.id ?? "all")}
                    />
                  </div>
                </TableToolbarContent>
              </TableToolbar>
              <Table size="md" aria-label="Heartbeat audit log">
                <TableHead>
                  <TableRow>
                    <TableExpandHeader id="heartbeat-actions-expand" aria-label="Expand row" />
                    <TableHeader>Action</TableHeader>
                    <TableHeader>Area</TableHeader>
                    <TableHeader>Behavior</TableHeader>
                    <TableHeader>Outcome</TableHeader>
                    <TableHeader>Duration</TableHeader>
                    <TableHeader>Summary</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredActions.map((action) => {
                    const isOpen = expandedActions.has(action.actionId);
                    const muted = isActionMutedByPolicy(action, policy, displayedRun?.mode);
                    return (
                      <Fragment key={action.actionId}>
                        <TableExpandRow
                          expandHeader="heartbeat-actions-expand"
                          isExpanded={isOpen}
                          onExpand={() => toggleActionExpanded(action.actionId)}
                          aria-label={`Details for ${action.title}`}
                        >
                          <TableCell className="heartbeat-action-name-cell">
                            <span className="heartbeat-action-name">{action.title}</span>
                          </TableCell>
                          <TableCell>
                            <Tag type="outline" size="sm">
                              {HEARTBEAT_AREA_LABELS[action.area]}
                            </Tag>
                          </TableCell>
                          <TableCell>
                            <span className="heartbeat-behavior-cell">
                              <span>{HEARTBEAT_BEHAVIOR_LABELS[action.behavior]}</span>
                              {muted && (
                                <Tag type="cool-gray" size="sm">
                                  Report only
                                </Tag>
                              )}
                            </span>
                          </TableCell>
                          <TableCell>
                            <IconIndicator
                              kind={actionIndicatorKind[action.status]}
                              label={HEARTBEAT_ACTION_STATUS_LABELS[action.status]}
                            />
                          </TableCell>
                          <TableCell className="heartbeat-tabular">
                            {formatHeartbeatDuration(action.durationMs)}
                          </TableCell>
                          <TableCell>{action.summary}</TableCell>
                        </TableExpandRow>
                        {isOpen && (
                          <TableExpandedRow colSpan={7}>
                            <div className="heartbeat-expanded-detail">
                              <dl className="heartbeat-action-times">
                                <div>
                                  <dt>Action ID</dt>
                                  <dd>
                                    <code>{action.actionId}</code>
                                  </dd>
                                </div>
                                <div>
                                  <dt>Initiated</dt>
                                  <dd title={action.startedAt ?? undefined}>
                                    {formatTimestamp(action.startedAt)}
                                  </dd>
                                </div>
                                <div>
                                  <dt>Terminated</dt>
                                  <dd title={action.endedAt ?? undefined}>
                                    {formatTimestamp(action.endedAt)}
                                  </dd>
                                </div>
                                <div>
                                  <dt>Duration</dt>
                                  <dd>{formatHeartbeatDuration(action.durationMs)}</dd>
                                </div>
                              </dl>

                              {action.findings.length > 0 ? (
                                <ul className="heartbeat-findings-list">
                                  {action.findings.map((finding) => (
                                    <li
                                      key={`${finding.code}-${finding.runId ?? finding.targetHash ?? finding.title}`}
                                      className="heartbeat-finding-row"
                                    >
                                      <Tag
                                        size="sm"
                                        type={
                                          finding.severity === "error"
                                            ? "red"
                                            : finding.severity === "warning"
                                              ? "warm-gray"
                                              : "teal"
                                        }
                                      >
                                        {finding.audience === "user"
                                          ? "Needs attention"
                                          : "Recorded"}
                                      </Tag>
                                      <div className="heartbeat-finding-copy">
                                        <strong>{finding.title}</strong> — {finding.summary}
                                        {finding.howToFix && (
                                          <div className="heartbeat-finding-fix">
                                            Fix: {finding.howToFix}
                                          </div>
                                        )}
                                      </div>
                                      {finding.deepLink && onNavigate && (
                                        <Button
                                          kind="ghost"
                                          size="sm"
                                          renderIcon={Launch}
                                          onClick={() => onNavigate(finding.deepLink!)}
                                        >
                                          {finding.deepLink.label}
                                        </Button>
                                      )}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="heartbeat-empty-findings">No findings recorded.</p>
                              )}

                              {action.deepLink && onNavigate && (
                                <div className="heartbeat-action-link">
                                  <Button
                                    kind="tertiary"
                                    size="sm"
                                    renderIcon={Launch}
                                    onClick={() => onNavigate(action.deepLink!)}
                                  >
                                    {action.deepLink.label}
                                  </Button>
                                </div>
                              )}
                            </div>
                          </TableExpandedRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </TabPanel>

          <TabPanel className="heartbeat-tab-panel">
            {history.length === 0 ? (
              <p className="heartbeat-empty-history">No completed heartbeats yet.</p>
            ) : (
              <TableContainer className="heartbeat-table-container">
                <Table size="md" aria-label="Heartbeat history">
                  <TableHead>
                    <TableRow>
                      <TableExpandHeader id="heartbeat-history-expand" aria-label="Expand run" />
                      <TableHeader>Source</TableHeader>
                      <TableHeader>Outcome</TableHeader>
                      <TableHeader>Initiated</TableHeader>
                      <TableHeader>Terminated</TableHeader>
                      <TableHeader>Duration</TableHeader>
                      <TableHeader>Attention</TableHeader>
                      <TableHeader>Auto-fixed</TableHeader>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {history.map((run) => {
                      const isOpen = expandedHistory.has(run.id);
                      const runAttentionCount = collectHeartbeatAttentionItems(run).length;
                      const totalAutoFixed = run.actions.reduce(
                        (sum, item) => sum + item.remediatedCount,
                        0,
                      );
                      return (
                        <Fragment key={run.id}>
                          <TableExpandRow
                            expandHeader="heartbeat-history-expand"
                            isExpanded={isOpen}
                            onExpand={() => toggleHistoryExpanded(run.id)}
                            aria-label={`Heartbeat run #${run.sequence}`}
                          >
                            <TableCell>
                              <Tag type={run.trigger === "manual" ? "blue" : "cool-gray"} size="sm">
                                {HEARTBEAT_SOURCE_LABELS[run.trigger]}
                              </Tag>{" "}
                              {run.mode === "inspect" && (
                                <Tag type="purple" size="sm">
                                  Dry run
                                </Tag>
                              )}
                            </TableCell>
                            <TableCell>
                              <IconIndicator
                                kind={runIndicatorKind[run.status]}
                                label={HEARTBEAT_RUN_STATUS_LABELS[run.status]}
                              />
                            </TableCell>
                            <TableCell className="heartbeat-tabular" title={run.startedAt}>
                              {formatTimestamp(run.startedAt)}
                            </TableCell>
                            <TableCell
                              className="heartbeat-tabular"
                              title={run.endedAt ?? undefined}
                            >
                              {formatTimestamp(run.endedAt)}
                            </TableCell>
                            <TableCell className="heartbeat-tabular">
                              {formatHeartbeatDuration(run.durationMs)}
                            </TableCell>
                            <TableCell className="heartbeat-tabular">{runAttentionCount}</TableCell>
                            <TableCell className="heartbeat-tabular">{totalAutoFixed}</TableCell>
                          </TableExpandRow>
                          {isOpen && (
                            <TableExpandedRow colSpan={8}>
                              <ul className="heartbeat-history-actions">
                                {run.actions.map((item) => (
                                  <li key={item.actionId}>
                                    <IconIndicator
                                      kind={actionIndicatorKind[item.status]}
                                      label={HEARTBEAT_ACTION_STATUS_LABELS[item.status]}
                                    />
                                    <strong>{item.title}</strong>
                                    <span className="heartbeat-tabular">
                                      ({formatHeartbeatDuration(item.durationMs)})
                                    </span>
                                    <span>— {item.summary}</span>
                                  </li>
                                ))}
                              </ul>
                            </TableExpandedRow>
                          )}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </TabPanel>

          <TabPanel className="heartbeat-tab-panel">
            <div className="heartbeat-policy-grid">
              <Toggle
                id="heartbeat-policy-enabled"
                labelText="Scheduled heartbeat"
                labelA="Paused"
                labelB="Enabled"
                toggled={policy.enabled}
                onToggle={(enabled) => void updatePolicy({ enabled })}
              />

              <Dropdown
                id="heartbeat-policy-interval"
                titleText="Sweep cadence"
                label="Select cadence"
                items={INTERVAL_DROPDOWN_ITEMS}
                itemToString={(item) => item?.label ?? ""}
                selectedItem={
                  INTERVAL_DROPDOWN_ITEMS.find((i) => i.id === policy.intervalMinutes) ??
                  INTERVAL_DROPDOWN_ITEMS[1]
                }
                onChange={({ selectedItem }) => {
                  if (selectedItem) void updatePolicy({ intervalMinutes: selectedItem.id });
                }}
              />

              <Toggle
                id="heartbeat-policy-worktrees"
                labelText="Clean code60/* worktrees automatically"
                labelA="Report only"
                labelB="Auto-clean"
                toggled={policy.autoPruneCleanWorktrees}
                onToggle={(autoPruneCleanWorktrees) =>
                  void updatePolicy({ autoPruneCleanWorktrees })
                }
              />

              <Dropdown
                id="heartbeat-policy-worktree-age"
                titleText="Minimum age before cleaning worktrees"
                label="Select minimum age"
                disabled={!policy.autoPruneCleanWorktrees}
                items={[...WORKTREE_AGE_OPTIONS]}
                itemToString={(item) => item?.label ?? ""}
                selectedItem={
                  WORKTREE_AGE_OPTIONS.find((i) => i.id === policy.cleanWorktreeMinAgeHours) ??
                  WORKTREE_AGE_OPTIONS[2]
                }
                onChange={({ selectedItem }) => {
                  if (selectedItem) {
                    void updatePolicy({ cleanWorktreeMinAgeHours: selectedItem.id });
                  }
                }}
              />

              <Toggle
                id="heartbeat-policy-orphans"
                labelText="Stop verified orphan agent processes"
                labelA="Alert only"
                labelB="Auto-stop"
                toggled={policy.autoStopVerifiedOrphans}
                onToggle={(autoStopVerifiedOrphans) =>
                  void updatePolicy({ autoStopVerifiedOrphans })
                }
              />

              <Toggle
                id="heartbeat-policy-leftover-block"
                labelText="Clear verified leftover-agent scheduler block"
                labelA="Manual clear"
                labelB="Auto-clear"
                toggled={policy.autoClearVerifiedLeftoverBlock}
                onToggle={(autoClearVerifiedLeftoverBlock) =>
                  void updatePolicy({ autoClearVerifiedLeftoverBlock })
                }
              />

              <Toggle
                id="heartbeat-policy-sidecars"
                labelText="Restart unresponsive stateless sidecars"
                labelA="Report only"
                labelB="Auto-restart"
                toggled={policy.autoHealSidecars}
                onToggle={(autoHealSidecars) => void updatePolicy({ autoHealSidecars })}
              />

              <Toggle
                id="heartbeat-policy-disk"
                labelText="Pause schedules below 2 GiB free (resume above 4 GiB)"
                labelA="Disabled"
                labelB="Enabled"
                toggled={policy.lowDiskGuard}
                onToggle={(lowDiskGuard) => void updatePolicy({ lowDiskGuard })}
              />
            </div>
          </TabPanel>
        </TabPanels>
      </Tabs>
    </section>
  );
}
