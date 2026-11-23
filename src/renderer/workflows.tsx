import { useEffect, useRef, useState } from "react";
import type {
  ApplicationClient,
  WorkflowEvent,
  WorkflowList,
  WorkflowRead,
  WorkflowRequest,
} from "../bridge/index.js";
import { DialogContent } from "./neobrutalism/dialog.js";
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
  const [creating, setCreating] = useState(false);
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
  const reconnect = useRef<HTMLDialogElement>(null);
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
    if (!active) reconnect.current?.close();
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
  };
  return (
    <section className="workflows-page" aria-label="Workflows">
      <PageTitle
        page="workflows"
        actions={[
          {
            id: "new",
            label: "New workflow",
            disabled: !!busy || !list?.supported || creating,
            run: () => {
              setSelected(null);
              setCreating(true);
            },
          },
          {
            id: "refresh",
            label: "Refresh",
            disabled: !!busy,
            run: () => {
              setActionError("");
              void refresh.current();
            },
          },
          { id: "history", label: "Workflow history", disabled: !!busy, run: showHistory },
          ...(record && detail?.connected === false && list?.supported
            ? [
                {
                  id: "reconnect",
                  label: "Reconnect engine…",
                  disabled: !!busy,
                  run: () => {
                    reconnect.current?.showModal();
                  },
                },
              ]
            : []),
        ]}
      />
      {record && (
        <DialogContent key={record.id} ref={reconnect} aria-label="Reconnect engine">
          <h2>Reconnect engine?</h2>
          <p>Starting this engine can resume unfinished approved workflows.</p>
          <button type="button" onClick={() => reconnect.current?.close()}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              reconnect.current?.close();
              void act({ action: "reconnect", id: record.id });
            }}
          >
            Reconnect engine
          </button>
        </DialogContent>
      )}
      <div className="workflow-content">
        {list?.supported === false && (
          <p role="status">
            Transmission execution requires macOS and Node 24.22 or later in the 24.x series. Saved
            history remains available.
          </p>
        )}
        {error && <p role="alert">Refresh failed. The last verified state is retained. {error}</p>}
        {actionError && !record && <p role="alert">{actionError}</p>}
        {creating ? (
          <WorkflowForm
            api={api}
            active={active}
            providerReady={providerReady}
            onProvider={onProvider}
            onClose={showHistory}
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
            <nav className="workflow-history" aria-label="Workflow history">
              <h2>Workflow history</h2>
              {list && !list.entries.length && <p>No saved workflows</p>}
              <ul>
                {list?.entries
                  .slice()
                  .reverse()
                  .map((entry) => (
                    <li key={entry.id}>
                      <button type="button" onClick={() => setSelected(entry.id)}>
                        {entry.name}{" "}
                        <span>
                          {entry.stopPending
                            ? "Stop acknowledgement pending"
                            : statusLabel(entry.snapshot?.status ?? entry.state)}
                        </span>
                      </button>
                    </li>
                  ))}
              </ul>
            </nav>
          )
        )}
      </div>
    </section>
  );
}
