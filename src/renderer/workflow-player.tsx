import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  type DesktopApi,
  TRANSMISSION_VERSION,
  type WorkflowEvent,
  type WorkflowRecord,
  type WorkflowRequest,
} from "../bridge/index.js";
import { DialogContent } from "./neobrutalism/dialog.js";
import {
  type emptyWorkflowClock,
  workflowActivityRows,
  workflowTime,
} from "./workflow-activity.js";

export const statusLabel = (value: string) =>
  ({
    message: "Guidance queued",
    task_accepted: "Task accepted",
    pause_requested: "Pause requested",
    preparing: "Preparing worktree",
    preparation_failed: "Preparation failed",
    uncertain: "Start unconfirmed",
    needs_input: "Needs input",
  })[value] ?? value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " ");

type Activity = { events: WorkflowEvent[]; trimmed: boolean; clock: typeof emptyWorkflowClock };
type Modal = { kind: "configuration" | "results"; task: number } | { kind: "stop" | "steer" };
type DiffPage = { content: string; nextOffset: number | null; revision?: string };

function eventDescription(event: WorkflowEvent) {
  const { detail } = event;
  if (detail.incomplete === true && typeof detail.excerpt === "string")
    return `${detail.excerpt} [excerpt]`;
  for (const field of [
    "reason",
    "summary",
    "message",
    "text",
    "result",
    "task",
    "detail",
    "answer",
  ]) {
    if (typeof detail[field] === "string") return detail[field];
  }
  return Object.keys(detail).length ? JSON.stringify(detail, null, 2) : "";
}

function ActivityStream({ events, trimmed }: Activity) {
  const [expanded, setExpanded] = useState(false);
  const logId = useId();
  const log = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ sequence: string; offset: number } | null>(null);
  function remember() {
    const element = log.current;
    if (!element || element.scrollTop < 2) {
      anchor.current = null;
      return;
    }
    const top = element.getBoundingClientRect().top;
    const first = Array.from(element.querySelectorAll<HTMLElement>("[data-sequence]")).find(
      (row) => row.getBoundingClientRect().bottom > top,
    );
    anchor.current = first?.dataset.sequence
      ? { sequence: first.dataset.sequence, offset: first.getBoundingClientRect().top - top }
      : null;
  }
  // Keep the same event at the same offset while new rows arrive above the reader.
  useLayoutEffect(() => {
    const element = log.current;
    const saved = anchor.current;
    if (!element || !events.length) return;
    if (!saved) {
      element.scrollTop = 0;
      return;
    }
    const row = element.querySelector<HTMLElement>(`[data-sequence="${saved.sequence}"]`);
    if (row)
      element.scrollTop +=
        row.getBoundingClientRect().top - element.getBoundingClientRect().top - saved.offset;
  }, [events]);
  return (
    <section className="workflow-activity-box">
      <div className="workflow-activity-heading">
        <h3>Activity</h3>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={logId}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Collapse tool calls" : "Expand tool calls"}
        </button>
      </div>
      <div
        className="workflow-live-log"
        id={logId}
        role="log"
        aria-label="Workflow activity"
        aria-live="polite"
        aria-relevant="additions"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: The scrollable log needs independent keyboard scrolling.
        tabIndex={0}
        ref={log}
        onScroll={remember}
      >
        <ol>
          {workflowActivityRows(events, expanded).map(({ event, firstSequence, toolUpdates }) => (
            <li key={firstSequence} data-sequence={firstSequence}>
              <time dateTime={event.time}>
                {Number.isFinite(Date.parse(event.time))
                  ? new Date(event.time).toLocaleTimeString()
                  : event.time}
              </time>
              <strong>
                {toolUpdates
                  ? toolUpdates === 1
                    ? "Tool call"
                    : `${toolUpdates} tool updates`
                  : statusLabel(event.kind)}
              </strong>
              {!toolUpdates && Object.keys(event.detail).length > 0 && (
                <pre>{eventDescription(event)}</pre>
              )}
            </li>
          ))}
        </ol>
        {!events.length && <p>No recorded activity</p>}
        {trimmed && <p>Older events are outside the display limit.</p>}
      </div>
    </section>
  );
}

