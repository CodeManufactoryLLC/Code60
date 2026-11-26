import {
  Accordion,
  AccordionItem,
  Button,
  Dropdown,
  InlineNotification,
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
  TabPanel,
  TabPanels,
  Tabs,
  Tag,
  Tile,
} from "@carbon/react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type ApplicationClient,
  USAGE_SURFACES,
  USAGE_TIME_RANGES,
  type UsageAggregateMetrics,
  type UsageConfidence,
  type UsageExportFormat,
  type UsageHotspot,
  type UsageReport,
  type UsageSurface,
  type UsageTimeRange,
  type UsageTurnPage,
  type UsageTurnRecord,
} from "../bridge/index.js";
import { PageTitle } from "./page-title.js";
import { useDocumentVisible } from "./use-document-visible.js";

const SURFACE_LABELS: Record<UsageSurface, string> = {
  relay: "Relay",
  "custom-assistant": "Custom Assistants",
  "project-chat": "Project Chats",
  worker: "Workers",
  "scheduled-job": "Scheduled Jobs",
  workflow: "Workflows",
  helper: "Background Helpers",
};

const RANGE_LABELS: Record<UsageTimeRange, string> = {
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  all: "All retained (90d)",
};

const CONFIDENCE_LABELS: Record<
  UsageConfidence,
  { label: string; tagType: "green" | "blue" | "gray" }
> = {
  exact: { label: "Exact", tagType: "green" },
  derived: { label: "Derived", tagType: "blue" },
  lower_bound: { label: "Lower bound", tagType: "gray" },
};

const TURN_PAGE_SIZE = 50;

