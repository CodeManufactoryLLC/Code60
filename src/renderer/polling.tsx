import { useEffect, useId, useMemo, useState } from "react";
import {
  type ApplicationClient,
  type Polling,
  type PollKey,
  type PollResult,
  type PollState,
  pollKeys,
  pollRanges,
} from "../bridge/index.js";
import { Button as AppButton } from "./carbon/button.js";
import { TextInput as CarbonTextInput } from "./carbon/fields.js";
import { DataTable, type TableOptions } from "./data-table.js";
import { Icon } from "./icons.js";
import { MessageAge } from "./message-controls.js";
import { Modal } from "./modal.js";
import { ControlDescription } from "./overlays.js";
import { pollRequestIdentity } from "./poll-identity.js";
import { SettingsHeader } from "./settings-layout.js";
import type { Rectangle } from "./table-types.js";
import { useTicker } from "./ticker.js";

export const labels: Record<PollKey, string> = {
  history: "Run history",
  config: "Agent config",
  configurations: "Run configurations",
  worktrees: "Worktrees",
  files: "Files",
};
const time = (at: number | null) => (at === null ? "Never" : new Date(at).toLocaleTimeString());
const intervalText = (ms: number | null) => (ms === null ? "Off" : `${ms / 1000}s`);
const triggerLabels: Record<PollResult["trigger"], string> = {
  manual: "Manual",
  timer: "Timer",
  change: "Change",
};

type PollApi = Pick<ApplicationClient, "poll" | "setPollSettings" | "setPollingPaused">;
export interface PollingProps {
  polling: Polling;
  api: PollApi;
  chartTickMs: number;
  onChartTick(ms: number): void;
}

export function PollingWidget({
  polling,
  api,
  messageAt,
  messageScope,
  disabled = false,
}: Pick<PollingProps, "polling" | "api"> & {
  messageAt: number | null | undefined;
  messageScope: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const available = polling.sources.filter((source) => source.status !== "unavailable");
  const attempt = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="footer-polling" aria-label="Polling controls">
      <AppButton
        type="button"
        className="poll-timestamp"
        aria-label="Open polling controls"
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Icon name="view" />
        <MessageAge at={messageAt} scope={messageScope} />
      </AppButton>
      {open && (
        <Modal
          title="Polling controls"
          size="sm"
          initialFocus=".polling-dialog-body button"
          className="polling-dialog"
          busy={busy}
          onClose={() => setOpen(false)}
        >
          <div className="polling-dialog-body">
            <div className="button-group">
              <AppButton
                type="button"
                aria-label={polling.paused ? "Start polling" : "Pause polling"}
                disabled={busy}
                onClick={() => void attempt(() => api.setPollingPaused(!polling.paused))}
              >
                <Icon name={polling.paused ? "play--filled" : "pause"} />
                {polling.paused ? "Start" : "Pause"}
              </AppButton>
              <AppButton
                type="button"
                aria-label="Refresh project data"
                disabled={
                  busy ||
                  !available.length ||
                  available.some((source) => source.status === "polling")
                }
                onClick={() =>
                  void attempt(() =>
                    api.poll(
                      available.map((source) => source.key),
                      pollRequestIdentity(polling),
                    ),
                  )
                }
              >
                <Icon name="renew" />
                Refresh
              </AppButton>
            </div>
          </div>
          {error && (
            <p className="error-banner" role="alert">
              {error}
            </p>
          )}
        </Modal>
      )}
    </section>
  );
}

