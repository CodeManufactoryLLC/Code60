import { Tab, TabList, TabPanel, TabPanels, Tabs } from "@carbon/react";
import { useEffect, useRef, useState } from "react";
import {
  type ApplicationClient,
  type AutomationUiRequest,
  abbreviateTerminalPath,
  type SchedulerStatus,
  type TerminalSummary,
} from "../bridge/index.js";
import { Button as AppButton } from "./carbon/button.js";
import { Icon } from "./icons.js";
import { PageTitle } from "./page-title.js";
import { schedulingServiceLabels, schedulingServiceState } from "./scheduling-service.js";
import { observeServiceStatusPolling } from "./service-status-polling.js";

type ServiceAction = Extract<
  AutomationUiRequest,
  { action: "scheduler" | "resumeAll" | "resolveBlock" }
>;

type SystemManagerApi = Pick<ApplicationClient, "automation" | "onAutomationChanged"> &
  Partial<Pick<ApplicationClient, "listTerminals" | "closeTerminal" | "onTerminalsChanged">>;

function terminalStartedLabel(startedAt: string): string {
  const date = new Date(startedAt);
  if (Number.isNaN(date.getTime())) return startedAt;
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function terminalTargetLabel(kind: TerminalSummary["targetKind"]): string {
  switch (kind) {
    case "project-worker":
      return "Project worker";
    case "project":
      return "Project";
    case "relay-worker":
      return "Relay worker";
    case "relay":
      return "Relay";
  }
}

export function SystemManagerPage({
  api,
  active,
  pollingPaused = false,
}: {
  api: SystemManagerApi;
  active: boolean;
  pollingPaused?: boolean;
}) {
  const [status, setStatus] = useState<SchedulerStatus>();
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [reading, setReading] = useState(false);
  const [actionError, setActionError] = useState("");
  const [tab, setTab] = useState(0);
  const [terminals, setTerminals] = useState<TerminalSummary[]>([]);
  const [terminalsError, setTerminalsError] = useState("");
  const [closingId, setClosingId] = useState<string | null>(null);
  const busy = progress !== "";
  const generation = useRef(0);
  const pending = useRef(false);
  const mutation = useRef(0);
  const pollDelay = useRef(2000);
  const refresh = useRef<(background?: boolean, changed?: boolean) => Promise<void>>(
    async () => {},
  );
  const refreshTerminals = useRef<() => Promise<void>>(async () => {});
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
                "Backend Service status is unavailable. Existing schedules and evidence are kept.",
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
  useEffect(() => {
    if (!active || !api.listTerminals) return;
    let disposed = false;
    const listTerminals = api.listTerminals;
    const load = async () => {
      if (disposed || document.hidden) return;
      try {
        const items = await listTerminals();
        if (disposed || document.hidden) return;
        setTerminals(items);
        setTerminalsError("");
      } catch (cause) {
        if (disposed || document.hidden) return;
        setTerminalsError(
          cause instanceof Error ? cause.message : "Could not load active terminal sessions.",
        );
      }
    };
    const onVisibility = () => {
      if (!document.hidden) void load();
    };
    refreshTerminals.current = load;
    document.addEventListener("visibilitychange", onVisibility);
    const off = api.onTerminalsChanged?.(() => void load());
    void load();
    return () => {
      disposed = true;
      refreshTerminals.current = async () => {};
      document.removeEventListener("visibilitychange", onVisibility);
      off?.();
    };
  }, [active, api]);
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
        setActionError(cause instanceof Error ? cause.message : "Backend Service action failed.");
    } finally {
      pending.current = false;
      setProgress("");
    }
  };
  const closeTerminalSession = async (id: string) => {
    if (!api.closeTerminal || closingId !== null) return;
    setClosingId(id);
    setTerminalsError("");
    try {
      await api.closeTerminal({ id });
      await refreshTerminals.current();
    } catch (cause) {
      setTerminalsError(
        cause instanceof Error ? cause.message : "Could not stop terminal session.",
      );
    } finally {
      setClosingId(null);
    }
  };
  const state = schedulingServiceState(status, !!error);
  const live = status?.service;
  const statusHint = pollingPaused
    ? "Status polling is paused. Resume polling or refresh to check again."
    : "Automatic checks will retry.";
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
              label: "Refresh Backend Service",
              run: () => {
                void refresh.current();
                void refreshTerminals.current();
              },
              disabled: busy || reading,
            },
          ]}
        />
      </header>
      <Tabs
        selectedIndex={tab}
        onChange={({ selectedIndex }) => {
          setTab(selectedIndex);
        }}
      >
        <TabList aria-label="System Manager views">
          <Tab>Services</Tab>
          <Tab>{terminals.length > 0 ? `Terminals (${terminals.length})` : "Terminals"}</Tab>
        </TabList>
        <TabPanels>
          <TabPanel>
            <section
              className="automation-service"
              data-state={state}
              aria-labelledby="automation-service-title"
              aria-busy={busy || reading}
            >
              <div className="automation-service-summary">
                <div className="automation-service-copy">
                  <h2 id="automation-service-title">Backend Service</h2>
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
                  {live?.pausedAll && (
                    <AppButton
                      type="button"
                      disabled={busy || reading}
                      onClick={() => void act({ action: "resumeAll" })}
                    >
                      Resume jobs
                    </AppButton>
                  )}
                </div>
              </div>
              {state === "unavailable" && !error && (
                <p className="automation-service-note">
                  The Backend Service could not be verified. {statusHint}
                </p>
              )}
              {live?.block && (
                <div className="automation-block" role="alert">
                  <span>
                    {live.block.reason === "leftover_agent"
                      ? "An unfinished agent process needs recovery."
                      : "The service could not save its private state."}
                  </span>
                  <AppButton
                    type="button"
                    className="small"
                    disabled={busy || reading}
                    onClick={() => void act({ action: "resolveBlock" })}
                  >
                    Recheck
                  </AppButton>
                </div>
              )}
              <p>
                Manage the login backend locally with <code>code60 service status</code>,{" "}
                <code>code60 service repair</code> or <code>code60 service uninstall</code>. Closing
                this browser keeps approved work running.
              </p>
            </section>
            {error && (
              <p role="alert">
                {error} {statusHint}
              </p>
            )}
            {actionError && <p role="alert">{actionError}</p>}
          </TabPanel>
          <TabPanel>
            <section
              className="system-manager-terminals"
              aria-labelledby="system-manager-terminals-title"
            >
              <div className="system-manager-terminals-header">
                <h2 id="system-manager-terminals-title">Active Terminals</h2>
                <span className="system-manager-terminals-count" role="status">
                  {terminals.length === 1 ? "1 session" : `${terminals.length} sessions`}
                </span>
              </div>
              {terminalsError && <p role="alert">{terminalsError}</p>}
              {terminals.length === 0 ? (
                <p className="system-manager-terminals-empty">No active terminal sessions.</p>
              ) : (
                <ul className="system-manager-terminal-list">
                  {terminals.map((session) => (
                    <li key={session.id} className="system-manager-terminal-item">
                      <div className="system-manager-terminal-main">
                        <div className="system-manager-terminal-heading">
                          <Icon name="terminal" />
                          <strong>{session.label}</strong>
                          <span className="system-manager-terminal-kind">
                            {terminalTargetLabel(session.targetKind)}
                          </span>
                        </div>
                        <dl className="system-manager-terminal-meta">
                          <div>
                            <dt>Project</dt>
                            <dd title={session.project ?? "Relay"}>
                              {session.project
                                ? (session.displayProject ??
                                  abbreviateTerminalPath(session.project))
                                : "Relay"}
                            </dd>
                          </div>
                          <div>
                            <dt>Folder</dt>
                            <dd className="system-manager-terminal-path" title={session.cwd}>
                              {session.displayCwd ?? abbreviateTerminalPath(session.cwd)}
                            </dd>
                          </div>
                          <div>
                            <dt>Shell</dt>
                            <dd>
                              {session.shell} · PID {session.pid} · Started{" "}
                              {terminalStartedLabel(session.startedAt)}
                            </dd>
                          </div>
                        </dl>
                      </div>
                      {api.closeTerminal && (
                        <div className="system-manager-terminal-actions">
                          <AppButton
                            type="button"
                            className="small"
                            disabled={closingId !== null}
                            onClick={() => void closeTerminalSession(session.id)}
                          >
                            {closingId === session.id ? "Closing…" : "Close terminal"}
                          </AppButton>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </TabPanel>
        </TabPanels>
      </Tabs>
    </section>
  );
}