function formatNumber(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function formatCosts(metrics: UsageAggregateMetrics): string {
  if (metrics.costs.length === 0) return "Not reported";
  return metrics.costs
    .map((entry) =>
      entry.currency === "USD"
        ? `$${entry.amount.toFixed(4)}`
        : `${entry.amount.toFixed(4)} ${entry.currency}`,
    )
    .join(" · ");
}

function formatSurfaceLabel(surface: UsageSurface, helperKind: string | null): string {
  const base = SURFACE_LABELS[surface] ?? surface;
  return helperKind ? `${base} (${helperKind})` : base;
}

function formatMix(metrics: UsageAggregateMetrics): string {
  if (metrics.turns === 0) return "No turns";
  const pct = (count: number) => Math.round((count / metrics.turns) * 100);
  const parts: string[] = [];
  if (metrics.exactTurns > 0) parts.push(`${pct(metrics.exactTurns)}% exact`);
  if (metrics.derivedTurns > 0) parts.push(`${pct(metrics.derivedTurns)}% derived`);
  if (metrics.lowerBoundTurns > 0) parts.push(`${pct(metrics.lowerBoundTurns)}% lower-bound`);
  return parts.join(" · ");
}

function hotspotTargetId(spot: UsageHotspot): string {
  return spot.workflowId ?? spot.conversationId ?? spot.runId ?? spot.sessionId;
}

function triggerDownload(filename: string, mimeType: string, content: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

type TurnScope =
  | { kind: "workflow"; id: string; label: string }
  | { kind: "conversation"; id: string; label: string }
  | { kind: "run"; id: string; label: string }
  | { kind: "session"; id: string; label: string };

export function UsagePage({
  api,
  active,
  onNotify,
}: {
  api: Pick<
    ApplicationClient,
    "usageReport" | "usageTurns" | "usageExport" | "usageClear" | "onUsageChanged"
  >;
  active: boolean;
  onNotify?: (message: string) => void;
}) {
  const visible = useDocumentVisible();
  const [range, setRange] = useState<UsageTimeRange>("7d");
  const [providerFilter, setProviderFilter] = useState<string>("all");
  const [surfaceFilter, setSurfaceFilter] = useState<string>("all");
  const [confidenceFilter, setConfidenceFilter] = useState<string>("all");
  const [tabIndex, setTabIndex] = useState(0);
  const [turnOffset, setTurnOffset] = useState(0);
  const [turnScope, setTurnScope] = useState<TurnScope | null>(null);
  const [expandedTurns, setExpandedTurns] = useState<Record<string, boolean>>({});
  const [report, setReport] = useState<UsageReport | null>(null);
  const [turnPage, setTurnPage] = useState<UsageTurnPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState<UsageExportFormat | null>(null);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const queryBase = useMemo(
    () => ({
      range,
      ...(providerFilter !== "all" ? { provider: providerFilter } : {}),
      ...(surfaceFilter !== "all" ? { surface: surfaceFilter as UsageSurface } : {}),
    }),
    [range, providerFilter, surfaceFilter],
  );

  const loadData = useCallback(async () => {
    if (!api.usageReport || !api.usageTurns) {
      setError("Usage monitoring is unavailable in this backend.");
      return;
    }
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const [nextReport, nextTurns] = await Promise.all([
        api.usageReport(queryBase),
        api.usageTurns({
          ...queryBase,
          ...(confidenceFilter !== "all"
            ? { confidence: confidenceFilter as UsageConfidence }
            : {}),
          ...(turnScope?.kind === "workflow" ? { workflowId: turnScope.id } : {}),
          ...(turnScope?.kind === "conversation" ? { conversationId: turnScope.id } : {}),
          ...(turnScope?.kind === "run" ? { runId: turnScope.id } : {}),
          ...(turnScope?.kind === "session" ? { sessionId: turnScope.id } : {}),
          limit: TURN_PAGE_SIZE,
          offset: turnOffset,
        }),
      ]);
      if (seq !== requestSeq.current) return;
      setReport(nextReport);
      setTurnPage(nextTurns);
    } catch (cause) {
      if (seq !== requestSeq.current) return;
      setError(cause instanceof Error ? cause.message : "Could not load usage report.");
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [api, queryBase, confidenceFilter, turnScope, turnOffset]);

  useEffect(() => {
    if (!active) return;
    void loadData();
  }, [active, loadData]);

  useEffect(() => {
    if (!active || !visible || !api.onUsageChanged) return;
    return api.onUsageChanged(() => {
      void loadData();
    });
  }, [active, visible, api, loadData]);

  const handleExport = async (format: UsageExportFormat) => {
    if (!api.usageExport) return;
    setExporting(format);
    setError(null);
    try {
      const result = await api.usageExport({
        ...queryBase,
        format,
        includeTurns: true,
      });
      triggerDownload(result.filename, result.mimeType, result.content);
      onNotify?.(`Exported ${result.filename}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not export usage report.");
    } finally {
      setExporting(null);
    }
  };

  const handleClear = async () => {
    if (!api.usageClear) return;
    setClearing(true);
    setError(null);
    try {
      const result = await api.usageClear();
      if (result.cleared) {
        onNotify?.(`Cleared ${formatNumber(result.deleted)} usage records`);
        setTurnOffset(0);
        setTurnScope(null);
        await loadData();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not clear usage history.");
    } finally {
      setClearing(false);
    }
  };

  const inspectHotspot = (spot: UsageHotspot) => {
    const scope: TurnScope = spot.workflowId
      ? { kind: "workflow", id: spot.workflowId, label: `Workflow ${spot.workflowId}` }
      : spot.conversationId
        ? {
            kind: "conversation",
            id: spot.conversationId,
            label: `Conversation ${spot.conversationId}`,
          }
        : spot.runId
          ? { kind: "run", id: spot.runId, label: `Run ${spot.runId}` }
          : { kind: "session", id: spot.sessionId, label: `Session ${spot.sessionId}` };
    setTurnScope(scope);
    setTurnOffset(0);
    setTabIndex(2);
  };

  const knownProviders = useMemo(() => {
    const names = new Set<string>();
    if (providerFilter !== "all") names.add(providerFilter);
    for (const entry of report?.providers ?? []) names.add(entry.provider);
    return [...names].sort();
  }, [providerFilter, report]);

  const maxTimelineTokens = useMemo(
    () => Math.max(1, ...(report?.timeline.map((b) => b.totalTokens) ?? [1])),
    [report],
  );

  const totals = report?.totals;

  return (
    <section className="usage-page" aria-label="Usage">
      <header className="table-controls">
        <PageTitle
          page="usage"
          className="table-title"
          actions={[
            {
              id: "usage-refresh",
              label: loading ? "Refreshing…" : "Refresh",
              run: () => void loadData(),
              disabled: loading,
            },
            {
              id: "usage-clear",
              label: clearing ? "Clearing…" : "Clear usage history",
              run: () => void handleClear(),
              disabled: clearing || loading || (report?.status.totalStoredTurns ?? 0) === 0,
            },
          ]}
        />
      </header>

      {error && (
        <InlineNotification
          kind="error"
          title="Usage monitoring error"
          subtitle={error}
          lowContrast
          hideCloseButton
        />
      )}

      {report?.status.unavailable && (
        <InlineNotification
          kind="warning"
          title="Usage store unavailable"
          subtitle="Local usage persistence could not be opened. Execution continues normally."
          lowContrast
          hideCloseButton
        />
      )}

      <div className="usage-toolbar">
        <div className="usage-filters">
          <Dropdown
            id="usage-range-select"
            titleText="Time window"
            label="Time window"
            size="sm"
            className="usage-filter-select"
            items={[...USAGE_TIME_RANGES]}
            selectedItem={range}
            itemToString={(item) => (item ? RANGE_LABELS[item] : "")}
            onChange={({ selectedItem }) => {
              if (selectedItem) {
                setRange(selectedItem);
                setTurnOffset(0);
              }
            }}
          />

          <Dropdown
            id="usage-provider-select"
            titleText="Provider"
            label="Provider"
            size="sm"
            className="usage-filter-select"
            items={["all", ...knownProviders]}
            selectedItem={providerFilter}
            itemToString={(item) => (item === "all" ? "All providers" : (item ?? ""))}
            onChange={({ selectedItem }) => {
              if (selectedItem) {
                setProviderFilter(selectedItem);
                setTurnOffset(0);
              }
            }}
          />

          <Dropdown
            id="usage-surface-select"
            titleText="Surface"
            label="Surface"
            size="sm"
            className="usage-filter-select"
            items={["all", ...USAGE_SURFACES]}
            selectedItem={surfaceFilter}
            itemToString={(item) =>
              item === "all" ? "All surfaces" : item ? SURFACE_LABELS[item as UsageSurface] : ""
            }
            onChange={({ selectedItem }) => {
              if (selectedItem) {
                setSurfaceFilter(selectedItem);
                setTurnOffset(0);
              }
            }}
          />
        </div>

        <div className="usage-export-actions">
          <Button
            kind="tertiary"
            size="sm"
            disabled={exporting !== null}
            onClick={() => void handleExport("markdown")}
          >
            {exporting === "markdown" ? "Exporting…" : "Export Markdown"}
          </Button>
          <Button
            kind="tertiary"
            size="sm"
            disabled={exporting !== null}
            onClick={() => void handleExport("json")}
          >
            {exporting === "json" ? "Exporting…" : "Export JSON"}
          </Button>
          <Button
            kind="tertiary"
            size="sm"
            disabled={exporting !== null}
            onClick={() => void handleExport("csv")}
          >
            {exporting === "csv" ? "Exporting…" : "Export CSV"}
          </Button>
        </div>
      </div>

      <section className="usage-kpi-grid" aria-label="Usage overview">
        <Tile className="usage-kpi-tile">
          <span className="usage-kpi-label">Estimated total tokens</span>
          <strong className="usage-kpi-value">{formatNumber(totals?.totalTokens ?? 0)}</strong>
          <span className="usage-kpi-meta">
            {formatNumber(totals?.newInputTokens ?? 0)} new ·{" "}
            {formatNumber(totals?.cachedOrRereadInputTokens ?? 0)} cached/re-read ·{" "}
            {formatNumber(totals?.outputTokens ?? 0)} output
          </span>
        </Tile>

        <Tile className="usage-kpi-tile">
          <span className="usage-kpi-label">Turns recorded</span>
          <strong className="usage-kpi-value">{formatNumber(totals?.turns ?? 0)}</strong>
          <div className="usage-tags">
            <Tag type="green" size="sm">
              Exact: {formatNumber(totals?.exactTurns ?? 0)}
            </Tag>
            <Tag type="blue" size="sm">
              Derived: {formatNumber(totals?.derivedTurns ?? 0)}
            </Tag>
            <Tag type="gray" size="sm">
              Lower bound: {formatNumber(totals?.lowerBoundTurns ?? 0)}
            </Tag>
          </div>
        </Tile>

        <Tile className="usage-kpi-tile">
          <span className="usage-kpi-label">Net context added</span>
          <strong className="usage-kpi-value">{formatNumber(totals?.netContextDelta ?? 0)}</strong>
          <span className="usage-kpi-meta">
            {formatNumber(totals?.toolCalls ?? 0)} tool calls ·{" "}
            {formatNumber(totals?.toolWaves ?? 0)} waves · {formatNumber(totals?.compactions ?? 0)}{" "}
            compactions
          </span>
        </Tile>

        <Tile className="usage-kpi-tile">
          <span className="usage-kpi-label">Provider-reported cost</span>
          <strong className="usage-kpi-value">
            {totals ? formatCosts(totals) : "Not reported"}
          </strong>
          <span className="usage-kpi-meta">
            Retained turns: {formatNumber(report?.status.totalStoredTurns ?? 0)} (
            {report?.retentionDays ?? 90}d cap)
          </span>
        </Tile>
      </section>

      <Tabs selectedIndex={tabIndex} onChange={({ selectedIndex }) => setTabIndex(selectedIndex)}>
        <TabList aria-label="Usage report sections" contained>
          <Tab>Provider burn rate</Tab>
          <Tab>Chats &amp; workflows</Tab>
          <Tab>Turn inspector</Tab>
        </TabList>
        <TabPanels>
          {/* Tab 1: Provider Burn Rate */}
          <TabPanel>
            <section className="usage-section">
              <h2 className="usage-section-heading">Burn rate by provider and model</h2>
              {!report || report.providers.length === 0 ? (
                <div className="usage-empty">
                  No turns recorded in the selected window. Run any chat, worker, workflow, or
                  scheduled job to populate token estimates.
                </div>
              ) : (
                <TableContainer className="usage-table-wrap">
                  <Table size="md" aria-label="Provider burn rate">
                    <TableHead>
                      <TableRow>
                        <TableHeader>Provider / Model</TableHeader>
                        <TableHeader className="usage-num">Turns</TableHeader>
                        <TableHeader className="usage-num">Est. Total</TableHeader>
                        <TableHeader className="usage-num">New Input</TableHeader>
                        <TableHeader className="usage-num">Cached / Re-read</TableHeader>
                        <TableHeader className="usage-num">Output</TableHeader>
                        <TableHeader className="usage-num">Net Context Δ</TableHeader>
                        <TableHeader className="usage-num">Reported Cost</TableHeader>
                        <TableHeader>Measurement Mix</TableHeader>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {report.providers.map((provider) => (
                        <Fragment key={provider.provider}>
                          <TableRow>
                            <TableCell>
                              <strong>{provider.provider}</strong>
                            </TableCell>
                            <TableCell className="usage-num">
                              {formatNumber(provider.turns)}
                            </TableCell>
                            <TableCell className="usage-num">
                              <strong>{formatNumber(provider.totalTokens)}</strong>
                            </TableCell>
                            <TableCell className="usage-num">
                              {formatNumber(provider.newInputTokens)}
                            </TableCell>
                            <TableCell className="usage-num">
                              {formatNumber(provider.cachedOrRereadInputTokens)}
                            </TableCell>
                            <TableCell className="usage-num">
                              {formatNumber(provider.outputTokens)}
                            </TableCell>
                            <TableCell className="usage-num">
                              {formatNumber(provider.netContextDelta)}
                            </TableCell>
                            <TableCell className="usage-num">{formatCosts(provider)}</TableCell>
                            <TableCell>{formatMix(provider)}</TableCell>
                          </TableRow>
                          {provider.models.map((model) => (
                            <TableRow
                              key={`${provider.provider}:${model.model}`}
                              className="usage-model-row"
                            >
                              <TableCell className="usage-mono">↳ {model.model}</TableCell>
                              <TableCell className="usage-num">
                                {formatNumber(model.turns)}
                              </TableCell>
                              <TableCell className="usage-num">
                                {formatNumber(model.totalTokens)}
                              </TableCell>
                              <TableCell className="usage-num">
                                {formatNumber(model.newInputTokens)}
                              </TableCell>
                              <TableCell className="usage-num">
                                {formatNumber(model.cachedOrRereadInputTokens)}
                              </TableCell>
                              <TableCell className="usage-num">
                                {formatNumber(model.outputTokens)}
                              </TableCell>
                              <TableCell className="usage-num">
                                {formatNumber(model.netContextDelta)}
                              </TableCell>
                              <TableCell className="usage-num">{formatCosts(model)}</TableCell>
                              <TableCell>{formatMix(model)}</TableCell>
                            </TableRow>
                          ))}
                        </Fragment>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}

              {report && report.timeline.length > 0 && (
                <section aria-label="Token usage timeline">
                  <h2 className="usage-section-heading">Burn timeline</h2>
                  <div className="usage-timeline-bars">
                    {report.timeline.map((bucket) => (
                      <div key={bucket.bucket} className="usage-timeline-row">
                        <span className="usage-mono">{bucket.bucket}</span>
                        <div className="usage-timeline-track" aria-hidden="true">
                          <div
                            className="usage-timeline-fill"
                            style={{
                              width: `${Math.max(2, Math.round((bucket.totalTokens / maxTimelineTokens) * 100))}%`,
                            }}
                          />
                        </div>
                        <span className="usage-num">{formatNumber(bucket.totalTokens)} tok</span>
                        <span className="usage-num">{formatNumber(bucket.turns)} turns</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </section>
          </TabPanel>

          {/* Tab 2: Chats & Workflows Hotspots */}
          <TabPanel>
            <section className="usage-section">
              <h2 className="usage-section-heading">Breakdown by surface</h2>
              {!report || report.surfaces.length === 0 ? (
                <div className="usage-empty">No surface data recorded in this window.</div>
              ) : (
                <TableContainer className="usage-table-wrap">
                  <Table size="md" aria-label="Usage by surface">
                    <TableHead>
                      <TableRow>
                        <TableHeader>Surface</TableHeader>
                        <TableHeader className="usage-num">Turns</TableHeader>
                        <TableHeader className="usage-num">Est. Total</TableHeader>
                        <TableHeader className="usage-num">New Input</TableHeader>
                        <TableHeader className="usage-num">Cached / Re-read</TableHeader>
                        <TableHeader className="usage-num">Output</TableHeader>
                        <TableHeader className="usage-num">Tool Waves</TableHeader>
                        <TableHeader className="usage-num">Compactions</TableHeader>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {report.surfaces.map((entry) => (
                        <TableRow key={`${entry.surface}:${entry.helperKind ?? ""}`}>
                          <TableCell>
                            {formatSurfaceLabel(entry.surface, entry.helperKind)}
                          </TableCell>
                          <TableCell className="usage-num">{formatNumber(entry.turns)}</TableCell>
                          <TableCell className="usage-num">
                            <strong>{formatNumber(entry.totalTokens)}</strong>
                          </TableCell>
                          <TableCell className="usage-num">
                            {formatNumber(entry.newInputTokens)}
                          </TableCell>
                          <TableCell className="usage-num">
                            {formatNumber(entry.cachedOrRereadInputTokens)}
                          </TableCell>
                          <TableCell className="usage-num">
                            {formatNumber(entry.outputTokens)}
                          </TableCell>
                          <TableCell className="usage-num">
                            {formatNumber(entry.toolWaves)}
                          </TableCell>
                          <TableCell className="usage-num">
                            {formatNumber(entry.compactions)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}

              <h2 className="usage-section-heading">Heavy sessions &amp; workflows (hotspots)</h2>
              {!report || report.hotspots.length === 0 ? (
                <div className="usage-empty">No session or workflow hotspots recorded yet.</div>
              ) : (
                <TableContainer className="usage-table-wrap">
                  <Table size="md" aria-label="Heavy sessions and workflows">
                    <TableHead>
                      <TableRow>
                        <TableHeader>Target</TableHeader>
                        <TableHeader>Surface</TableHeader>
                        <TableHeader>Provider / Model</TableHeader>
                        <TableHeader className="usage-num">Turns</TableHeader>
                        <TableHeader className="usage-num">Est. Total</TableHeader>
                        <TableHeader className="usage-num">Net Context Δ</TableHeader>
                        <TableHeader className="usage-num">Peak Fill</TableHeader>
                        <TableHeader className="usage-num">Max Waves</TableHeader>
                        <TableHeader className="usage-num">Compactions</TableHeader>
                        <TableHeader>Audit</TableHeader>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {report.hotspots.map((spot) => (
                        <TableRow key={spot.key}>
                          <TableCell className="usage-mono">{hotspotTargetId(spot)}</TableCell>
                          <TableCell>{formatSurfaceLabel(spot.surface, spot.helperKind)}</TableCell>
                          <TableCell>
                            {spot.provider}
                            {spot.model ? ` / ${spot.model}` : ""}
                          </TableCell>
                          <TableCell className="usage-num">{formatNumber(spot.turns)}</TableCell>
                          <TableCell className="usage-num">
                            <strong>{formatNumber(spot.totalTokens)}</strong>
                          </TableCell>
                          <TableCell className="usage-num">
                            {formatNumber(spot.netContextDelta)}
                          </TableCell>
                          <TableCell className="usage-num">
                            {spot.peakContextPercent !== null
                              ? `${spot.peakContextPercent.toFixed(1)}%`
                              : "—"}
                          </TableCell>
                          <TableCell className="usage-num">
                            {formatNumber(spot.maxToolWaves)}
                          </TableCell>
                          <TableCell className="usage-num">
                            {formatNumber(spot.compactions)}
                          </TableCell>
                          <TableCell>
                            <Button kind="ghost" size="sm" onClick={() => inspectHotspot(spot)}>
                              Inspect turns
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </section>
          </TabPanel>

          {/* Tab 3: Turn Inspector */}
          <TabPanel>
            <section className="usage-section">
              <div className="usage-toolbar">
                <Dropdown
                  id="usage-confidence-select"
                  titleText="Confidence tier"
                  label="Confidence tier"
                  size="sm"
                  className="usage-filter-select"
                  items={["all", "exact", "derived", "lower_bound"]}
                  selectedItem={confidenceFilter}
                  itemToString={(item) => {
                    if (item === "all") return "All tiers";
                    if (item === "exact") return "Exact (ACP reported)";
                    if (item === "derived") return "Derived (context / wave)";
                    if (item === "lower_bound") return "Lower bound (wire text)";
                    return "";
                  }}
                  onChange={({ selectedItem }) => {
                    if (selectedItem) {
                      setConfidenceFilter(selectedItem);
                      setTurnOffset(0);
                    }
                  }}
                />
              </div>

              {turnScope && (
                <div className="usage-scope-banner" role="status">
                  <span>
                    Scoped to <strong>{turnScope.label}</strong>
                  </span>
                  <Button
                    kind="ghost"
                    size="sm"
                    onClick={() => {
                      setTurnScope(null);
                      setTurnOffset(0);
                    }}
                  >
                    Clear scope
                  </Button>
                </div>
              )}

              {!turnPage || turnPage.turns.length === 0 ? (
                <div className="usage-empty">No turns match the current filters.</div>
              ) : (
                <>
                  <TableContainer className="usage-table-wrap">
                    <Table size="md" aria-label="Turn-level usage audit log">
                      <TableHead>
                        <TableRow>
                          <TableExpandHeader
                            id="usage-turn-expand-header"
                            aria-label="Expand row"
                          />
                          <TableHeader>Time (UTC)</TableHeader>
                          <TableHeader>Provider / Model</TableHeader>
                          <TableHeader>Surface</TableHeader>
                          <TableHeader className="usage-num">Turn</TableHeader>
                          <TableHeader>Confidence</TableHeader>
                          <TableHeader className="usage-num">Est. Total</TableHeader>
                          <TableHeader className="usage-num">Net Δ</TableHeader>
                          <TableHeader className="usage-num">Waves</TableHeader>
                          <TableHeader>Compacted</TableHeader>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {turnPage.turns.map((turn: UsageTurnRecord) => {
                          const isExpanded = Boolean(expandedTurns[turn.id]);
                          const conf = CONFIDENCE_LABELS[turn.estimate.confidence];
                          return (
                            <Fragment key={turn.id}>
                              <TableExpandRow
                                aria-label={`Inspect turn ${turn.turn}`}
                                expandHeader="usage-turn-expand-header"
                                isExpanded={isExpanded}
                                onExpand={() =>
                                  setExpandedTurns((prev) => ({
                                    ...prev,
                                    [turn.id]: !prev[turn.id],
                                  }))
                                }
                              >
                                <TableCell className="usage-mono">
                                  {turn.at.slice(0, 19).replace("T", " ")}
                                </TableCell>
                                <TableCell>
                                  {turn.provider}
                                  {turn.model ? ` / ${turn.model}` : ""}
                                </TableCell>
                                <TableCell>
                                  {formatSurfaceLabel(
                                    turn.attribution.surface,
                                    turn.attribution.helperKind ?? null,
                                  )}
                                </TableCell>
                                <TableCell className="usage-num">{turn.turn}</TableCell>
                                <TableCell>
                                  <Tag type={conf.tagType} size="sm">
                                    {conf.label}
                                  </Tag>
                                </TableCell>
                                <TableCell className="usage-num">
                                  <strong>{formatNumber(turn.estimate.totalTokens)}</strong>
                                </TableCell>
                                <TableCell className="usage-num">
                                  {turn.estimate.netContextDelta !== null
                                    ? formatNumber(turn.estimate.netContextDelta)
                                    : "—"}
                                </TableCell>
                                <TableCell className="usage-num">
                                  {turn.observed.toolWaves}
                                </TableCell>
                                <TableCell>{turn.context.compacted ? "Yes" : "No"}</TableCell>
                              </TableExpandRow>
                              {isExpanded && (
                                <TableExpandedRow colSpan={10}>
                                  <div className="usage-turn-detail">
                                    <div className="usage-detail-group">
                                      <h3 className="usage-detail-title">Estimation Breakdown</h3>
                                      <dl className="usage-detail-list">
                                        <dt>Method</dt>
                                        <dd className="usage-mono">{turn.estimate.method}</dd>
                                        <dt>Estimator</dt>
                                        <dd>v{turn.estimate.estimatorVersion}</dd>
                                        <dt>New input</dt>
                                        <dd>{formatNumber(turn.estimate.newInputTokens)} tok</dd>
                                        <dt>Cached / re-read</dt>
                                        <dd>
                                          {formatNumber(turn.estimate.cachedOrRereadInputTokens)}{" "}
                                          tok
                                        </dd>
                                        <dt>Output</dt>
                                        <dd>{formatNumber(turn.estimate.outputTokens)} tok</dd>
                                        <dt>Stop reason</dt>
                                        <dd className="usage-mono">
                                          {turn.stopReason} ({formatNumber(turn.durationMs)} ms)
                                        </dd>
                                      </dl>
                                    </div>

                                    <div className="usage-detail-group">
                                      <h3 className="usage-detail-title">Context &amp; Tools</h3>
                                      <dl className="usage-detail-list">
                                        <dt>Context used</dt>
                                        <dd>
                                          {turn.context.usedBefore ?? "—"} →{" "}
                                          {turn.context.usedAfter ?? "—"}
                                        </dd>
                                        <dt>Window size</dt>
                                        <dd>
                                          {turn.context.windowSize !== null
                                            ? formatNumber(turn.context.windowSize)
                                            : "—"}
                                        </dd>
                                        <dt>usage_update count</dt>
                                        <dd>
                                          {turn.context.updatesCount} (
                                          {turn.context.snapshots.length} distinct)
                                        </dd>
                                        <dt>Tool calls / waves</dt>
                                        <dd>
                                          {turn.observed.toolCallCount} calls in{" "}
                                          {turn.observed.toolWaves} waves
                                        </dd>
                                        <dt>Observed chars</dt>
                                        <dd>
                                          prompt {formatNumber(turn.observed.promptChars)} · msg{" "}
                                          {formatNumber(turn.observed.messageChars)} · thought{" "}
                                          {formatNumber(turn.observed.thoughtChars)}
                                        </dd>
                                      </dl>
                                    </div>

                                    <div className="usage-detail-group">
                                      <h3 className="usage-detail-title">
                                        Attribution &amp; Reported
                                      </h3>
                                      <dl className="usage-detail-list">
                                        <dt>Session ID</dt>
                                        <dd className="usage-mono">{turn.sessionId}</dd>
                                        {turn.attribution.runId && (
                                          <>
                                            <dt>Run ID</dt>
                                            <dd className="usage-mono">{turn.attribution.runId}</dd>
                                          </>
                                        )}
                                        {turn.attribution.workflowId && (
                                          <>
                                            <dt>Workflow ID</dt>
                                            <dd className="usage-mono">
                                              {turn.attribution.workflowId}
                                            </dd>
                                          </>
                                        )}
                                        {turn.reported && (
                                          <>
                                            <dt>ACP reported</dt>
                                            <dd>
                                              in {formatNumber(turn.reported.inputTokens)} · out{" "}
                                              {formatNumber(turn.reported.outputTokens)} · cache{" "}
                                              {formatNumber(turn.reported.cachedReadTokens ?? 0)}
                                            </dd>
                                          </>
                                        )}
                                        {turn.cost && (
                                          <>
                                            <dt>Reported cost Δ</dt>
                                            <dd>
                                              {turn.cost.currency === "USD"
                                                ? `$${turn.cost.delta.toFixed(4)}`
                                                : `${turn.cost.delta.toFixed(4)} ${turn.cost.currency}`}
                                            </dd>
                                          </>
                                        )}
                                      </dl>
                                    </div>
                                  </div>
                                </TableExpandedRow>
                              )}
                            </Fragment>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </TableContainer>

                  <div className="usage-pagination">
                    <span>
                      Showing {turnPage.offset + 1}–{turnPage.offset + turnPage.turns.length} of{" "}
                      {formatNumber(turnPage.total)} turns
                    </span>
                    <div className="usage-pagination-buttons">
                      <Button
                        kind="secondary"
                        size="sm"
                        disabled={turnOffset === 0 || loading}
                        onClick={() => setTurnOffset((prev) => Math.max(0, prev - TURN_PAGE_SIZE))}
                      >
                        Previous
                      </Button>
                      <Button
                        kind="secondary"
                        size="sm"
                        disabled={!turnPage.hasMore || loading}
                        onClick={() => setTurnOffset((prev) => prev + TURN_PAGE_SIZE)}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </section>
          </TabPanel>
        </TabPanels>
      </Tabs>

      <Accordion className="usage-methodology">
        <AccordionItem title="How Code60 estimates tokens (3-tier methodology &amp; privacy)">
          <p>
            <strong>Tier 1 — Exact (acp_reported):</strong> Uses provider-reported input,
            cached-read, output, and thought token counts from ACP <code>PromptResponse.usage</code>{" "}
            whenever the adapter emits them.
          </p>
          <p>
            <strong>Tier 2 — Derived (usage_update_sum / context_wave_model):</strong> Uses ACP{" "}
            <code>usage_update</code> context occupancy snapshots and observed tool-call waves to
            separate net context growth from repeated context re-reads across internal tool loops.
          </p>
          <p>
            <strong>Tier 3 — Lower bound (text_lower_bound):</strong> Estimates tokens from observed
            ACP wire bytes (~4.0 B/token prose, ~3.4 B/token code) when a provider emits no usage
            metadata. Hidden harness system prompts and unstreamed local tool outputs are invisible
            across ACP.
          </p>
          <p>
            <strong>Privacy:</strong> Local storage at{" "}
            <code>$XDG_STATE_HOME/code60/usage/usage.sqlite</code> retains only timestamps,
            provider/model IDs, surface roles, opaque IDs, and numeric counts — never prompts,
            replies, source code, or file paths.
          </p>
        </AccordionItem>
      </Accordion>
    </section>
  );
}