function MetricClock({
  clock,
  record,
  live,
}: {
  clock: Activity["clock"];
  record: WorkflowRecord;
  live: boolean;
}) {
  const [now, setNow] = useState(Date.now);
  const ticking = live && clock.since !== null;
  useEffect(() => {
    if (!ticking) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const sync = () => {
      clearInterval(timer);
      if (!document.hidden) {
        setNow(Date.now());
        timer = setInterval(() => setNow(Date.now()), 1000);
      }
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [ticking]);
  const verified = Date.parse(record.updatedAt ?? "");
  const text = workflowTime(
    clock,
    record.snapshot?.eventCursor,
    ticking ? Math.max(now, verified) : verified,
  );
  return (
    <div className="workflow-metric">
      <span role="timer" aria-live="off" aria-label="Execution Time">
        {text}
      </span>
      <span>Execution Time</span>
    </div>
  );
}

function Progress({ accepted, total }: { accepted: number | undefined; total: number }) {
  const percent = accepted === undefined ? undefined : Math.round((100 * accepted) / total);
  return (
    <div className="workflow-metric">
      <div
        className="workflow-donut"
        role="img"
        aria-label={
          percent === undefined
            ? "Progress unconfirmed"
            : `${percent}% complete, ${accepted} of ${total} tasks accepted`
        }
      >
        <svg viewBox="0 0 140 140" aria-hidden="true">
          <circle cx="70" cy="70" r="62" className="donut-base" />
          <circle
            cx="70"
            cy="70"
            r="52"
            fill="none"
            stroke="var(--primary)"
            strokeWidth="20"
            pathLength="100"
            strokeDasharray={`${percent ?? 0} 100`}
            transform="rotate(-90 70 70)"
          />
          <circle cx="70" cy="70" r="42" className="donut-center" />
        </svg>
        <div aria-hidden="true">
          <strong>{percent === undefined ? "—" : `${percent}%`}</strong>
          <small>
            {accepted ?? "—"} of {total}
          </small>
        </div>
      </div>
      <span>Progress</span>
    </div>
  );
}

const transportIcons = {
  play: <path d="M6 3 21 12 6 21Z" />,
  pause: <path d="M5 3h5v18H5zm9 0h5v18h-5z" />,
  stop: <path d="M4 4h16v16H4z" />,
  steer: (
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9.5" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="m3.5 8 6.5 3m4 0 6.5-3M12 14.5v7" />
    </g>
  ),
};
function Transport({
  icon,
  label,
  disabled,
  reason,
  onClick,
}: {
  icon: keyof typeof transportIcons;
  label: string;
  disabled: boolean;
  reason?: string | undefined;
  onClick(): void;
}) {
  return (
    <button
      className="workflow-transport"
      data-icon={icon}
      type="button"
      disabled={disabled}
      title={reason ?? label}
      aria-label={label}
      aria-haspopup={icon === "stop" || icon === "steer" ? "dialog" : undefined}
      onClick={onClick}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        {transportIcons[icon]}
      </svg>
    </button>
  );
}

function WorkflowDialog({
  title,
  task,
  children,
  footer,
  close,
}: {
  title: string;
  task?: string | undefined;
  children: ReactNode;
  footer?: ReactNode;
  close(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    return () => element.close();
  }, []);
  return (
    <DialogContent
      className={task ? "workflow-task-modal" : "workflow-control-modal"}
      ref={dialog}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header>
        <h2>{title}</h2>
        {task && <p>{task}</p>}
      </header>
      <div className="workflow-modal-body">{children}</div>
      <footer>
        {footer ?? (
          <button type="button" onClick={close}>
            Close
          </button>
        )}
      </footer>
    </DialogContent>
  );
}

function AcceptedDiff({
  api,
  record,
  connected,
}: {
  api: DesktopApi;
  record: WorkflowRecord;
  connected: boolean;
}) {
  const [diff, setDiff] = useState("");
  const [offset, setOffset] = useState<number | null>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const revision = useRef<string | undefined>(undefined);
  const decoder = useRef(new TextDecoder("utf-8", { fatal: true }));
  const load = async () => {
    if (busy || offset === null) return;
    setBusy(true);
    setError("");
    try {
      const page = (await api.workflow({ action: "diff", id: record.id, offset })) as DiffPage;
      if (revision.current && revision.current !== page.revision) {
        setDiff("");
        setOffset(0);
        revision.current = undefined;
        decoder.current = new TextDecoder("utf-8", { fatal: true });
        throw new Error("Accepted revision changed. Read the diff again.");
      }
      if (diff.length + page.content.length * 0.75 > 2_000_000)
        throw new Error(
          "Diff display limit reached. Inspect the retained worktree for the full patch.",
        );
      const chunk = decoder.current.decode(
        Uint8Array.from(atob(page.content), (c) => c.charCodeAt(0)),
        { stream: page.nextOffset !== null },
      );
      setDiff((previous) => previous + chunk);
      revision.current = page.revision;
      setOffset(page.nextOffset);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Diff unavailable");
    } finally {
      setBusy(false);
    }
  };
  return (
    <details>
      <summary>Accepted diff</summary>
      <button
        type="button"
        disabled={!connected || busy || offset === null}
        onClick={() => void load()}
      >
        Load accepted diff
      </button>
      {error && <p role="alert">{error}</p>}
      <pre>{diff}</pre>
    </details>
  );
}

export function WorkflowPlayer({
  api,
  record,
  active,
  polling,
  connected,
  problem,
  actionError,
  activity,
  busy,
  act,
}: {
  api: DesktopApi;
  record: WorkflowRecord;
  active: boolean;
  polling: boolean;
  connected: boolean;
  problem: string | undefined;
  actionError: string;
  activity: Activity;
  busy: string;
  act(request: WorkflowRequest): Promise<boolean>;
}) {
  const [modal, setModal] = useState<Modal | null>(null);
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState({ questionId: "", text: "" });
  const snapshot = record.snapshot;
  const decision = snapshot?.decision;
  const status = snapshot?.status;
  const terminal = status === "completed" || status === "failed" || status === "cancelled";
  const controllable = connected && !terminal && !!snapshot && !busy && !record.stopPending;
  const canStop = connected && !!snapshot && !busy && (!terminal || !!record.stopPending);
  const modern = record.engineVersion === TRANSMISSION_VERSION;
  const legacyReason = modern ? undefined : "Pause and resume require Transmission staging.20";
  const command = (action: "pause" | "resume" | "cancel" | "recover") =>
    act({ action, id: record.id });
  useEffect(() => {
    if (!active) setModal(null);
  }, [active]);
  const answer = reply.questionId === decision?.id ? reply.text : "";
  const index = modal && "task" in modal ? modal.task : -1;
  const task = record.definition.tasks[index];
  const verdictFor = (taskIndex: number) =>
    snapshot?.accepted[taskIndex]?.verdict ??
    (activity.clock.accepted === taskIndex && activity.clock.cursor === snapshot?.eventCursor
      ? activity.clock.verdict
      : null);
  const evidence = verdictFor(index);
  const close = () => setModal(null);
  return (
    <section aria-label="Workflow status">
      {actionError && modal?.kind !== "steer" && <p role="alert">{actionError}</p>}
      {problem && (
        <p role="status">
          {problem}{" "}
          {record.updatedAt && <>Last verified {new Date(record.updatedAt).toLocaleString()}.</>}
        </p>
      )}
      {!snapshot && ["starting", "uncertain"].includes(record.state) && (
        <button type="button" disabled={!!busy} onClick={() => void command("recover")}>
          Recover same start request
        </button>
      )}
      <section className="workflow-player">
        <h2>“{record.name}”</h2>
        <div className="workflow-player-panels">
          <div className="workflow-player-left">
            <div className="workflow-transport-row">
              <Transport
                icon="play"
                label="Resume workflow"
                reason={legacyReason}
                disabled={!controllable || !modern || status !== "paused"}
                onClick={() => void command("resume")}
              />
              <Transport
                icon="pause"
                label="Pause workflow"
                reason={legacyReason}
                disabled={
                  !controllable || !modern || (status !== "running" && status !== "needs_input")
                }
                onClick={() => void command("pause")}
              />
              <Transport
                icon="stop"
                label="Stop workflow"
                disabled={!canStop}
                onClick={() => setModal({ kind: "stop" })}
              />
              <Transport
                icon="steer"
                label="Steer"
                disabled={!controllable || status === "pausing"}
                onClick={() => setModal({ kind: "steer" })}
              />
            </div>
            <MetricClock
              clock={activity.clock}
              record={record}
              live={active && polling && connected && !terminal}
            />
            <Progress accepted={snapshot?.accepted.length} total={record.definition.tasks.length} />
          </div>
          <ActivityStream {...activity} />
        </div>
        {(!snapshot || terminal || record.stopPending || busy === "cancel" || busy === "pause") && (
          <p role="status">
            {busy === "cancel"
              ? "Stopping workflow…"
              : record.stopPending
                ? "Stop acknowledgement pending. Use Stop workflow to retry."
                : busy === "pause"
                  ? "Pausing…"
                  : statusLabel(status ?? record.state)}
          </p>
        )}
        <ol className="workflow-task-list">
          {record.definition.tasks.map((item, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: Approved task order is immutable.
            <li key={i}>
              <details data-current={snapshot?.activeTaskIndex === i}>
                <summary>
                  <b>{i + 1}</b>
                  <strong>{item.name}</strong>
                  <span>{statusLabel(snapshot?.tasks[i]?.state ?? "Unconfirmed")}</span>
                </summary>
                <div>
                  <button
                    type="button"
                    onClick={() => setModal({ kind: "configuration", task: i })}
                  >
                    View Configuration
                  </button>
                  {verdictFor(i) && (
                    <button type="button" onClick={() => setModal({ kind: "results", task: i })}>
                      View Results
                    </button>
                  )}
                </div>
              </details>
            </li>
          ))}
        </ol>
      </section>
      {decision && (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            await act({ action: "answer", id: record.id, questionId: decision.id, answer });
          }}
        >
          <label htmlFor={decision.id}>{decision.text}</label>
          {decision.options ? (
            <select
              id={decision.id}
              value={answer}
              onChange={(e) => setReply({ questionId: decision.id, text: e.target.value })}
            >
              <option value="">Choose an answer</option>
              {decision.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          ) : (
            <textarea
              id={decision.id}
              maxLength={65536}
              value={answer}
              onChange={(e) => setReply({ questionId: decision.id, text: e.target.value })}
            />
          )}
          <button type="submit" disabled={!controllable || !answer.trim()}>
            Send answer
          </button>
        </form>
      )}
      {snapshot?.reason && <p role="status">{snapshot.reason}</p>}
      {!!snapshot?.attempts.length && (
        <details>
          <summary>Repair and retry feedback</summary>
          <pre>{snapshot.attempts.join("\n\n")}</pre>
        </details>
      )}
      <details>
        <summary>Workflow details</summary>
        <dl>
          <dt>Repository</dt>
          <dd>{record.repository}</dd>
          <dt>Execution worktree</dt>
          <dd>{record.worktree}</dd>
          <dt>Permission approvals</dt>
          <dd>{record.definition.autoApprove ? "Automatic" : "Ask"}</dd>
        </dl>
      </details>
      <AcceptedDiff api={api} record={record} connected={connected} />
      {active && modal?.kind === "configuration" && task && (
        <WorkflowDialog title={`Task ${index + 1} configuration`} task={task.name} close={close}>
          <h3>Instructions</h3>
          <pre>{task.instructions}</pre>
          <h3>Verification Criteria</h3>
          <pre>{task.verify}</pre>
          <h3>Checks</h3>
          <pre>{task.checks.join("\n") || "No explicit commands"}</pre>
        </WorkflowDialog>
      )}
      {active && modal?.kind === "results" && task && evidence && (
        <WorkflowDialog title={`Task ${index + 1} results`} task={task.name} close={close}>
          <h3>Verifier verdict</h3>
          <strong>{evidence.decision === "accept" ? "Accepted" : "Rejected"}</strong>
          <p>{evidence.reason}</p>
          <h3>Reported checks</h3>
          {evidence.checks?.length ? (
            evidence.checks.map((c, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: Immutable, ordered evidence may repeat.
              <section key={i}>
                <code>{c.command}</code>
                <p>{c.passed ? "Passed" : "Failed"}</p>
                <pre>{c.evidence}</pre>
              </section>
            ))
          ) : (
            <p>No checks reported</p>
          )}
        </WorkflowDialog>
      )}
      {active && modal?.kind === "stop" && (
        <WorkflowDialog
          title="Stop workflow?"
          close={close}
          footer={
            <>
              <button type="button" onClick={close}>
                Cancel
              </button>
              <button
                type="button"
                disabled={!canStop}
                onClick={() => {
                  close();
                  void command("cancel");
                }}
              >
                Stop workflow
              </button>
            </>
          }
        >
          <p>
            Warning: this workflow cannot be resumed if stopped. Any existing changes will remain
            in-place.{modern ? " 'Pause' instead if you wish to resume at a later time." : ""}
          </p>
        </WorkflowDialog>
      )}
      {active && modal?.kind === "steer" && (
        <WorkflowDialog
          title="Steer workflow"
          close={close}
          footer={
            <>
              <button type="button" onClick={close}>
                Cancel
              </button>
              <button
                type="submit"
                form="workflow-steer"
                disabled={!controllable || !message.trim()}
              >
                Queue guidance
              </button>
            </>
          }
        >
          <form
            id="workflow-steer"
            onSubmit={async (event) => {
              event.preventDefault();
              if (await act({ action: "message", id: record.id, message })) {
                setMessage("");
                close();
              }
            }}
          >
            {actionError && <p role="alert">{actionError}</p>}
            <label>
              Guidance for a subsequent turn
              <textarea
                value={message}
                maxLength={65536}
                onChange={(e) => setMessage(e.target.value)}
              />
            </label>
          </form>
        </WorkflowDialog>
      )}
    </section>
  );
}