function IntervalForm({
  source,
  busy,
  onSave,
}: {
  source: PollState;
  busy: boolean;
  onSave(intervalMs: number | null, idleIntervalMs: number | null): void;
}) {
  const [active, setActive] = useState(
    source.setting.intervalMs === null ? "" : String(source.setting.intervalMs / 1000),
  );
  const [idle, setIdle] = useState(
    source.setting.idleIntervalMs === null ? "" : String(source.setting.idleIntervalMs / 1000),
  );
  const [min, max] = pollRanges[source.key];
  return (
    <form
      className="settings-controls"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(
          active === "" ? null : Number(active) * 1000,
          idle === "" ? null : Number(idle) * 1000,
        );
      }}
    >
      {(["active", "idle"] as const).map((mode) => (
        <div key={mode} className="settings-field settings-field-number">
          <CarbonTextInput
            labelText={
              <>
                {mode === "active"
                  ? source.key === "worktrees" || source.key === "files"
                    ? "Visible tab seconds"
                    : "Active seconds"
                  : "Idle seconds"}
              </>
            }
            type="number"
            min={min / 1000}
            max={max / 1000}
            step="1"
            required={source.key === "history"}
            disabled={
              busy || ((source.key === "worktrees" || source.key === "files") && mode === "idle")
            }
            placeholder="Off"
            value={mode === "active" ? active : idle}
            onChange={(event) => (mode === "active" ? setActive : setIdle)(event.target.value)}
          />
        </div>
      ))}
      <AppButton type="submit" disabled={busy}>
        Apply
      </AppButton>
    </form>
  );
}

export function PollingControls({
  polling,
  api,
  chartTickMs,
  onChartTick,
  onOpenMonitor,
}: PollingProps & { onOpenMonitor?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const tickerId = useId();
  const attempt = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="settings-section polling-settings" aria-label="Polling settings">
      <SettingsHeader
        page="polling-settings"
        tip="Desktop only. Empty intervals turn automatic polling off. Worktrees scan only while their tab is visible. Manual polls still work while paused."
        actions={[
          {
            id: "polling-0",
            label: "Reset polling defaults",
            run: () =>
              void attempt(() =>
                api.setPollSettings(Object.fromEntries(pollKeys.map((key) => [key, null]))),
              ),
            disabled: busy,
          },
          ...(onOpenMonitor
            ? [{ id: "polling-1", label: "Open polling monitor", run: onOpenMonitor }]
            : []),
        ]}
      ></SettingsHeader>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {polling.sources.map((source) => (
        <fieldset key={source.key} className="settings-group">
          <legend className="settings-group-title">{labels[source.key]}</legend>
          <AppButton
            type="button"
            className="settings-group-reset"
            aria-label={`Reset ${labels[source.key].toLowerCase()}`}
            disabled={busy}
            onClick={() => void attempt(() => api.setPollSettings({ [source.key]: null }))}
          >
            Reset
          </AppButton>
          <IntervalForm
            key={`${source.key}:${source.setting.intervalMs}:${source.setting.idleIntervalMs}`}
            source={source}
            busy={busy}
            onSave={(intervalMs, idleIntervalMs) =>
              void attempt(() =>
                api.setPollSettings({
                  [source.key]: {
                    intervalMs,
                    idleIntervalMs:
                      source.key === "worktrees" || source.key === "files"
                        ? intervalMs
                        : idleIntervalMs,
                  },
                }),
              )
            }
          />
        </fieldset>
      ))}
      <fieldset className="settings-group">
        <legend className="settings-group-title">Charts</legend>
        <AppButton
          type="button"
          className="settings-group-reset"
          aria-label="Reset chart ticker"
          onClick={() => onChartTick(5000)}
        >
          Reset
        </AppButton>
        <div className="settings-controls">
          <div className="settings-field settings-field-number">
            <CarbonTextInput
              labelText={
                <>
                  <span className="settings-label">
                    <span id={tickerId}>Chart ticker seconds</span>
                    <ControlDescription>
                      Redraws the sessions table charts on the local clock. It reads no data.
                    </ControlDescription>
                  </span>
                </>
              }
              aria-labelledby={tickerId}
              type="number"
              min="1"
              max="60"
              step="1"
              value={chartTickMs / 1000}
              onChange={(event) => {
                const seconds = Number(event.target.value);
                if (Number.isInteger(seconds) && seconds >= 1 && seconds <= 60)
                  onChartTick(seconds * 1000);
              }}
            />
          </div>
        </div>
      </fieldset>
    </section>
  );
}

