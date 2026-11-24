import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@carbon/react";
import type { CSSProperties } from "react";
import type { SettingsColumn } from "./table-settings.js";
import { orderedColumns, type TableId, type TableView } from "./table-view.js";
import type { TextStyles } from "./typography.js";

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
  textStyles: _textStyles,
}: {
  tableId: TableId;
  columns: SettingsColumn[];
  view: TableView;
  actions: boolean;
  textStyles: TextStyles;
}) {
  const visible = orderedColumns(columns, view);
  if (actions) visible.push({ key: "actions", title: "Actions", width: 96 });
  return (
    <div
      className="table-preview-grid carbon-table-scroll"
      data-fit-columns={view.fit}
      data-horizontal={view.lines.horizontal}
      data-vertical={view.lines.vertical}
      data-heading-lines={view.lines.heading}
      style={
        {
          "--table-width": `${visible.reduce((sum, column) => sum + (view.widths[column.key] ?? column.width), 0)}px`,
        } as CSSProperties
      }
    >
      <Table
        aria-label="Table appearance preview"
        size={view.density === "high" ? "sm" : view.density === "medium" ? "md" : "lg"}
      >
        <colgroup>
          {visible.map((column) => (
            <col
              key={column.key}
              style={{ width: view.fit ? undefined : (view.widths[column.key] ?? column.width) }}
            />
          ))}
        </colgroup>
        <TableHead>
          <TableRow>
            {visible.map((column) => (
              <TableHeader key={column.key}>{column.title}</TableHeader>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {[0, 1, 2, 3].map((row) => (
            <TableRow key={row}>
              {visible.map((column) => (
                <TableCell key={column.key}>{sampleValue(tableId, column, row)}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
