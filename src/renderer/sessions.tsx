import type { DataEditor, Rectangle } from "@glideapps/glide-data-grid";
import { type ComponentProps, useCallback, useMemo } from "react";
import type { RunEvent } from "../core/index.js";
import { DataTable, type TableOptions, useCssColors } from "./data-table.js";
import { drawIcon } from "./icons.js";
import { monospaceFont, resolveText, type SessionRow, statusSpec } from "./state.js";
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

type Paint = (
  args: Parameters<NonNullable<ComponentProps<typeof DataEditor>["drawCell"]>>[0],
) => void;

/** Status as the guide draws it: a 16px icon and a 12px label, emphasis without color alone. */
function paintStatus(
  paint: Parameters<Paint>[0],
  row: SessionRow,
  color: (name: string) => string,
  font: string,
) {
  const { ctx, rect } = paint;
  const spec = statusSpec[row.status];
  const height = Math.min(20, rect.height - 4);
  const x = rect.x + 6;
  const y = rect.y + (rect.height - height) / 2;
  let text = color("--muted");
  let weight = 400;
  if (spec.emphasis === "active") {
    text = color("--text");
    weight = 500;
  } else if (spec.emphasis === "decision") {
    ctx.fillStyle = color("--text");
    ctx.fillRect(x, y, Math.min(128, rect.width - 12), height);
    text = color("--bg");
    weight = 600;
  } else if (spec.emphasis === "abnormal") {
    text = color("--danger");
    weight = 600;
    ctx.fillStyle = text;
    ctx.fillRect(x, y, 3, height);
  }
  ctx.fillStyle = text;
  drawIcon(ctx, spec.icon, x + 6, rect.y + rect.height / 2 - 8);
  ctx.font = `${weight} 12px ${font}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.letterSpacing = "0px";
  ctx.fillText(row.statusLabel, x + 28, rect.y + rect.height / 2, rect.width - 40);
}

const plotWidth = 84;
function paintChart(
  paint: Parameters<Paint>[0],
  row: ChartRow,
  key: "turnTime" | "activity" | "history",
  scales: { turns: number; events: number },
  color: (name: string) => string,
) {
  const { ctx, rect } = paint;
  const data = row.telemetry;
  const x = rect.x + 8;
  const middle = rect.y + rect.height / 2;
  ctx.font = `12px ${monospaceFont}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.letterSpacing = "0px";
  const unavailable = () => {
    ctx.fillStyle = color("--muted");
    ctx.fillText("Unavailable", x, middle, rect.width - 16);
  };
  if (key === "history") {
    if (!data.history?.length) return unavailable();
    const width = Math.min(168, rect.width - 16);
    const top = middle - 6;
    ctx.fillStyle = color("--surface-band");
    ctx.fillRect(x, top, width, 12);
    ctx.lineWidth = 1;
    for (const span of data.history) {
      const left = x + 1 + (span.start / historySeconds) * (width - 2);
      const spanWidth = (span.seconds / historySeconds) * (width - 2);
      if (span.status === "running") {
        ctx.fillStyle = color("--text");
        ctx.fillRect(left, top + 1, spanWidth, 10);
      } else if (span.status === "waiting") {
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top + 1, spanWidth, 10);
        ctx.clip();
        ctx.fillStyle = color("--surface");
        ctx.fillRect(left, top + 1, spanWidth, 10);
        ctx.strokeStyle = color("--muted");
        for (let stripe = left - 10; stripe < left + spanWidth; stripe += 4) {
          ctx.beginPath();
          ctx.moveTo(stripe, top + 11);
          ctx.lineTo(stripe + 10, top + 1);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
    return;
  }
  const samples = key === "turnTime" ? data.turns : data.buckets;
  if (!samples) return unavailable();
  const scale = key === "turnTime" ? scales.turns : scales.events;
  const top = middle - 8;
  ctx.strokeStyle = color("--control-border");
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, top + 15.5);
  ctx.lineTo(x + plotWidth, top + 15.5);
  ctx.stroke();
  const level = (value: number) => top + 15 - (Math.min(value, scale) / scale) * 14;
  ctx.fillStyle = ctx.strokeStyle = color("--text");
  if (key === "activity") {
    const step = (plotWidth - 2) / bucketCount;
    samples.forEach((value, index) => {
      const y = level(value);
      ctx.fillRect(x + 1 + index * step, y, step - 2, top + 15 - y);
    });
  } else {
    const step = samples.length > 1 ? (plotWidth - 2) / (samples.length - 1) : 0;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.beginPath();
    samples.forEach((value, index) => {
      const px = x + 1 + (samples.length > 1 ? index * step : (plotWidth - 2) / 2);
      if (index) ctx.lineTo(px, level(value));
      else ctx.moveTo(px, level(value));
    });
    if (samples.length === 1)
      ctx.arc(x + plotWidth / 2, level(samples[0] ?? 0), 1.5, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.textAlign = "right";
  ctx.fillText(
    key === "turnTime" ? latestTurn(data) : eventTotal(data),
    rect.x + rect.width - 8,
    middle,
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
  const color = useCssColors();
  const font = useMemo(
    () => resolveText(props.textStyles, "normalText").family,
    [props.textStyles],
  );
  const paint = useCallback(
    (args: Parameters<Paint>[0], row: ChartRow, key: Key) => {
      if (key === "statusLabel") paintStatus(args, row, color, font);
      else if (key === "turnTime" || key === "activity" || key === "history")
        paintChart(args, row, key, scales, color);
      else return false;
      return true;
    },
    [color, font, scales],
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
      paint={paint}
    />
  );
}
