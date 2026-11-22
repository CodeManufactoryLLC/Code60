import { useEffect, useRef, useState } from "react";
import type { DesktopApi, WorkflowEvent, WorkflowList, WorkflowRead } from "../bridge/index.js";
import { PageTitle } from "./page-title.js";
import { observeServiceStatusPolling } from "./service-status-polling.js";
import { retainWorkflowActivity } from "./workflow-activity.js";
import { WorkflowForm } from "./workflow-form.js";

const statusLabel = (value: string) =>
  ({
    preparing: "Preparing worktree",
    preparation_failed: "Preparation failed",
    uncertain: "Start unconfirmed",
    needs_input: "Needs input",
  })[value] ?? value.charAt(0).toUpperCase() + value.slice(1);
type Diff = { content: string; nextOffset: number | null; revision?: string };
export function WorkflowsPage({
  api,
  active,
  paused,
  providerReady,
  onProvider,
}: {
  api: DesktopApi;
  active: boolean;
  paused: boolean;
  providerReady: boolean;
  onProvider(): void;
}) {
  const [list, setList] = useState<WorkflowList | null>(null);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<WorkflowRead | null>(null);
  const [task, setTask] = useState(0);
  const [events, setEvents] = useState<WorkflowEvent[]>([]);
  const [activityTrimmed, setActivityTrimmed] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [diff, setDiff] = useState("");
  const [offset, setOffset] = useState<number | null>(0);
  const [patchRevision, setPatchRevision] = useState<string | undefined>();
  const patchDecoder = useRef(new TextDecoder("utf-8", { fatal: true }));
  const [answer, setAnswer] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState("");
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const ticket = useRef(0);
  const interval = useRef(2_000);
  const record = detail?.record;
  // biome-ignore lint/correctness/useExhaustiveDependencies: A selected workflow owns all retained detail state.
  useEffect(() => {
    setDetail(null);
    setActionError("");
    setEvents([]);
    setActivityTrimmed(false);
    setCursor(0);
    setDiff("");
    setOffset(0);
    setPatchRevision(undefined);
    patchDecoder.current = new TextDecoder("utf-8", { fatal: true });
    setAnswer("");
    setMessage("");
    setTask(0);
  }, [selected]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Answers belong to an exact question identity.
  useEffect(() => {
    setAnswer("");
  }, [record?.snapshot?.decision?.id]);
  useEffect(() => {
    let disposed = false;
    let refreshing = false;
    const own = ++ticket.current;
    const refresh = async () => {
      if (disposed || refreshing || document.hidden) return;
      refreshing = true;
      try {
        const next = (await api.workflow({ action: "list" })) as WorkflowList;
        const nextDetail = selected
          ? ((await api.workflow({ action: "read", id: selected })) as WorkflowRead)
          : null;
        if (disposed || ticket.current !== own) return;
        setList(next);
        if (nextDetail) setDetail(nextDetail);
        interval.current =
          nextDetail?.connected === false ? Math.min(interval.current * 2, 60_000) : 2_000;
        setError("");
      } catch (cause) {
        if (!disposed) {
          setError(cause instanceof Error ? cause.message : "Workflow status unavailable");
          interval.current = Math.min(interval.current * 2, 60_000);
        }
      } finally {
        refreshing = false;
      }
    };
    refreshRef.current = refresh;
    if (active) void refresh();
    return () => {
      disposed = true;
      ticket.current++;
      refreshRef.current = async () => {};
    };
  }, [api, active, selected]);
  useEffect(() => {
    if (active && !paused)
      return observeServiceStatusPolling(
        () => refreshRef.current(),
        () => interval.current,
      );
  }, [active, paused]);
  const act = async (label: string, action: () => Promise<void>) => {
    if (busy) return;
    const own = ticket.current;
    setBusy(label);
    setActionError("");
    try {
      await action();
      if (ticket.current === own) await refreshRef.current();
    } catch (cause) {
      if (ticket.current === own)
        setActionError(
          cause instanceof Error
            ? cause.message
            : "Workflow action failed; inspect status before retrying",
        );
    } finally {
      setBusy("");
    }
  };
  const switchTo = (id: string) => {
    if (!busy) {
      setCreating(false);
      setSelected(id);
    }
  };
  const selectedTask = record?.definition.tasks[task];
  const state = record?.snapshot;
  const terminal = state && ["completed", "failed", "cancelled"].includes(state.status);
  const connected = detail?.connected === true;
  return (
    <section className="workflows-page" aria-label="Workflows">
      <header className="table-controls workflow-actions">
        <PageTitle page="workflows" className="table-title" />
        <button
          type="button"
          disabled={!!busy || list?.supported === false}
          onClick={() => {
            setSelected(null);
            setCreating(true);
          }}
        >
          New workflow
        </button>
        <button
          type="button"
          disabled={!!busy}
          onClick={() => {
            setActionError("");
            void refreshRef.current();
          }}
        >
          Refresh
        </button>
      </header>
      {list?.supported === false && (
        <p role="status">
          Transmission execution requires macOS and Node 24.22 or later in the 24.x series. Saved
          history remains available.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {actionError && <p role="alert">{actionError}</p>}
      <div className="workflow-layout">
        <nav aria-label="Workflow history">
          <ul>
            {list?.entries
              .slice()
              .reverse()
              .map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    disabled={!!busy}
                    aria-pressed={selected === entry.id}
                    onClick={() => switchTo(entry.id)}
                  >
                    {entry.name}
                    <span>{statusLabel(entry.snapshot?.status ?? entry.state)}</span>
                  </button>
                </li>
              ))}
          </ul>
        </nav>
        <div>
          {creating ? (
            <WorkflowForm
              api={api}
              active={active}
              providerReady={providerReady}
              onProvider={onProvider}
              onClose={() => setCreating(false)}
              onCreated={(entry) => {
                setList((current) =>
                  current
                    ? {
                        ...current,
                        entries: [...current.entries.filter((item) => item.id !== entry.id), entry],
                      }
                    : current,
                );
                setCreating(false);
                setSelected(entry.id);
              }}
            />
          ) : record ? (
            <section aria-label="Workflow status">
              <h2>{record.name}</h2>
              <div className="workflow-actions" aria-live="polite">
                <strong>{statusLabel(state?.status ?? record.state)}</strong>
                <span>
                  {state?.accepted.length ?? 0} of {record.definition.tasks.length} tasks accepted
                </span>
                <span>
                  Last verified:{" "}
                  {record.updatedAt ? new Date(record.updatedAt).toLocaleString() : "Unavailable"}
                </span>
              </div>
              <progress
                aria-label="Tasks accepted"
                max={record.definition.tasks.length}
                value={state?.accepted.length ?? 0}
              />
              {detail.error && <p role="status">{detail.error}</p>}
              <dl>
                <dt>Repository</dt>
                <dd>{record.repository}</dd>
                <dt>Execution worktree</dt>
                <dd>{record.worktree}</dd>
                <dt>Permission approvals</dt>
                <dd>{record.definition.autoApprove ? "Automatic" : "Ask"}</dd>
              </dl>
              <div className="workflow-actions">
                <button
                  type="button"
                  disabled={!!busy || list?.supported === false}
                  onClick={() =>
                    void act("Connecting…", async () => {
                      await api.workflow({ action: "reconnect" });
                    })
                  }
                >
                  Start engine / reconnect
                </button>
                {!state && ["starting", "uncertain"].includes(record.state) && (
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() =>
                      void act("Recovering…", async () => {
                        await api.workflow({ action: "recover", id: record.id });
                      })
                    }
                  >
                    Recover same start request
                  </button>
                )}
                <button
                  type="button"
                  disabled={!!busy || !!terminal || !connected}
                  onClick={() =>
                    void act("Cancelling…", async () => {
                      await api.workflow({ action: "cancel", id: record.id });
                    })
                  }
                >
                  {busy === "Cancelling…" ? busy : "Cancel workflow"}
                </button>
              </div>
              <details>
                <summary>Engine recovery</summary>
                <p>
                  Starting the engine can resume unfinished approved workflows. No login service is
                  installed. Transmission staging.18 can exceed its retry allowance across engine
                  restarts.
                </p>
              </details>
              <ol className="workflow-task-list">
                {record.definition.tasks.map((item, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: Approved task indices are immutable and names may repeat.
                  <li key={`${record.id}-${index}`}>
                    <button
                      type="button"
                      aria-pressed={task === index}
                      onClick={() => setTask(index)}
                    >
                      {item.name}
                    </button>
                    <span>{statusLabel(state?.tasks[index]?.state ?? "Unconfirmed")}</span>
                  </li>
                ))}
              </ol>
              {selectedTask && (
                <section aria-label="Task details">
                  <h3>{selectedTask.name}</h3>
                  <dl>
                    <dt>Instructions</dt>
                    <dd>
                      <pre>{selectedTask.instructions}</pre>
                    </dd>
                    <dt>Verification criteria</dt>
                    <dd>
                      <pre>{selectedTask.verify}</pre>
                    </dd>
                    <dt>Checks</dt>
                    <dd>
                      <pre>{selectedTask.checks?.join("\n") || "No explicit commands"}</pre>
                    </dd>
                  </dl>
                  {state?.accepted[task] && (
                    <>
                      <h3>Verifier evidence</h3>
                      <p>{state.accepted[task].verdict.reason}</p>
                      <ul>
                        {state.accepted[task].verdict.checks?.map((check, index) => (
                          // biome-ignore lint/suspicious/noArrayIndexKey: Check evidence is immutable and duplicate commands are allowed.
                          <li key={`${record.id}-check-${index}`}>
                            <code>{check.command}</code>: {check.passed ? "Passed" : "Failed"}
                            <pre>{check.evidence}</pre>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </section>
              )}
              {state?.reason && <p role="status">{state.reason}</p>}
              {!!state?.attempts.length && (
                <details>
                  <summary>Repair and retry feedback</summary>
                  <ol>
                    {state.attempts.map((attempt, index) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: Attempts are append-only and feedback text may repeat.
                      <li key={`${record.id}-attempt-${index}`}>{attempt}</li>
                    ))}
                  </ol>
                </details>
              )}
              {state?.decision && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void act("Answering…", async () => {
                      await api.workflow({
                        action: "answer",
                        id: record.id,
                        questionId: state.decision?.id ?? "",
                        answer,
                      });
                    });
                  }}
                >
                  <label htmlFor={`workflow-question-${record.id}`}>{state.decision.text}</label>
                  {state.decision.options ? (
                    <select
                      id={`workflow-question-${record.id}`}
                      value={answer}
                      onChange={(event) => setAnswer(event.target.value)}
                    >
                      <option value="">Choose an answer</option>
                      {state.decision.options.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <textarea
                      id={`workflow-question-${record.id}`}
                      value={answer}
                      maxLength={65_536}
                      onChange={(event) => setAnswer(event.target.value)}
                    />
                  )}
                  <button type="submit" disabled={!!busy || !connected || !answer.trim()}>
                    Send answer
                  </button>
                </form>
              )}
              {!terminal && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void act("Sending guidance…", async () => {
                      await api.workflow({ action: "message", id: record.id, message });
                      setMessage("");
                    });
                  }}
                >
                  <label>
                    Guidance for a subsequent turn
                    <textarea
                      value={message}
                      maxLength={65_536}
                      onChange={(event) => setMessage(event.target.value)}
                    />
                  </label>
                  <button type="submit" disabled={!!busy || !connected || !message.trim()}>
                    Queue guidance
                  </button>
                </form>
              )}
              <details>
                <summary>Activity</summary>
                {activityTrimmed && (
                  <p role="status">
                    Older activity is outside the display limit. Reselect this workflow to read from
                    the beginning.
                  </p>
                )}
                <button
                  type="button"
                  disabled={!!busy || !connected}
                  onClick={() =>
                    void act("Loading activity…", async () => {
                      const own = record.id;
                      const result = (await api.workflow({
                        action: "events",
                        id: own,
                        after: cursor,
                      })) as { events: WorkflowEvent[] };
                      const retained = retainWorkflowActivity(events, result.events);
                      setEvents(retained.events);
                      setActivityTrimmed((previous) => previous || retained.trimmed);
                      setCursor(result.events.at(-1)?.sequence ?? cursor);
                    })
                  }
                >
                  Load more activity
                </button>
                <ol>
                  {events.map((event) => (
                    <li key={event.sequence}>
                      <time>{event.time}</time> {event.kind}
                      <pre>{JSON.stringify(event.detail, null, 2)}</pre>
                    </li>
                  ))}
                </ol>
              </details>
              <details>
                <summary>Accepted diff</summary>
                <button
                  type="button"
                  disabled={!!busy || !connected || offset === null}
                  onClick={() =>
                    void act("Loading diff…", async () => {
                      const page = (await api.workflow({
                        action: "diff",
                        id: record.id,
                        offset: offset ?? 0,
                      })) as Diff;
                      if (patchRevision && page.revision !== patchRevision) {
                        setDiff("");
                        setOffset(0);
                        setPatchRevision(undefined);
                        patchDecoder.current = new TextDecoder("utf-8", { fatal: true });
                        throw new Error("Accepted revision changed. Read the diff again.");
                      }
                      if (diff.length > 2_000_000)
                        throw new Error(
                          "Diff display limit reached. Inspect the retained worktree for the full patch.",
                        );
                      setDiff(
                        (current) =>
                          current +
                          patchDecoder.current.decode(
                            Uint8Array.from(atob(page.content), (c) => c.charCodeAt(0)),
                            { stream: page.nextOffset !== null },
                          ),
                      );
                      setOffset(page.nextOffset);
                      setPatchRevision(page.revision);
                    })
                  }
                >
                  Load accepted diff
                </button>
                <pre>{diff}</pre>
              </details>
            </section>
          ) : (
            <p>No workflow selected</p>
          )}
        </div>
      </div>
    </section>
  );
}
