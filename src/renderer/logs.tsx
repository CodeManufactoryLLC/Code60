import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { DesktopApi, LogRecord } from "../bridge/index.js";
import { parseLogQuery } from "../bridge/index.js";
import { DataTable, type RetainedTableQuery, type TableOptions } from "./data-table.js";
import { Icon } from "./icons.js";
import { LogViewer } from "./log-model.js";
import { Modal } from "./modal.js";
import { TablePager } from "./table-controls.js";

const columns = [
  { key: "timestamp", title: "Time", width: 190, filter: "date" },
  { key: "severity", title: "Severity", width: 100, filter: "category" },
  { key: "component", title: "Component", width: 120, filter: "category" },
  { key: "event", title: "Event", width: 170, filter: "category" },
  { key: "runId", title: "Run", width: 180, filter: "text" },
  { key: "provider", title: "Provider", width: 110, filter: "category" },
  { key: "outcome", title: "Outcome", width: 110, filter: "category" },
  { key: "durationMs", title: "Duration (ms)", width: 120, filter: "number" },
  { key: "message", title: "Summary", width: 300, filter: "text" },
  { key: "appLaunchId", title: "App launch", width: 220, filter: "text" },
  { key: "projectId", title: "Project ID", width: 160, filter: "text" },
] satisfies {
  key: keyof LogRecord;
  title: string;
  width: number;
  filter: "text" | "date" | "number" | "category";
}[];
const date = new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "medium" });
const display = (record: LogRecord, field: keyof LogRecord): string =>
  field === "timestamp" ? date.format(new Date(record.timestamp)) : String(record[field] ?? "");

