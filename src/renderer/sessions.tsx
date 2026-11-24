import { useCallback, useId, useMemo } from "react";
import type { RunEvent } from "../core/index.js";
import { DataTable, type TableOptions } from "./data-table.js";
import { Icon } from "./icons.js";
import { type SessionRow, statusSpec } from "./session-presentation.js";
import type { Rectangle } from "./table-types.js";
import { useTableView } from "./table-view.js";
import {
  bucketCount,
  describeBuckets,
  describeHistory,
  describeTurns,
  eventTotal,
  historySeconds,
  latestTurn,
  type Telemetry,
  telemetry,
} from "./telemetry.js";
import { useTicker } from "./ticker.js";

const started = new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" });

type ChartRow = SessionRow & {
  telemetry: Telemetry;
  /** Sort keys for the chart columns; unavailable telemetry sorts first. */
  turnTime: number;
  activity: number;
  history: string;
};
type Key =
  | "agent"
  | "statusLabel"
  | "turns"
  | "approvals"
  | "shortId"
  | "pid"
  | "branch"
  | "startedAt"
  | "turnTime"
  | "activity"
  | "history";
const chartColumns: { key: Key; title: string; width: number; filter?: "number" }[] = [
  { key: "turnTime", title: "Turn time", width: 140, filter: "number" },
  { key: "activity", title: "Events, 5 min", width: 130, filter: "number" },
  { key: "history", title: "Last 2 min", width: 184 },
];
const columns: {
  key: Key;
  title: string;
  width: number;
  filter?: "category" | "date" | "number";
}[] = [
  { key: "agent", title: "Agent", width: 95, filter: "category" },
  { key: "statusLabel", title: "Status", width: 148, filter: "category" },
  { key: "turns", title: "Turns", width: 70, filter: "number" },
  { key: "approvals", title: "Approvals", width: 95, filter: "number" },
  { key: "shortId", title: "ID", width: 80 },
  { key: "pid", title: "PID", width: 75, filter: "number" },
  { key: "branch", title: "Branch", width: 140 },
  { key: "startedAt", title: "Started", width: 130, filter: "date" },
];
function display(row: ChartRow, key: Key): string {
  switch (key) {
    case "turnTime":
      return describeTurns(row.telemetry);
    case "activity":
      return describeBuckets(row.telemetry);
    case "history":
      return describeHistory(row.telemetry);
    case "approvals":
      return row.approvals ? String(row.approvals) : "";
    case "branch":
      return row.branch ?? "none";
    case "startedAt":
      return started.format(new Date(row.startedAt));
    case "turns":
      return String(row.turns);
    case "pid":
      return row.pid === null ? "" : String(row.pid);
    default:
      return row[key];
  }
}

const sessionAlign = (key: Key) =>
  key === "turns" || key === "approvals" || key === "pid" ? ("right" as const) : ("left" as const);