/** A source row, or one of its results nested below it. */
interface PollRow {
  id: string;
  parent: PollKey | undefined;
  source: PollState;
  result: PollResult | undefined;
  name: string;
  status: string;
  effectiveIntervalMs: number;
  settings: string;
  polledAt: number;
  succeededAt: number;
  nextAt: number;
  failures: number;
  lastResult: string;
  recent: number;
}
type PollColumn =
  | "name"
  | "status"
  | "effectiveIntervalMs"
  | "settings"
  | "polledAt"
  | "succeededAt"
  | "nextAt"
  | "failures"
  | "lastResult"
  | "recent";
const pollColumns: {
  key: PollColumn;
  title: string;
  width: number;
  filter?: "date" | "category" | "number";
}[] = [
  { key: "name", title: "Source", width: 180 },
  { key: "status", title: "Status", width: 120, filter: "category" },
  { key: "effectiveIntervalMs", title: "Interval", width: 75, filter: "number" },
  { key: "settings", title: "Active and idle", width: 125 },
  { key: "polledAt", title: "Last attempt", width: 110, filter: "date" },
  { key: "succeededAt", title: "Last success", width: 110, filter: "date" },
  { key: "nextAt", title: "Next poll", width: 115, filter: "date" },
  { key: "failures", title: "Failures in a row", width: 130, filter: "number" },
  { key: "lastResult", title: "Last result", width: 240 },
  { key: "recent", title: "Recent durations", width: 170, filter: "number" },
];
export const statusText = (status: PollState["status"]) =>
  status.charAt(0).toUpperCase() + status.slice(1);
const nextText = (nextAt: number | null, now: number) =>
  nextAt === null ? "Not scheduled" : `In ${Math.max(0, Math.ceil((nextAt - now) / 1000))}s`;
export const lastResultText = (result: PollResult | undefined) =>
  result
    ? `${result.ok ? "Success" : "Failed"}, ${triggerLabels[result.trigger].toLowerCase()}, ${result.durationMs} ms`
    : "None yet";
/** A result row already shows its trigger and outcome, so this adds the duration and any error. */
const resultText = (result: PollResult) =>
  result.error ? `${result.durationMs} ms: ${result.error}` : `${result.durationMs} ms`;
const parentOf = (row: PollRow) => row.parent;
const actionable = (row: PollRow) => !row.parent;

/** Source rows followed, when expanded, by their results, newest first. */
export function pollRows(sources: PollState[], expanded: ReadonlySet<string>): PollRow[] {
  return sources.flatMap((source) => {
    const row: PollRow = {
      id: source.key,
      parent: undefined,
      source,
      result: undefined,
      name: labels[source.key],
      status: source.status,
      effectiveIntervalMs: source.effectiveIntervalMs ?? -1,
      settings: `${intervalText(source.setting.intervalMs)} and ${intervalText(source.setting.idleIntervalMs)}`,
      polledAt: source.polledAt ?? -1,
      succeededAt: source.succeededAt ?? -1,
      nextAt: source.nextAt ?? Number.MAX_SAFE_INTEGER,
      failures: source.failures,
      lastResult: lastResultText(source.history.at(-1)),
      recent: source.history.at(-1)?.durationMs ?? -1,
    };
    if (!expanded.has(source.key)) return [row];
    return [
      row,
      ...source.history.toReversed().map(
        (result): PollRow => ({
          ...row,
          id: `${source.key}:${result.id}`,
          parent: source.key,
          result,
          name: triggerLabels[result.trigger],
          status: result.ok ? "success" : "failed",
          polledAt: result.at,
          lastResult: resultText(result),
          recent: result.durationMs,
        }),
      ),
    ];
  });
}

