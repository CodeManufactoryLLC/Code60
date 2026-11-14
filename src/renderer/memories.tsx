import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  type DesktopApi,
  MEMORY_TYPES,
  type MemoryAction,
  type MemoryBrowse,
  type MemoryDetail,
  type MemoryRecord,
} from "../bridge/index.js";
import { DataTable, type TableOptions } from "./data-table.js";
import { Icon } from "./icons.js";
import { MemoriesModel } from "./memories-model.js";
import { MemoryInspector } from "./memory.js";
import { Modal } from "./modal.js";
import { TablePager } from "./table-controls.js";

const columns = [
  { key: "text", title: "Memory", width: 440, filter: "text" },
  { key: "type", title: "Type", width: 110, filter: "category" },
  { key: "state", title: "Status", width: 110, filter: "category" },
  { key: "scope", title: "Scope", width: 120, filter: "category" },
  { key: "evidence", title: "Evidence", width: 150, filter: "category" },
  { key: "pinned", title: "Pinned", width: 90, filter: "category" },
  { key: "createdAt", title: "Created", width: 185, filter: "date" },
  { key: "updatedAt", title: "Updated", width: 185, filter: "date" },
  { key: "lastUsedAt", title: "Last used", width: 185, filter: "date" },
  { key: "eventAt", title: "Event time", width: 185, filter: "date" },
  { key: "provider", title: "Provider", width: 130, filter: "category" },
  { key: "revision", title: "Revision", width: 90, filter: "number" },
  { key: "projectId", title: "Project ID", width: 220, filter: "text" },
  { key: "conversationId", title: "Conversation ID", width: 220, filter: "text" },
] satisfies {
  key: keyof MemoryRecord;
  title: string;
  width: number;
  filter: "text" | "category" | "date" | "number";
}[];
const date = new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "medium" });
function display(record: MemoryRecord, key: (typeof columns)[number]["key"]): string {
  const value = record[key];
  if (key === "pinned") return value ? "Yes" : "No";
  if (value === null) return key === "lastUsedAt" ? "Never" : "None";
  if (key.endsWith("At")) {
    const at = new Date(String(value));
    return Number.isNaN(at.getTime()) ? "Unknown" : date.format(at);
  }
  return String(value);
}

/** Project labels are often absolute folders; the final segment is enough in a picker. */
function shortLabel(label: string): string {
  return label.split(/[\\/]/).filter(Boolean).pop() ?? label;
}

export function MemoriesPage({
  api,
  active,
  ...table
}: Pick<TableOptions, "lines" | "density" | "fit" | "textStyles"> & {
  api: DesktopApi;
  active: boolean;
}) {
  const [model] = useState(() => new MemoriesModel(api));
  const state = useSyncExternalStore(model.subscribe, model.snapshot);
  const [query, setQuery] = useState<MemoryBrowse>({});
  const [selected, setSelected] = useState<string>();
  const [detail, setDetail] = useState<MemoryDetail>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  const inFlight = useRef(false);
  useEffect(() => {
    model.activate(active);
    return () => {
      model.activate(false);
      request.current++;
    };
  }, [model, active]);
  useEffect(() => api.onMemoryChanged(model.refresh), [api, model]);
  function close() {
    request.current++;
    setDetail(undefined);
  }
  function filter(next: MemoryBrowse) {
    close();
    setSelected(undefined);
    setError("");
    setQuery(next);
    model.configure(next);
  }
  async function inspect(id: string) {
    const token = ++request.current;
    setSelected(id);
    setError("");
    try {
      const value = await api.memoryDetail({ id });
      if (request.current === token) setDetail(value);
    } catch {
      if (request.current === token)
        setError("Memory changed or is unavailable. Refresh and try again.");
    }
  }
  async function action(value: MemoryAction) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    const token = ++request.current;
    try {
      const accepted = await api.memoryAction(value);
      if (request.current !== token) return;
      if (accepted) setDetail(undefined);
      model.refresh();
    } catch (cause) {
      if (request.current === token)
        setError(cause instanceof Error ? cause.message : "Memory action failed.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!active) setDetail(undefined);
  }, [active]);
  const busyPaging = state.pending || busy;
  const turn = (step: () => void) => () => {
    close();
    setSelected(undefined);
    step();
  };
  const scope = (
    <>
      <select
        aria-label="Memory project"
        value={query.projectId ?? ""}
        onChange={(e) => filter({ ...query, projectId: e.target.value || undefined })}
      >
        <option value="">All projects</option>
        {state.metadata?.projects.map((project) => (
          <option key={project.id} value={project.id} title={project.label}>
            {shortLabel(project.label)}
          </option>
        ))}
      </select>
      <select
        aria-label="Memory type"
        value={query.type ?? ""}
        onChange={(e) =>
          filter({ ...query, type: (e.target.value as MemoryBrowse["type"]) || undefined })
        }
      >
        <option value="">All types</option>
        {MEMORY_TYPES.map((type) => (
          <option key={type}>{type}</option>
        ))}
      </select>
      <select
        aria-label="Memory status"
        value={query.state ?? ""}
        onChange={(e) =>
          filter({ ...query, state: (e.target.value as MemoryBrowse["state"]) || undefined })
        }
      >
        <option value="">All statuses</option>
        {["active", "disputed", "stale", "superseded"].map((status) => (
          <option key={status}>{status}</option>
        ))}
      </select>
    </>
  );
  return (
    <main
      className="sessions memory-page"
      aria-label="Memories"
      data-heading-lines={table.lines.heading}
    >
      {state.metadata?.warning && (
        <p className="table-notice" role="status">
          {state.metadata.warning}
        </p>
      )}
      {(error || state.error) && (
        <p className="table-notice" role="alert">
          {error || state.error}
        </p>
      )}
      <DataTable
        {...table}
        tableId="memories"
        workspace="application-memory"
        rows={state.page.records}
        columns={columns}
        display={display}
        initialSort="createdAt"
        initialDescending
        selected={selected}
        onSelect={(id) => void inspect(id)}
        scope={scope}
        actions={
          <button
            type="button"
            className="icon-button"
            aria-label="Refresh memories"
            data-tooltip="Refresh"
            disabled={busyPaging}
            onClick={() => {
              setError("");
              model.refresh();
            }}
          >
            <Icon name="renew" />
          </button>
        }
      />
      {!state.pending && !state.error && !state.page.records.length && (
        <p className="table-empty" role="status">
          No memories in this view.
        </p>
      )}
      <TablePager
        label="Memory pages"
        page={state.pageNumber}
        summary={
          state.pending ? (
            <span role="status">Loading…</span>
          ) : state.error ? undefined : (
            <span role="status">
              {state.page.records.length} {state.page.records.length === 1 ? "memory" : "memories"}
            </span>
          )
        }
        previous={{
          label: "Previous page",
          disabled: busyPaging || state.pageNumber === 1,
          onClick: turn(() => model.previous()),
        }}
        next={{
          label: "Next page",
          disabled: busyPaging || !state.page.next,
          onClick: turn(() => model.next()),
        }}
      />{" "}
      {active && detail && (
        <Modal title="Memory details" className="memory-dialog" busy={busy} onClose={close}>
          {error && (
            <p className="table-notice" role="alert">
              {error}
            </p>
          )}
          <MemoryInspector
            key={`${detail.record.id}:${detail.record.revision}`}
            detail={detail}
            busy={busy}
            names={state.metadata}
            onAction={(value) => void action(value)}
          />
        </Modal>
      )}
    </main>
  );
}
