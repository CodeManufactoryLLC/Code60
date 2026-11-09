import { useMemo, useState } from "react";
import type { RunEvent } from "../core/index.js";
import { DataTable, type TableOptions } from "./data-table.js";
import { TranscriptNotice, type Transcripts } from "./transcripts.js";

export interface EventRow {
  id: string;
  at: string;
  agent: string;
  session: string;
  type: RunEvent["type"];
  status: string;
  update: string;
  kind: string;
  server: string;
  toolCallId: string;
  details: string;
}

const columns = [
  { key: "at", title: "Time", width: 180, filter: "date" },
  { key: "agent", title: "Agent", width: 130, filter: "category" },
  { key: "session", title: "Session", width: 110, filter: "text" },
  { key: "type", title: "Type", width: 120, filter: "category" },
  { key: "status", title: "Status / outcome", width: 150, filter: "category" },
  { key: "update", title: "ACP update", width: 170, filter: "category" },
  { key: "kind", title: "Tool kind", width: 110, filter: "category" },
  { key: "server", title: "Server", width: 150, filter: "category" },
  { key: "toolCallId", title: "Tool call ID", width: 160, filter: "text" },
  { key: "details", title: "Details", width: 540, filter: "text" },
] satisfies {
  key: keyof EventRow;
  title: string;
  width: number;
  filter: "date" | "category" | "text";
}[];

const eventOutcome = (event: RunEvent): string =>
  event.type === "status"
    ? event.status
    : event.type === "toolCall"
      ? event.status
      : event.type === "permission"
        ? event.decision
        : event.type === "turnEnd"
          ? event.stopReason
          : "";

/** The update's own JSON text, so it reads as received rather than as an escaped string. */
const rawDetails = (event: Extract<RunEvent, { type: "acp" }>): string =>
  event.truncated ? `${event.payload}… [truncated; ${event.size} bytes in full]` : event.payload;

/** Preserve every log entry, including streamed chunks and intermediate tool states. */
export function eventRows(
  runs: readonly { record: { id: string; agent: string } }[],
  events: Readonly<Record<string, readonly RunEvent[]>>,
): EventRow[] {
  return runs.flatMap(({ record }) =>
    (events[record.id] ?? []).map((event, index) => {
      const { runId: _, at, type, ...details } = event;
      return {
        id: `${record.id}:${index}`,
        at,
        agent: record.agent,
        session: record.id,
        type,
        status: eventOutcome(event),
        update: event.type === "acp" ? event.update : "",
        kind: "kind" in event ? event.kind : "",
        server: event.type === "toolCall" && event.mcp ? (event.mcp.server ?? "Unknown") : "",
        toolCallId: "toolCallId" in event ? event.toolCallId : "",
        details: event.type === "acp" ? rawDetails(event) : JSON.stringify(details),
      };
    }),
  );
}

const date = new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "medium" });
const display = (row: EventRow, key: keyof EventRow): string => {
  if (key !== "at") return row[key];
  const value = new Date(row.at);
  return Number.isNaN(value.getTime()) ? "Unknown" : date.format(value);
};

export function EventsPage({
  runs,
  data,
  directory,
  workspace,
  lines,
  density,
  fit,
  textStyles,
  onOpen,
}: Pick<TableOptions, "lines" | "density" | "fit" | "textStyles"> & {
  runs: readonly { record: { id: string; agent: string } }[];
  data: Transcripts;
  directory: string | null;
  workspace: string;
  onOpen(runId: string, eventIndex: number): void;
}) {
  const rows = useMemo(() => eventRows(runs, data.events), [runs, data.events]);
  const [selected, setSelected] = useState<string>();
  return (
    <main className="sessions" aria-label="Events" data-heading-lines={lines.heading}>
      <TranscriptNotice data={data} />
      {directory && (
        <DataTable
          tableId="events"
          workspace={workspace}
          rows={rows}
          columns={columns}
          display={display}
          initialSort="at"
          initialDescending
          selected={selected}
          onSelect={(id) => {
            setSelected(id);
            const index = id.lastIndexOf(":");
            onOpen(id.slice(0, index), Number(id.slice(index + 1)));
          }}
          lines={lines}
          density={density}
          fit={fit}
          textStyles={textStyles}
        />
      )}
      {!rows.length && !data.pending && (
        <p className="configuration-empty muted">
          {directory
            ? "No events available in this project."
            : "Open a project to view its events."}
        </p>
      )}
    </main>
  );
}