/** Small domain telemetry plots accompany, rather than replace, the recorded values. */
function SessionChart({
  row,
  kind,
  scales,
}: {
  row: ChartRow;
  kind: "turnTime" | "activity" | "history";
  scales: { turns: number; events: number };
}) {
  const pattern = useId();
  const data = row.telemetry;
  const description = display(row, kind);
  if (kind === "history")
    return (
      <svg
        className="carbon-history-chart"
        viewBox="0 0 168 16"
        role="img"
        aria-label={description}
      >
        <defs>
          <pattern id={pattern} width="4" height="4" patternUnits="userSpaceOnUse">
            <path d="M-1 1L1 -1M0 4L4 0M3 5L5 3" stroke="currentColor" />
          </pattern>
        </defs>
        <rect x="0" y="2" width="168" height="12" fill="var(--cds-layer-02)" />
        {data.history?.map((span) => (
          <rect
            key={`${span.start}-${span.status}`}
            x={(span.start / historySeconds) * 168}
            y="3"
            width={(span.seconds / historySeconds) * 168}
            height="10"
            fill={span.status === "running" ? "currentColor" : `url(#${pattern})`}
          />
        ))}
        <title>{description}</title>
      </svg>
    );
  const samples = kind === "turnTime" ? data.turns : data.buckets;
  if (!samples) return <span>Unavailable</span>;
  const scale = kind === "turnTime" ? scales.turns : scales.events;
  const points = samples
    .map(
      (value, index) =>
        `${samples.length > 1 ? (index * 82) / (samples.length - 1) + 1 : 42},${19 - (Math.min(value, scale) / scale) * 18}`,
    )
    .join(" ");
  return (
    <span className="carbon-chart-value">
      <svg viewBox="0 0 84 22" role="img" aria-label={description}>
        <path d="M0 20H84" stroke="var(--cds-border-strong-01)" />
        {kind === "turnTime" ? (
          <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" />
        ) : (
          samples.map((value, index) => (
            <rect
              // biome-ignore lint/suspicious/noArrayIndexKey: Fixed telemetry bucket positions are their identity, with no per-bar state.
              key={index}
              x={(index * 82) / bucketCount + 1}
              y={19 - (Math.min(value, scale) / scale) * 18}
              width={82 / bucketCount - 2}
              height={(Math.min(value, scale) / scale) * 18}
              fill="currentColor"
            />
          ))
        )}
        <title>{description}</title>
      </svg>
      <span>{kind === "turnTime" ? latestTurn(data) : eventTotal(data)}</span>
    </span>
  );
}

export function SessionsTable(
  props: TableOptions & {
    rows: SessionRow[];
    events: Record<string, readonly RunEvent[]>;
    charts: boolean;
    chartTickMs: number;
    visible: boolean;
    onAdd(): void;
    addDisabled: boolean;
    onActions(id: string, bounds: Rectangle, contextual?: boolean): void;
  },
) {
  const { rows, events } = props;
  const viewState = useTableView(props.tableId, props);
  const charts = viewState[0].charts;
  // The event and history charts cover a moving window, so they redraw as time passes.
  const now = useTicker(charts && props.visible, props.chartTickMs);
  const chartRows = useMemo(
    () =>
      rows.map((row): ChartRow => {
        const data = charts
          ? telemetry(events[row.id], now)
          : { turns: null, buckets: null, history: null };
        return {
          ...row,
          telemetry: data,
          turnTime: data.turns?.at(-1) ?? -1,
          activity: data.buckets ? data.buckets.reduce((sum, value) => sum + value, 0) : -1,
          history: describeHistory(data),
        };
      }),
    [rows, events, charts, now],
  );
  // Each chart column shares one scale across runs, so rows can be compared by eye.
  const scales = useMemo(
    () => ({
      turns: Math.max(20, ...chartRows.flatMap((row) => row.telemetry.turns ?? [])),
      events: Math.max(8, ...chartRows.flatMap((row) => row.telemetry.buckets ?? [])),
    }),
    [chartRows],
  );
  const renderCell = useCallback(
    (row: ChartRow, key: Key) => {
      if (key === "statusLabel")
        return (
          <span className="carbon-status" data-emphasis={statusSpec[row.status].emphasis}>
            <Icon name={statusSpec[row.status].icon} />
            {row.statusLabel}
          </span>
        );
      if (key === "turnTime" || key === "activity" || key === "history")
        return <SessionChart row={row} kind={key} scales={scales} />;
      return undefined;
    },
    [scales],
  );
  return (
    <DataTable
      {...props}
      viewState={viewState}
      defaultCharts={props.charts}
      settingsColumns={[...columns, ...chartColumns.map((column) => ({ ...column, chart: true }))]}
      addLabel="New agent session"
      rows={chartRows}
      columns={charts ? [...columns, ...chartColumns] : columns}
      initialSort="startedAt"
      initialDescending
      display={display}
      align={sessionAlign}
      renderCell={renderCell}
    />
  );
}
