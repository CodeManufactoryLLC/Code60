import { useEffect, useRef, useState } from "react";
import type { AutomationUiRequest, DesktopApi, ServiceStatus } from "../bridge/index.js";
import { Icon } from "./icons.js";
import { PageTitle } from "./page-title.js";

type ServiceAction = Extract<
  AutomationUiRequest,
  { action: "scheduler" | "pauseAll" | "resumeAll" | "resolveBlock" }
>;

export function SystemManagerPage({
  api,
  active,
}: {
  api: Pick<DesktopApi, "automation" | "onAutomationChanged">;
  active: boolean;
}) {
  const [status, setStatus] = useState<ServiceStatus>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const pending = useRef(false);
  const refresh = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    const owner = ++generation.current;
    if (!active) return;
    let disposed = false;
    let running = false;
    let dirty = false;
    const read = async () => {
      if (disposed) return;
      if (running) {
        dirty = true;
        return;
      }
      running = true;
      try {
        do {
          dirty = false;
          const next = await api.automation({ action: "status" });
          if (disposed) return;
          setStatus(next as ServiceStatus);
          setError("");
        } while (dirty && !disposed);
      } catch {
        if (!disposed) {
          setStatus(undefined);
          setError(
            "Scheduler unavailable. Install or start the background service, then refresh. Existing schedules and evidence are kept.",
          );
        }
      } finally {
        running = false;
        if (dirty && !disposed) void read();
      }
    };
    refresh.current = read;
    const off = api.onAutomationChanged(() => void read());
    void read();
    return () => {
      disposed = true;
      if (generation.current === owner) generation.current++;
      refresh.current = async () => {};
      off();
    };
  }, [active, api]);
  const act = async (request: ServiceAction) => {
    if (pending.current) return;
    pending.current = true;
    const owner = generation.current;
    setBusy(true);
    setError("");
    try {
      await api.automation(request);
      await refresh.current();
    } catch (cause) {
      if (owner === generation.current)
        setError(cause instanceof Error ? cause.message : "Background service action failed.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <section className="system-manager-page">
      <header className="table-controls">
        <PageTitle page="system-manager" className="table-title" />
        <button
          type="button"
          className="icon-button"
          aria-label="Refresh background service"
          title="Refresh background service"
          disabled={busy}
          onClick={() => void refresh.current()}
        >
          <Icon name="renew" />
        </button>
      </header>
      <section className="automation-service" aria-labelledby="automation-service-title">
        <div className="automation-service-summary">
          <div className="automation-service-copy">
            <h2 id="automation-service-title">Background service</h2>
            <p className="automation-service-state" role="status">
              <span
                className={`automation-health-dot${status ? " is-connected" : ""}`}
                aria-hidden="true"
              />
              {status
                ? status.pausedAll
                  ? "Installed, all scheduled jobs paused"
                  : "Installed and running"
                : "Service unavailable"}
              {status?.activeExecutionId && !status.pausedAll ? " · A run is active" : ""}
            </p>
          </div>
          <div className="automation-service-actions">
            {status ? (
              status.pausedAll ? (
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() => void act({ action: "resumeAll" })}
                >
                  Resume all
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act({ action: "pauseAll", cancelActive: true })}
                >
                  Pause all and cancel active work
                </button>
              )
            ) : (
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => void act({ action: "scheduler", control: "install" })}
              >
                Install service
              </button>
            )}
          </div>
        </div>
        {status?.block && (
          <div className="automation-block" role="alert">
            <span>
              {status.block.reason === "leftover_agent"
                ? "An unfinished agent process needs recovery."
                : "The service could not save its private state."}
            </span>
            <button
              type="button"
              className="small"
              disabled={busy}
              onClick={() => void act({ action: "resolveBlock" })}
            >
              Recheck
            </button>
          </div>
        )}
        <details className="automation-service-options">
          <summary>Service options</summary>
          <div className="automation-service-tools">
            {(["install", "repair", "start", "stop", "uninstall"] as const).map((control) => (
              <button
                type="button"
                className={`small${control === "uninstall" ? " danger-text" : ""}`}
                key={control}
                disabled={busy}
                onClick={() => void act({ action: "scheduler", control })}
              >
                {control.charAt(0).toUpperCase() + control.slice(1)}
              </button>
            ))}
          </div>
        </details>
      </section>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