export function LogsPage({
  api,
  active,
  project,
  ...table
}: Pick<TableOptions, "lines" | "density" | "fit" | "textStyles"> & {
  api: DesktopApi;
  active: boolean;
  project: string | null;
}) {
  const [viewer] = useState(() => new LogViewer(api));
  const root = useRef<HTMLElement>(null);
  const state = useSyncExternalStore(viewer.subscribe, viewer.snapshot);
  const [scope, setScope] = useState<"current" | "all">("current");
  const [launchOnly, setLaunchOnly] = useState(false);
  const [appLaunchId, setAppLaunchId] = useState<string>();
  const [detailError, setDetailError] = useState("");
  const [filterError, setFilterError] = useState("");
  const [copied, setCopied] = useState("");
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState("");
  useEffect(() => {
    if (state.page?.appLaunchId) setAppLaunchId(state.page.appLaunchId);
  }, [state.page?.appLaunchId]);
  useEffect(() => api.onLogsChanged(() => viewer.notice()), [api, viewer]);
  useEffect(() => {
    viewer.activate(false);
    viewer.setContext(scope === "current" ? (project ?? "app-only") : "all");
    viewer.configure({ scope, appLaunchId: launchOnly ? appLaunchId : undefined });
    // Project identity is main-owned; force a requery without sending a path.
    viewer.notice();
    viewer.activate(active);
    return () => viewer.activate(false);
  }, [viewer, active, scope, launchOnly, appLaunchId, project]);
  const queryChanged = useCallback(
    (query: RetainedTableQuery) => {
      try {
        viewer.configure(
          parseLogQuery({ ...query, scope, appLaunchId: launchOnly ? appLaunchId : undefined }),
        );
        setFilterError("");
      } catch {
        setFilterError(
          "This filter exceeds diagnostic query limits. Use at most 24 conditions and 200 characters per value.",
        );
      }
    },
    [viewer, scope, launchOnly, appLaunchId],
  );
  const clear = async () => {
    setClearing(true);
    setClearError("");
    try {
      if (await api.clearLogs({ confirm: true })) {
        viewer.select(undefined);
        await viewer.refresh();
      }
    } catch {
      setClearError("Could not clear logs. Retry Clear logs.");
    } finally {
      setClearing(false);
    }
  };
  const select = async (id: string) => {
    setCopied("");
    setDetailError("");
    const record = state.page?.records.find((record) => record.id === id);
    viewer.select(record);
    try {
      const current = await api.logDetail({ id });
      if (viewer.snapshot().selected?.id !== id) return;
      if (!current)
        setDetailError(
          "This record expired or was cleared. The displayed snapshot is retained only until you close these details.",
        );
      else viewer.select(current);
    } catch {
      if (viewer.snapshot().selected?.id === id)
        setDetailError("Could not recheck this record. Showing the previously read snapshot.");
    }
  };
  async function navigate(operation: () => Promise<void>) {
    await operation();
    if (viewer.snapshot().error) return;
    requestAnimationFrame(() => {
      root.current?.querySelector(".dvn-scroller")?.scrollTo({ top: 0 });
      viewer.setFollowing(true);
    });
  }
  const page = state.page;
  return (
    <main
      ref={root}
      className="sessions logs-page"
      aria-label="Logs"
      onScrollCapture={(event) => {
        const target = event.target;
        if (target instanceof HTMLElement && target.classList.contains("dvn-scroller"))
          viewer.setFollowing(target.scrollTop === 0);
      }}
    >
      {page &&
      (page.status.unavailable ||
        page.status.dropped ||
        page.status.persistenceFailures ||
        page.status.malformed) ? (
        <p role="status">
          Partial history: {page.status.dropped} records dropped, {page.status.persistenceFailures}{" "}
          persistence failures, {page.status.malformed} malformed or truncated records skipped.
          {page.status.unavailable ? " Storage is unavailable." : ""}
        </p>
      ) : null}
      {state.error && (
        <p role="alert">
          {state.error}{" "}
          <button type="button" onClick={() => void viewer.retry()}>
            Retry logs
          </button>
        </p>
      )}
      {clearError && <p role="alert">{clearError}</p>}
      {filterError && <p role="alert">{filterError}</p>}
      {page?.state === "expired-cursor" && (
        <p role="status">
          This page expired after retention, clearing or an app restart.{" "}
          <button type="button" onClick={() => void navigate(() => viewer.refresh())}>
            Show latest logs
          </button>
        </p>
      )}
      <DataTable
        {...table}
        tableId="logs"
        workspace="app-diagnostics"
        rows={page?.records ?? []}
        columns={columns}
        display={display}
        initialSort="timestamp"
        initialDescending
        selected={state.selected?.id}
        onSelect={(id) => void select(id)}
        onRetainedQuery={queryChanged}
        scope={
          <>
            <select
              aria-label="Log project scope"
              value={scope}
              onChange={(event) => setScope(event.target.value as typeof scope)}
            >
              <option value="current">Current project</option>
              <option value="all">All projects</option>
            </select>
            <label className="table-scope-check">
              <input
                type="checkbox"
                checked={launchOnly}
                disabled={!page}
                onChange={(event) => setLaunchOnly(event.target.checked)}
              />
              Current launch only
            </label>
          </>
        }
        actions={
          <>
            <button
              type="button"
              className="icon-button"
              aria-pressed={state.paused}
              aria-label={state.paused ? "Resume viewing" : "Pause viewing"}
              data-active={state.paused ? "true" : undefined}
              onClick={() => viewer.pause(!state.paused)}
            >
              <Icon name={state.paused ? "play--filled" : "pause"} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={state.newRecords ? "New records available, show latest" : "Refresh logs"}
              data-attention={state.newRecords ? "true" : undefined}
              onClick={() => void navigate(() => viewer.refresh())}
              disabled={state.pending}
            >
              <Icon name="renew" />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Clear logs"
              disabled={clearing}
              onClick={() => void clear()}
            >
              <Icon name="trash-can" />
            </button>
          </>
        }
      />
      {!state.pending && page?.state === "ready" && !page.records.length && (
        <p className="table-empty" role="status">
          No diagnostic logs match these filters.
        </p>
      )}
      <TablePager
        label="Log pages"
        page={state.pageNumber}
        summary={
          state.paused ? (
            <span role="status">Viewing paused. Diagnostic capture continues.</span>
          ) : state.pending ? (
            <span role="status">Loading…</span>
          ) : undefined
        }
        previous={{
          label: "Newer page",
          disabled: state.pending || !state.hasPrevious,
          onClick: () => void navigate(() => viewer.previous()),
        }}
        next={{
          label: "Older page",
          disabled: state.pending || !page?.cursor,
          onClick: () => void navigate(() => viewer.next()),
        }}
      />
      {state.selected && (
        <Modal
          title="Log record"
          busy={false}
          wide
          onClose={() => {
            viewer.select(undefined);
            setDetailError("");
          }}
        >
          {detailError && <p role="status">{detailError}</p>}
          <dl>
            {Object.entries(state.selected).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>
                  <code>{String(value)}</code>
                </dd>
              </div>
            ))}
          </dl>
          <button
            type="button"
            onClick={async () => {
              const source = JSON.stringify(state.selected, null, 2);
              try {
                await navigator.clipboard.writeText(source);
                setCopied("Record copied.");
              } catch {
                setCopied("Copy failed. Retry Copy record.");
              }
            }}
          >
            <Icon name="copy" />
            Copy record
          </button>
          {copied && <p role="status">{copied}</p>}
        </Modal>
      )}
    </main>
  );
}
