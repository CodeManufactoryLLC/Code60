import { useMemo } from "react";
import type { RunEvent } from "../core/index.js";
import { DataTable, type TableOptions } from "./data-table.js";
import { TranscriptNotice, type Transcripts } from "./transcripts.js";

export interface MessageRow {
  id: string;
  at: string;
  agent: string;
  session: string;
  kind: "Prompt" | "Message" | "Thought";
  text: string;
}

const columns = [
  { key: "at", title: "Time", width: 160, filter: "date" },
  { key: "agent", title: "Agent", width: 150 },
  { key: "session", title: "Session", width: 100 },
  { key: "kind", title: "Type", width: 110, filter: "category" },
  { key: "text", title: "Message", width: 540 },
] satisfies {
  key: keyof MessageRow & string;
  title: string;
  width: number;
  filter?: "date" | "category";
}[];

const date = new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" });

export function messageRows(
  runs: readonly { record: { id: string; agent: string } }[],
  events: Readonly<Record<string, readonly RunEvent[]>>,
): MessageRow[] {
  const rows: MessageRow[] = [];
  for (const run of runs) {
    const runId = run.record.id;
    let open: MessageRow | undefined;
    for (const [index, event] of (events[runId] ?? []).entries()) {
      if (event.type === "message" || event.type === "thought") {
        const kind = event.type === "message" ? "Message" : "Thought";
        if (open?.kind === kind) {
          open.text += event.text;
        } else {
          open = {
            id: `${runId}:${index}`,
            at: event.at,
            agent: run.record.agent,
            session: runId.slice(-6),
            kind,
            text: event.text,
          };
          rows.push(open);
        }
        continue;
      }
      open = undefined;
      if (event.type === "prompt") {
        rows.push({
          id: `${runId}:${index}`,
          at: event.at,
          agent: run.record.agent,
          session: runId.slice(-6),
          kind: "Prompt",
          text: event.text,
        });
      }
    }
  }
  return rows;
}

const display = (row: MessageRow, key: keyof MessageRow & string): string => {
  if (key !== "at") return row[key];
  const value = new Date(row.at);
  return Number.isNaN(value.getTime()) ? "Unknown" : date.format(value);
};

export function MessagesPage({
  runs,
  data,
  directory,
  workspace,
  lines,
  density,
  fit,
  textStyles,
}: Pick<TableOptions, "lines" | "density" | "fit" | "textStyles"> & {
  runs: readonly { record: { id: string; agent: string } }[];
  data: Transcripts;
  directory: string | null;
  workspace: string;
}) {
  const rows = useMemo(() => messageRows(runs, data.events), [runs, data.events]);
  return (
    <main className="sessions" aria-label="Messages" data-heading-lines={lines.heading}>
      <TranscriptNotice data={data} />
      {directory && (
        <DataTable
          tableId="messages"
          workspace={workspace}
          rows={rows}
          columns={columns}
          display={display}
          initialSort="at"
          initialDescending
          selected={undefined}
          onSelect={() => {}}
          lines={lines}
          density={density}
          fit={fit}
          textStyles={textStyles}
        />
      )}
      {!rows.length && !data.pending && (
        <p className="configuration-empty muted">
          {directory
            ? "No chat messages available in this project."
            : "Open a project to view its chat messages."}
        </p>
      )}
    </main>
  );
}
