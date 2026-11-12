import {
  CompactSelection,
  DataEditor,
  type GridCell,
  GridCellKind,
  type Item,
} from "@glideapps/glide-data-grid";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTableAppearance } from "./table-appearance.js";
import { fitWidths, rowHeight } from "./table-preferences.js";
import type { SettingsColumn } from "./table-settings.js";
import { orderedColumns, type TableId, type TableView } from "./table-view.js";
import { applyCase, type TextStyles } from "./typography.js";

// Deliberately fictional, deterministic values. The preview never reads project records.
const sampleValues: Record<string, readonly string[]> = {
  actions: ["Actions", "Actions", "Actions", "Actions"],
  agent: ["Claude", "Codex", "Claude", "Codex"],
  provider: ["Claude", "Codex", "Claude", "Codex"],
  statusLabel: ["Ready", "Working", "Finished", "Ready"],
  status: ["Ready", "Working", "Finished", "Ready"],
  session: ["a1b2c3", "d4e5f6", "g7h8i9", "j0k1l2"],
  shortId: ["a1b2c3", "d4e5f6", "g7h8i9", "j0k1l2"],
  branch: ["feature/search", "fix/layout", "docs/setup", "test/forms"],
  path: ["/example/search", "/example/layout", "/example/setup", "/example/forms"],
  repository: ["example-app", "example-app", "example-app", "example-app"],
  text: [
    "Review the search results",
    "Updated the layout",
    "Documented setup",
    "All checks passed",
  ],
  details: ["Session started", "Reading source files", "Updated layout styles", "Turn complete"],
  kind: ["Message", "Tool call", "Message", "Message"],
  type: ["status", "toolCall", "message", "turnEnd"],
  name: ["Code review", "UI changes", "Documentation", "Tests"],
  turns: ["3", "1", "4", "2"],
  approvals: ["0", "1", "0", "0"],
  pid: ["4201", "4202", "4203", "4204"],
  turnTime: ["12s", "8s", "16s", "10s"],
  activity: ["18 events", "12 events", "24 events", "9 events"],
  history: ["Working, then ready", "Working", "Finished", "Ready"],
};
const sampleDates = [
  "11/06/2026, 9:00 AM",
  "11/06/2026, 9:05 AM",
  "11/06/2026, 9:10 AM",
  "11/06/2026, 9:15 AM",
];
const emptySelection = { rows: CompactSelection.empty(), columns: CompactSelection.empty() };

function sampleValue(tableId: TableId, column: SettingsColumn, row: number) {
  if (tableId === "polling" && column.key === "name")
    return ["Run history", "Agent config", "Configurations", "Worktrees"][row] ?? "";
  if (column.filter === "date" || /At$/.test(column.key)) return sampleDates[row] ?? "";
  return (
    sampleValues[column.key]?.[row] ??
    (column.filter === "number" ? (["4", "12", "8", "2"][row] ?? "") : `${column.title} ${row + 1}`)
  );
}

export function TablePreview({
  tableId,
  columns,
  view,
  actions,
  textStyles,
}: {
  tableId: TableId;
  columns: SettingsColumn[];
  view: TableView;
  actions: boolean;
  textStyles: TextStyles;
}) {
  const { color, heading, normal, cellTheme, theme, tracking, getRowThemeOverride } =
    useTableAppearance(textStyles, view.lines);
  const container = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(0);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () => setAvailable(element.clientWidth - 40);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);
  const visible = useMemo(() => {
    const result = orderedColumns(columns, view);
    if (actions) result.splice(1, 0, { key: "actions", title: "Actions", width: 90 });
    return result;
  }, [columns, view, actions]);
  const gridColumns = useMemo(() => {
    const widths = visible.map((column) => view.widths[column.key] ?? column.width);
    const fitted = view.fit && available > 0 ? fitWidths(widths, available) : widths;
    return visible.map((column, i) => ({
      id: column.key,
      title: applyCase(column.title, heading.case),
      width: fitted[i] ?? column.width,
    }));
  }, [visible, view.fit, view.widths, available, heading.case]);
  const getCellContent = useCallback(
    ([col, row]: Item): GridCell => {
      const column = visible[col];
      const value = column ? sampleValue(tableId, column, row) : "";
      return {
        kind: GridCellKind.Text,
        data: value,
        displayData: applyCase(value, normal.case),
        readonly: true,
        allowOverlay: false,
        themeOverride: cellTheme,
      };
    },
    [visible, tableId, normal.case, cellTheme],
  );
  return (
    <div
      ref={container}
      className="table-preview-grid"
      data-row-height={rowHeight(view.density)}
      data-fit={view.fit}
      data-heading-lines={view.lines.heading}
    >
      <DataEditor
        columns={gridColumns}
        rows={4}
        width="100%"
        height={Math.max(32, heading.size + 12) + 4 * rowHeight(view.density) + 18}
        getCellContent={getCellContent}
        theme={theme}
        rowHeight={rowHeight(view.density)}
        headerHeight={Math.max(32, heading.size + 12)}
        rowMarkers={{
          kind: "number",
          width: 40,
          theme: { ...cellTheme, textLight: color("--muted") },
        }}
        getRowThemeOverride={getRowThemeOverride}
        verticalBorder={view.lines.vertical}
        rowSelect="none"
        columnSelect="none"
        rangeSelect="none"
        gridSelection={emptySelection}
        minColumnWidth={view.fit ? 20 : 50}
        maxColumnWidth={view.fit ? 4000 : 500}
        onPaste={false}
        onDelete={() => false}
        keybindings={{ search: false }}
        drawHeader={(args, content) => tracking.header(args, content)}
        drawCell={(args, content) => {
          const column = visible[args.col];
          if (!column?.chart) return tracking.cell(args, content);
          const { ctx, rect } = args;
          ctx.save();
          ctx.beginPath();
          ctx.rect(rect.x, rect.y, rect.width, rect.height);
          ctx.clip();
          ctx.strokeStyle = color("--accent");
          ctx.fillStyle = color("--accent");
          ctx.lineWidth = 1.5;
          const values = [3, 6, 4, 8, 5, 7];
          const width = Math.max(0, rect.width - 16);
          const height = Math.min(20, rect.height - 8);
          const x = rect.x + 8;
          const y = rect.y + (rect.height + height) / 2;
          if (column.key === "turnTime") {
            ctx.beginPath();
            values.forEach((value, index) => {
              const px = x + (index * width) / 5;
              const py = y - ((value + args.row) / 11) * height;
              if (index === 0) ctx.moveTo(px, py);
              else ctx.lineTo(px, py);
            });
            ctx.stroke();
          } else {
            values.forEach((value, index) => {
              const bar = column.key === "history" ? height / 2 : (value / 8) * height;
              ctx.fillRect(x + (index * width) / 6, y - bar, Math.max(0, width / 6 - 2), bar);
            });
          }
          ctx.restore();
        }}
      />
    </div>
  );
}
