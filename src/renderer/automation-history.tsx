import {
  Button,
  Search,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  TableSelectRow,
  TableToolbar,
  TableToolbarContent,
} from "@carbon/react";
import { Fragment, type ReactNode, useId, useMemo, useState } from "react";
import type { AutomationHistoryEntry } from "../bridge/index.js";
import { automationDate } from "./automation-date.js";

const columns = [
  { key: "automationName", title: "Scheduled job" },
  { key: "actionType", title: "Type" },
  { key: "status", title: "Outcome" },
  { key: "reason", title: "Reason" },
  { key: "scheduledFor", title: "Scheduled" },
  { key: "startedAt", title: "Started" },
  { key: "endedAt", title: "Ended" },
  { key: "denials", title: "Denied requests" },
] as const;
type HistoryKey = (typeof columns)[number]["key"];

function display(row: AutomationHistoryEntry, key: HistoryKey): string {
  if (key === "actionType") {
    if (row.actionType === "workflow") {
      return row.tasksTotal !== undefined
        ? `Workflow (${row.tasksCompleted ?? 0}/${row.tasksTotal})`
        : "Workflow";
    }
    return "Prompt";
  }
  if (
    key === "status" &&
    row.actionType === "workflow" &&
    row.workflowStatus &&
    row.status === "running"
  ) {
    return row.workflowStatus.replaceAll("_", " ");
  }
  if (key === "scheduledFor" || key === "startedAt" || key === "endedAt")
    return row[key] ? automationDate(row[key]) : key === "scheduledFor" ? "Manual" : "—";
  return String(row[key] ?? "—").replaceAll("_", " ");
}

/** Search is deliberately limited to the backend's current bounded history page. */
export function historyRows(
  rows: AutomationHistoryEntry[],
  query: string,
  sort: HistoryKey,
  descending: boolean,
): AutomationHistoryEntry[] {
  const needle = query.trim().toLocaleLowerCase();
  return rows
    .filter(
      (row) =>
        !needle ||
        columns.some(({ key }) =>
          `${display(row, key)} ${row[key] ?? ""}`.toLocaleLowerCase().includes(needle),
        ),
    )
    .sort((a, b) => {
      const left = a[sort];
      const right = b[sort];
      const order =
        typeof left === "number" && typeof right === "number"
          ? left - right
          : String(left ?? "").localeCompare(String(right ?? ""));
      return (descending ? -order : order) || a.sequence - b.sequence;
    });
}

export function AutomationHistory({
  rows,
  selected,
  onSelect,
  evidence,
  filtered = false,
  showEmpty = true,
}: {
  rows: AutomationHistoryEntry[];
  selected: string | undefined;
  evidence?: ReactNode;
  filtered?: boolean;
  showEmpty?: boolean;
  onSelect(id: string | undefined): void;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<HistoryKey>("startedAt");
  const [descending, setDescending] = useState(true);
  const visible = useMemo(
    () => historyRows(rows, query, sort, descending),
    [rows, query, sort, descending],
  );
  return (
    <TableContainer className="carbon-job-history">
      <TableToolbar aria-label="History controls">
        <TableToolbarContent>
          <Search
            id={`${id}-search`}
            size="lg"
            labelText="Search current history page"
            placeholder="Search current history page"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              onSelect(undefined);
            }}
          />
        </TableToolbarContent>
      </TableToolbar>
      <section
        className="carbon-job-table-scroll"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to scroll the bounded history region in both axes.
        tabIndex={0}
        aria-label="Execution history table"
      >
        <Table size="md" aria-label="Execution history">
          <TableHead>
            <TableRow>
              <TableHeader scope="col">
                <span className="cds--visually-hidden">Select execution</span>
              </TableHeader>
              {columns.map(({ key, title }) => (
                <TableHeader
                  key={key}
                  scope="col"
                  isSortable
                  isSortHeader={sort === key}
                  sortDirection={sort === key ? (descending ? "DESC" : "ASC") : "NONE"}
                  onClick={() => {
                    setDescending(sort === key ? !descending : false);
                    setSort(key);
                  }}
                >
                  {title}
                </TableHeader>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {visible.map((row) => (
              <Fragment key={row.id}>
                <TableRow isSelected={selected === row.id}>
                  <TableSelectRow
                    id={`${id}-${row.id}`}
                    name={`${id}-execution`}
                    radio
                    aria-label={`Select execution ${row.automationName} ${row.sequence}`}
                    checked={selected === row.id}
                    onSelect={() => onSelect(row.id)}
                  />
                  {columns.map(({ key }) => (
                    <TableCell key={key}>{display(row, key)}</TableCell>
                  ))}
                </TableRow>
                {row.id === selected && evidence && (
                  <TableRow>
                    <TableCell colSpan={columns.length + 1}>{evidence}</TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
            {showEmpty && visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={columns.length + 1}>
                  {query.trim()
                    ? "No executions match this search."
                    : filtered
                      ? "No executions for this schedule yet."
                      : "No executions yet."}
                  {query.trim() && (
                    <Button
                      kind="ghost"
                      size="sm"
                      onClick={() => {
                        setQuery("");
                        onSelect(undefined);
                      }}
                    >
                      Clear search
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>
    </TableContainer>
  );
}
