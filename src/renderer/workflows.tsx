import {
  Tab,
  TabList,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TabPanel,
  TabPanels,
  Tabs,
} from "@carbon/react";
import { useEffect, useRef, useState } from "react";
import type {
  ApplicationClient,
  WorkflowEvent,
  WorkflowList,
  WorkflowRead,
  WorkflowRecord,
  WorkflowRequest,
} from "../bridge/index.js";
import { Button as AppButton } from "./carbon/button.js";
import { Modal } from "./modal.js";
import { PageTitle } from "./page-title.js";
import { observeServiceStatusPolling } from "./service-status-polling.js";
import {
  advanceWorkflowClock,
  emptyWorkflowClock,
  retainWorkflowActivity,
} from "./workflow-activity.js";
import { WorkflowForm } from "./workflow-form.js";
import { statusLabel, WorkflowPlayer } from "./workflow-player.js";

export function WorkflowsPage({
  api,
  active,
  paused,
  providerReady,
  onProvider,
}: {
  api: ApplicationClient;
  active: boolean;
  paused: boolean;
  providerReady: boolean;
  onProvider(): void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState(0);
  const [template, setTemplate] = useState<WorkflowRecord>();
  const [creating, setCreating] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  useEffect(() => {
    if (!active) setShowLogin(false);
  }, [active]);
  const [list, setList] = useState<WorkflowList | null>(null);
  const [detail, setDetail] = useState<WorkflowRead | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [actionError, setActionError] = useState("");
  const [activity, setActivity] = useState({
    events: [] as WorkflowEvent[],
    trimmed: false,
    clock: emptyWorkflowClock,
  });
  const retained = useRef(activity);
  const owner = useRef(0);
  const [reconnect, setReconnect] = useState<string>();
  const delay = useRef(2000);
  const refresh = useRef<(fresh?: boolean) => Promise<void>>(async () => {});
  const record = detail?.record.id === selected ? detail.record : null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: Changing the selected workflow resets its private activity cursor and detail.
  useEffect(() => {
    retained.current = { events: [], trimmed: false, clock: emptyWorkflowClock };
    setActivity(retained.current);
    setDetail(null);
    setActionError("");
  }, [selected]);

  useEffect(() => {
    const epoch = ++owner.current;
    let flight: Promise<void> | undefined;
    const owns = () => active && epoch === owner.current;
    const read = async () => {
      if (!owns() || document.hidden) return;
      try {
        const listing = (await api.workflow({ action: "list" })) as WorkflowList;
        if (!owns()) return;
        setList(listing);
        const next = selected
          ? ((await api.workflow({ action: "read", id: selected })) as WorkflowRead)
          : null;
        if (!owns()) return;
        setDetail(next);
        if (next?.connected && next.record.snapshot && selected) {
          const snapshot = next.record.snapshot;
          for (
            let page = 0;
            page < 4 && retained.current.clock.cursor < snapshot.eventCursor;
            page++
          ) {
            const after = retained.current.clock.cursor;
            const result = (await api.workflow({ action: "events", id: selected, after })) as {
              events: WorkflowEvent[];
            };
            if (!owns()) return;
            const events = result.events.filter((event) => event.sequence <= snapshot.eventCursor);
            if (!events.length) break;
            const window = retainWorkflowActivity(retained.current.events, events);
            retained.current = {
              events: window.events,
              trimmed: window.trimmed || retained.current.trimmed,
              clock: advanceWorkflowClock(
                retained.current.clock,
                events,
                next.record.definition.tasks.length,
              ),
            };
            setActivity(retained.current);
          }
        }
        setError("");
        delay.current = next?.connected === false ? Math.min(60000, delay.current * 2) : 2000;
      } catch (cause) {
        if (owns()) {
          setError(cause instanceof Error ? cause.message : "Workflow refresh failed");
          delay.current = Math.min(60000, delay.current * 2);
        }
      }
    };
    refresh.current = async (fresh = false) => {
      if (fresh && flight) await flight;
      if (!owns()) return;
      flight ??= read().finally(() => {
        flight = undefined;
      });
      await flight;
    };
    if (active) void refresh.current();
    return () => {
      owner.current++;
    };
  }, [api, active, selected]);
  useEffect(() => {
    if (!active) setReconnect(undefined);
    if (active && !paused)
      return observeServiceStatusPolling(
        () => refresh.current(),
        () => delay.current,
      );
  }, [active, paused]);

  const act = async (request: WorkflowRequest) => {
    if (busy) return false;
    const epoch = owner.current;
    setBusy(request.action);
    setActionError("");
    try {
      await api.workflow(request);
      if (owner.current !== epoch) return false;
      // A read that started before the action cannot establish its outcome.
      await refresh.current(true);
      return owner.current === epoch;
    } catch (cause) {
      if (owner.current === epoch) {
        setActionError(cause instanceof Error ? cause.message : "Workflow action failed");
        await refresh.current();
      }
      return false;
    } finally {
      setBusy("");
    }
  };
  const showHistory = () => {
    setCreating(false);
    setSelected(null);
    setView(1);
  };
  const newWorkflow = (
    <AppButton
      variant="primary"
      disabled={!!busy || !list?.supported}
      onClick={() => {
        setTemplate(undefined);
        setCreating(true);
      }}
    >
      New workflow
    </AppButton>
  );
  const actions = (
    <div className="workflow-actions">
      {selected && <AppButton onClick={showHistory}>Workflow history</AppButton>}
      {!creating && !selected && view === 0 && !!list?.entries.length && newWorkflow}
      {!creating && (
        <AppButton
          disabled={!!busy}
          onClick={() => {
            setActionError("");
            void refresh.current();
          }}
        >
          Refresh
        </AppButton>
      )}
      {list?.supported && !selected && (
        <AppButton variant="quiet" aria-haspopup="dialog" onClick={() => setShowLogin(true)}>
          Workflow sign-in
        </AppButton>
      )}
      {record && detail?.connected === false && list?.supported && (
        <AppButton disabled={!!busy} onClick={() => setReconnect(record.id)}>
          Reconnect engine…
        </AppButton>
      )}
    </div>
  );
  return (
    <section className="workflows-page" aria-label="Workflows">
      <PageTitle page="workflows">
        {creating ? "New workflow" : record ? record.name : "Workflows"}
      </PageTitle>
      {(creating || selected) && actions}
      {active && showLogin && (
        <Modal
          footer={
            <>
              <AppButton variant="primary" onClick={() => setShowLogin(false)}>
                Done
              </AppButton>
            </>
          }
          title="Workflow sign-in"
          busy={false}
          onClose={() => setShowLogin(false)}
        >
          <p>Run this command in a terminal on the computer hosting Code60.</p>
          <pre>
            <code>code60 workflows login</code>
          </pre>
          <p>
            Complete the Codex sign-in there, then return to review and start your workflow.
            Transmission uses its own Codex credentials.
          </p>
        </Modal>
      )}
      {record && reconnect === record.id && active && (
        <Modal
          footer={
            <>
              <AppButton variant="secondary" type="button" onClick={() => setReconnect(undefined)}>
                Cancel
              </AppButton>
              <AppButton
                variant="primary"
                type="button"
                onClick={() => {
                  setReconnect(undefined);
                  void act({ action: "reconnect", id: record.id });
                }}
              >
                Reconnect engine
              </AppButton>
            </>
          }
          key={record.id}
          title="Reconnect engine?"
          busy={!!busy}
          onClose={() => setReconnect(undefined)}
        >
          <p>Starting this engine can resume unfinished approved workflows.</p>
        </Modal>
      )}
      <div className="workflow-content">
        {list?.supported === false && (
          <p role="status">
            Transmission execution requires macOS Apple Silicon or Linux x64 with glibc and Node
            24.22 or later in the 24.x series. Saved history remains available.
          </p>
        )}
        {error && <p role="alert">Refresh failed. The last verified state is retained. {error}</p>}
        {actionError && !record && <p role="alert">{actionError}</p>}
        {creating ? (
          <WorkflowForm
            initialDefinition={template?.definition}
            api={api}
            active={active}
            providerReady={providerReady}
            onProvider={onProvider}
            onClose={() => {
              setCreating(false);
              setTemplate(undefined);
              setView(0);
            }}
            onCreated={(entry) => {
              setCreating(false);
              setSelected(entry.id);
            }}
          />
        ) : record && detail ? (
          <WorkflowPlayer
            key={record.id}
            api={api}
            record={record}
            active={active}
            polling={!paused}
            connected={!!list?.supported && detail.connected && !error}
            problem={detail.error}
            actionError={actionError}
            activity={activity}
            busy={busy}
            act={act}
          />
        ) : (
          !selected && (
            <Tabs selectedIndex={view} onChange={({ selectedIndex }) => setView(selectedIndex)}>
              <TabList aria-label="Workflow views">
                <Tab>Definitions</Tab>
                <Tab>Execution history</Tab>
              </TabList>
              <TabPanels>
                {["Definitions", "Execution history"].map((label, index) => (
                  <TabPanel key={label}>
                    {view === index && actions}
                    <nav
                      className="workflow-history"
                      aria-label={index ? "Workflow history" : "Workflow definitions"}
                    >
                      {!list && !error && <p role="status">Loading workflows…</p>}
                      {list && !list.entries.length && (
                        <section className="workflow-empty">
                          <h2>{index ? "No workflow executions yet" : "No saved workflows"}</h2>
                          <p>
                            {index
                              ? "Review the status and results here after a workflow starts."
                              : "Create a workflow to define the tasks and checks for a repository."}
                          </p>
                          {index === 0 && newWorkflow}
                          {index === 1 && (
                            <AppButton onClick={() => setView(0)}>Open definitions</AppButton>
                          )}
                        </section>
                      )}
                      {list && list.entries.length > 0 && (
                        <Table size="md" aria-label={label}>
                          <TableHead>
                            <TableRow>
                              <TableHeader>Workflow</TableHeader>
                              <TableHeader>{index ? "Started" : "Repository"}</TableHeader>
                              <TableHeader>{index ? "Status" : "Tasks"}</TableHeader>
                              {!index && <TableHeader>Action</TableHeader>}
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {list.entries
                              .slice()
                              .reverse()
                              .map((entry) => (
                                <TableRow key={entry.id}>
                                  <TableCell>
                                    {index ? (
                                      <AppButton
                                        variant="quiet"
                                        onClick={() => setSelected(entry.id)}
                                      >
                                        {entry.name}
                                      </AppButton>
                                    ) : (
                                      entry.name
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    {index
                                      ? new Date(entry.createdAt).toLocaleString()
                                      : entry.repository}
                                  </TableCell>
                                  <TableCell>
                                    {index
                                      ? entry.stopPending
                                        ? "Stop acknowledgement pending"
                                        : statusLabel(entry.snapshot?.status ?? entry.state)
                                      : entry.definition.tasks.length}
                                  </TableCell>
                                  {!index && (
                                    <TableCell>
                                      <AppButton
                                        disabled={!list.supported || !!busy}
                                        aria-label={`Edit a copy of ${entry.name}`}
                                        onClick={() => {
                                          setTemplate(entry);
                                          setCreating(true);
                                        }}
                                      >
                                        Edit a copy
                                      </AppButton>
                                    </TableCell>
                                  )}
                                </TableRow>
                              ))}
                          </TableBody>
                        </Table>
                      )}
                    </nav>
                  </TabPanel>
                ))}
              </TabPanels>
            </Tabs>
          )
        )}
      </div>
    </section>
  );
}