export function PollingPage({
  polling,
  visible,
  chartTickMs,
  onActions,
  ...options
}: Pick<PollingProps, "polling" | "chartTickMs"> &
  Pick<TableOptions, "workspace" | "lines" | "density" | "fit" | "textStyles"> & {
    visible: boolean;
    onActions(id: string, bounds: Rectangle, contextual?: boolean): void;
  }) {
  const [selected, setSelected] = useState<string>();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const now = useTicker(visible, chartTickMs);
  const rows = useMemo(() => pollRows(polling.sources, expanded), [polling.sources, expanded]);
  // Choosing a source row shows or hides its results, by mouse or by Enter.
  const choose = (id: string) => {
    setSelected(id);
    if (!pollKeys.includes(id as PollKey)) return;
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };
  const display = (row: PollRow, key: PollColumn): string => {
    const { source, result } = row;
    if (result) {
      switch (key) {
        case "name":
          return `${triggerLabels[result.trigger]} poll of ${labels[source.key]}`;
        case "status":
          return result.ok ? "Success" : "Failed";
        case "polledAt":
          return time(result.at);
        case "lastResult":
          return row.lastResult;
        case "recent":
          return `${result.durationMs} ms`;
        default:
          return "";
      }
    }
    switch (key) {
      case "name":
        return `${row.name}, ${source.history.length} results, ${expanded.has(source.key) ? "expanded" : "collapsed"}`;
      case "status":
        return statusText(source.status);
      case "effectiveIntervalMs":
        return intervalText(source.effectiveIntervalMs);
      case "polledAt":
        return time(source.polledAt);
      case "succeededAt":
        return time(source.succeededAt);
      case "nextAt":
        return nextText(source.nextAt, now);
      case "failures":
        return String(source.failures);
      case "recent":
        return source.history.length
          ? `${source.history.length} samples, maximum ${Math.max(...source.history.map((item) => item.durationMs))} ms`
          : "No samples";
      default:
        return String(row[key]);
    }
  };
  const renderCell = (row: PollRow, key: PollColumn) => {
    const { source, result } = row;
    if (key === "name" && !result)
      return (
        <AppButton
          variant="quiet"
          className="small"
          aria-label={`${expanded.has(source.key) ? "Collapse" : "Expand"} ${row.name}`}
          aria-expanded={expanded.has(source.key)}
          onClick={() => choose(row.id)}
        >
          <Icon name={expanded.has(source.key) ? "chevron--down" : "chevron--right"} />
          {row.name}
        </AppButton>
      );
    if (key === "status")
      return (
        <span className="carbon-status">
          <Icon
            name={
              row.status === "failed"
                ? "warning--alt--filled"
                : row.status === "polling"
                  ? "renew"
                  : row.status === "paused"
                    ? "pause"
                    : row.status === "healthy" || row.status === "success"
                      ? "checkmark"
                      : "time"
            }
          />
          {display(row, key)}
        </span>
      );
    if (key !== "recent" || !source.history.length) return undefined;
    const max = Math.max(1, ...source.history.map((item) => item.durationMs));
    return (
      <span className="carbon-chart-value">
        <svg viewBox="0 0 150 24" role="img" aria-label={display(row, key)}>
          {result ? (
            <rect
              x="1"
              y="8"
              width={Math.max(1, (result.durationMs / max) * 148)}
              height="8"
              fill={result.ok ? "currentColor" : "none"}
              stroke="currentColor"
            />
          ) : (
            source.history.map((item, index) => (
              <rect
                key={item.id}
                x={index * 3}
                y={23 - Math.max(1, (item.durationMs / max) * 22)}
                width="2"
                height={Math.max(1, (item.durationMs / max) * 22)}
                fill={item.ok ? "currentColor" : "none"}
                stroke="currentColor"
              />
            ))
          )}
          <title>{display(row, key)}</title>
        </svg>
        {result && <span>{result.durationMs} ms</span>}
      </span>
    );
  };
  return (
    <main
      className="sessions polling-page"
      aria-label="Polling monitor"
      data-heading-lines={options.lines.heading}
    >
      <DataTable
        {...options}
        tableId="polling"
        rows={rows}
        columns={pollColumns}
        display={display}
        initialSort="name"
        selected={selected}
        onSelect={choose}
        onActions={onActions}
        parent={parentOf}
        hasActions={actionable}
        align={(key) => (key === "failures" ? "right" : "left")}
        renderCell={renderCell}
      />
    </main>
  );
}
