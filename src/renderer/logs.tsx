import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { DesktopApi, LogRecord } from "../bridge/index.js";
import { parseLogQuery } from "../bridge/index.js";
import { DataTable, type RetainedTableQuery, type TableOptions } from "./data-table.js";
import { Icon } from "./icons.js";
import { LogViewer } from "./log-model.js";
import { Modal } from "./modal.js";

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
      <p className="muted">
        Private desktop diagnostics, retained for up to 7 days and 20 MiB across all app launches.
        Events contains agent transcripts, not these logs. Transcripts have no new retention limit.
        Fixed metadata avoids content capture; credential redaction is not a guarantee of
        anonymization.
      </p>
      <div className="table-filter-bar">
        <label>
          Project scope{" "}
          <select
            aria-label="Log project scope"
            value={scope}
            onChange={(event) => setScope(event.target.value as typeof scope)}
          >
            <option value="current">Current project plus app events</option>
            <option value="all">All projects</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={launchOnly}
            disabled={!page}
            onChange={(event) => setLaunchOnly(event.target.checked)}
          />
          Current app launch only
        </label>
        <span className="muted">
          Use Columns or saved Filters for severity, component, provider, run, outcome and time.
          Search covers retained history. Sorting applies to this page.
        </span>
      </div>
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
      {state.pending && <p role="status">Loading diagnostic logs…</p>}
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
        actions={
          <>
            <button
              type="button"
              aria-pressed={state.paused}
              onClick={() => viewer.pause(!state.paused)}
            >
              {state.paused ? "Resume viewing" : "Pause viewing"}
            </button>
            <button
              type="button"
              onClick={() => void navigate(() => viewer.refresh())}
              disabled={state.pending}
            >
              {state.newRecords ? "New records available, show latest" : "Refresh logs"}
            </button>
            <button type="button" disabled={clearing} onClick={() => void clear()}>
              Clear logs
            </button>
          </>
        }
      />
      {!state.pending && page?.state === "ready" && !page.records.length && (
        <p role="status">No diagnostic logs match these filters.</p>
      )}
      {state.paused && <p role="status">Viewing paused. Diagnostic capture continues.</p>}
      <fieldset className="button-group" aria-label="Log pages">
        <button
          type="button"
          disabled={state.pending || !state.hasPrevious}
          onClick={() => void navigate(() => viewer.previous())}
        >
          Newer page
        </button>
        <span>Page {state.pageNumber}</span>
        <button
          type="button"
          disabled={state.pending || !page?.cursor}
          onClick={() => void navigate(() => viewer.next())}
        >
          Older page
        </button>
      </fieldset>
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
