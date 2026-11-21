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
import { pathLabel } from "./path-label.js";
import { TablePager } from "./table-controls.js";

const columns = [
  { key: "text", title: "Memory", width: 440, filter: "text" },
  { key: "subject", title: "Subject", width: 180, filter: "text" },
  { key: "condition", title: "Applies when", width: 220, filter: "text" },
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
  { key: "projectId", title: "Project", width: 220, filter: "text" },
  { key: "conversationId", title: "Conversation", width: 220, filter: "text" },
] satisfies {
  key: keyof MemoryRecord;
  title: string;
  width: number;
  filter: "text" | "category" | "date" | "number";
}[];
const date = new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "medium" });
function display(record: MemoryRecord, key: (typeof columns)[number]["key"]): string {
  const value = record[key];
  if (key === "text") return record.text.replace(/\s+/gu, " ").trim();
  if (key === "pinned") return value ? "Yes" : "No";
  if (value === null) return key === "lastUsedAt" ? "Never" : "None";
  if (key.endsWith("At")) {
    const at = new Date(String(value));
    return Number.isNaN(at.getTime()) ? "Unknown" : date.format(at);
  }
  return String(value);
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
  const [inspecting, setInspecting] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
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
    setInspecting(false);
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
    setInspecting(true);
    setDetailLoading(true);
    setDetail(undefined);
    setDetailError("");
    setError("");
    try {
      const value = await api.memoryDetail({ id });
      if (request.current === token) setDetail(value);
    } catch {
      if (request.current === token)
        setDetailError(
          "Memory details are unavailable. The record may have changed or been forgotten.",
        );
    } finally {
      if (request.current === token) setDetailLoading(false);
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
      if (accepted) close();
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
    if (!active) {
      setInspecting(false);
      setDetail(undefined);
    }
  }, [active]);
  const busyPaging = state.pending || busy;
  const turn = (step: () => void) => () => {
    close();
    setSelected(undefined);
    step();
  };
  const scope = (
    <>
      <label className="memory-library-filter">
        Project
        <select
          aria-label="Memory project"
          value={query.projectId ?? ""}
          onChange={(e) => filter({ ...query, projectId: e.target.value || undefined })}
        >
          <option value="">All projects</option>
          {state.metadata?.projects.map((project) => (
            <option key={project.id} value={project.id} title={project.label}>
              {pathLabel(project.label)}
            </option>
          ))}
        </select>
      </label>
      <label className="memory-library-filter">
        Type
        <select
          aria-label="Memory type"
          value={query.type ?? ""}
          onChange={(e) =>
            filter({ ...query, type: (e.target.value as MemoryBrowse["type"]) || undefined })
          }
        >
          <option value="">All types</option>
          {MEMORY_TYPES.map((type) => (
            <option key={type} value={type}>
              {type.charAt(0).toUpperCase() + type.slice(1)}
            </option>
          ))}
        </select>
      </label>
      <label className="memory-library-filter">
        Status
        <select
          aria-label="Memory status"
          value={query.state ?? ""}
          onChange={(e) =>
            filter({ ...query, state: (e.target.value as MemoryBrowse["state"]) || undefined })
          }
        >
          <option value="">All statuses</option>
          {["active", "disputed", "stale", "superseded"].map((status) => (
            <option key={status} value={status}>
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </option>
          ))}
        </select>
      </label>
      {(query.projectId || query.type || query.state) && (
        <button type="button" className="link-button" onClick={() => filter({})}>
          Clear memory filters
        </button>
      )}
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
        display={(record, key) => {
          if (key === "projectId")
            return record.projectId
              ? pathLabel(
                  state.metadata?.projects.find((p) => p.id === record.projectId)?.label ??
                    "Unknown project",
                )
              : "None";
          if (key === "conversationId")
            return (
              state.metadata?.conversations.find((c) => c.id === record.conversationId)?.label ??
              "Unknown conversation"
            );
          return display(record, key);
        }}
        pageLocal
        emptyMessage="No memories match the filters on this page."
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
      {state.loaded && !state.pending && !state.error && !state.page.records.length && (
        <p className="table-empty" role="status">
          {state.metadata?.count === 0
            ? "No saved memories yet."
            : "No memories match the selected library filters."}
        </p>
      )}
      <TablePager
        label="Memory pages"
        page={state.pageNumber}
        summary={
          state.error ? undefined : state.pending || !state.loaded ? (
            <span role="status">Loading memories…</span>
          ) : (
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
      {active && inspecting && (
        <Modal title="Memory details" className="memory-dialog" busy={busy} onClose={close}>
          {detailLoading && <p role="status">Loading memory details…</p>}
          {detailError && (
            <div role="alert">
              <p>{detailError}</p>
              <button type="button" onClick={() => selected && void inspect(selected)}>
                Retry memory details
              </button>
            </div>
          )}
          {error && (
            <p className="table-notice" role="alert">
              {error}
            </p>
          )}
          {detail && (
            <MemoryInspector
              key={`${detail.record.id}:${detail.record.revision}`}
              detail={detail}
              busy={busy}
              names={state.metadata}
              onAction={(value) => void action(value)}
            />
          )}
        </Modal>
      )}
    </main>
  );
}
