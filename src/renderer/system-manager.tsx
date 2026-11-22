import { useEffect, useRef, useState } from "react";
import type { AutomationUiRequest, DesktopApi, SchedulerStatus } from "../bridge/index.js";
import { Icon } from "./icons.js";
import { PageTitle } from "./page-title.js";
import { schedulingServiceLabels, schedulingServiceState } from "./scheduling-service.js";
import { observeServiceStatusPolling } from "./service-status-polling.js";

type ServiceAction = Extract<
  AutomationUiRequest,
  { action: "scheduler" | "resumeAll" | "resolveBlock" }
>;

export function SystemManagerPage({
  api,
  active,
  pollingPaused = false,
}: {
  api: Pick<DesktopApi, "automation" | "onAutomationChanged">;
  active: boolean;
  pollingPaused?: boolean;
}) {
  const [status, setStatus] = useState<SchedulerStatus>();
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [reading, setReading] = useState(false);
  const [actionError, setActionError] = useState("");
  const busy = progress !== "";
  const generation = useRef(0);
  const pending = useRef(false);
  const mutation = useRef(0);
  const pollDelay = useRef(2000);
  const refresh = useRef<(background?: boolean, changed?: boolean) => Promise<void>>(
    async () => {},
  );
  useEffect(() => {
    const owner = ++generation.current;
    if (!active) return;
    let disposed = false;
    let flight: Promise<void> | undefined;
    let dirty = false;
    let visibility = 0;
    let failures = 0;
    const visibilityChanged = () => {
      visibility++;
    };
    const retry = (failed: boolean) => {
      failures = failed ? Math.min(failures + 1, 5) : 0;
      pollDelay.current = Math.min(60_000, 2000 * 2 ** Math.min(failures, 5));
    };
    const read = (background = false, changed = true): Promise<void> => {
      if (disposed || document.hidden) return Promise.resolve();
      if (pending.current) {
        dirty = true;
        return Promise.resolve();
      }
      if (!background) {
        setReading(true);
        setActionError("");
      }
      if (flight) {
        if (changed) dirty = true;
        return flight;
      }
      flight = Promise.resolve().then(async () => {
        try {
          do {
            dirty = false;
            const ticket = mutation.current;
            const visibleTicket = visibility;
            try {
              const next = await api.automation({ action: "scheduler", control: "status" });
              if (disposed || pending.current || document.hidden) return;
              if (ticket !== mutation.current || visibleTicket !== visibility) {
                dirty = true;
                continue;
              }
              const value = next as SchedulerStatus;
              retry(value.nativeState === "unavailable");
              setStatus(value);
              setError("");
            } catch {
              if (disposed || pending.current || document.hidden) return;
              if (ticket !== mutation.current || visibleTicket !== visibility) {
                dirty = true;
                continue;
              }
              retry(true);
              setStatus(undefined);
              setError(
                "Scheduling Service status is unavailable. Existing schedules and evidence are kept.",
              );
            }
          } while (dirty && !disposed && !pending.current);
        } finally {
          flight = undefined;
          if (!disposed) setReading(false);
        }
      });
      return flight;
    };
    refresh.current = read;
    document.addEventListener("visibilitychange", visibilityChanged);
    const off = api.onAutomationChanged(() => void read(true));
    void read();
    return () => {
      disposed = true;
      if (generation.current === owner) generation.current++;
      refresh.current = async () => {};
      document.removeEventListener("visibilitychange", visibilityChanged);
      off();
    };
  }, [active, api]);
  useEffect(() => {
    if (active && !pollingPaused)
      return observeServiceStatusPolling(
        () => refresh.current(true, false),
        () => pollDelay.current,
      );
  }, [active, pollingPaused]);
  const act = async (request: ServiceAction) => {
    if (pending.current) return;
    pending.current = true;
    mutation.current++;
    const owner = generation.current;
    setProgress(
      request.action === "scheduler"
        ? {
            install: "Installing…",
            start: "Starting…",
            stop: "Stopping…",
            repair: "Repairing…",
            uninstall: "Uninstalling…",
            status: "Checking…",
          }[request.control]
        : request.action === "resumeAll"
          ? "Resuming jobs…"
          : "Rechecking…",
    );
    setActionError("");
    try {
      await api.automation(request);
      pending.current = false;
      await refresh.current();
    } catch (cause) {
      pending.current = false;
      await refresh.current();
      if (owner === generation.current)
        setActionError(
          cause instanceof Error ? cause.message : "Scheduling Service action failed.",
        );
    } finally {
      pending.current = false;
      setProgress("");
    }
  };
  const state = schedulingServiceState(status, !!error);
  const live = status?.service;
  const statusHint = pollingPaused
    ? "Status polling is paused. Resume polling or refresh to check again."
    : "Automatic checks will retry.";
  const mainAction =
    state === "not-installed" || (state === "running" && !status?.installed)
      ? "install"
      : state === "stopped"
        ? "start"
        : state === "running"
          ? "stop"
          : undefined;
  const stateIcon =
    state === "running"
      ? "play--filled"
      : state === "stopped"
        ? "stop"
        : state === "not-installed"
          ? "subtract"
          : state === "checking"
            ? "renew"
            : "warning--alt";
  return (
    <section className="system-manager-page">
      <header className="table-controls">
        <PageTitle
          page="system-manager"
          className="table-title"
          actions={[
            {
              id: "system-manager-0",
              label: "Refresh Scheduling Service",
              run: () => void refresh.current(),
              disabled: busy || reading,
            },
          ]}
        />
      </header>
      <section
        className="automation-service"
        data-state={state}
        aria-labelledby="automation-service-title"
        aria-busy={busy || reading}
      >
        <div className="automation-service-summary">
          <div className="automation-service-copy">
            <h2 id="automation-service-title">Scheduling Service</h2>
            <p className="automation-service-state" role="status">
              <span className="automation-service-badge" data-state={state}>
                <Icon name={stateIcon} />
                {schedulingServiceLabels[state]}
              </span>
              {state === "running" && !status?.installed && <span>· Not installed</span>}
              {live?.pausedAll && <span>· Jobs paused</span>}
              {live?.activeExecutionId && <span>· A run is active</span>}
              {progress && <span>· {progress}</span>}
            </p>
          </div>
          <div className="automation-service-actions">
            {mainAction && (
              <button
                type="button"
                className="primary"
                disabled={busy || reading}
                onClick={() => void act({ action: "scheduler", control: mainAction })}
              >
                {mainAction.charAt(0).toUpperCase() + mainAction.slice(1)}
              </button>
            )}
            {live?.pausedAll && (
              <button
                type="button"
                disabled={busy || reading}
                onClick={() => void act({ action: "resumeAll" })}
              >
                Resume jobs
              </button>
            )}
          </div>
        </div>
        {state === "unavailable" && !error && (
          <p className="automation-service-note">
            The Scheduling Service could not be verified. {statusHint}
          </p>
        )}
        {live?.block && (
          <div className="automation-block" role="alert">
            <span>
              {live.block.reason === "leftover_agent"
                ? "An unfinished agent process needs recovery."
                : "The service could not save its private state."}
            </span>
            <button
              type="button"
              className="small"
              disabled={busy || reading}
              onClick={() => void act({ action: "resolveBlock" })}
            >
              Recheck
            </button>
          </div>
        )}
        {(status?.installed || state === "unavailable") && (
          <details className="automation-service-options">
            <summary>Service options</summary>
            <div className="automation-service-tools">
              {(["repair", ...(status?.installed ? ["uninstall" as const] : [])] as const).map(
                (control) => (
                  <button
                    type="button"
                    className={`small${control === "uninstall" ? " danger-text" : ""}`}
                    key={control}
                    disabled={busy || reading}
                    onClick={() => void act({ action: "scheduler", control })}
                  >
                    {control.charAt(0).toUpperCase() + control.slice(1)}
                  </button>
                ),
              )}
            </div>
          </details>
        )}
      </section>
      {error && (
        <p role="alert">
          {error} {statusHint}
        </p>
      )}
      {actionError && <p role="alert">{actionError}</p>}
    </section>
  );
}
