import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import type { DesktopApi, DesktopRun } from "../bridge/index.js";
import type { RunEvent } from "../core/index.js";
import { useChatDraft } from "./chat-draft.js";
import { ChatMessage } from "./chat-message.js";
import { sessionStatus, turnTimings } from "./chat-presentation.js";
import type { OpenChat } from "./chats.js";
import { Icon } from "./icons.js";
import { TurnTimer } from "./message-controls.js";
import { continueBlocker } from "./recovery.js";
import { SessionInfo } from "./session-info.js";
import { statusSpec } from "./session-presentation.js";
import { transcript } from "./transcript.js";
import { useWorkerActions } from "./worker-actions.js";

const endedStatuses = new Set(["finished", "failed", "cancelled", "timed_out", "interrupted"]);

export function WorkerChat({
  api,
  run,
  label,
  orchestrated,
  events,
  active,
  request,
  loading,
  historyError,
  onRetry,
  onCopied,
}: {
  api: DesktopApi;
  run: DesktopRun;
  /** Defaults to the provider and short run ID. */
  label?: string;
  orchestrated: boolean;
  events: readonly RunEvent[];
  active: boolean;
  request: OpenChat | undefined;
  loading: boolean;
  historyError: string | undefined;
  onRetry(): void;
  onCopied?: (() => void) | undefined;
}) {
  const id = run.record.id;
  const titleId = useId();
  const replyId = useId();
  const draftKey = `code60.workerDraft:${id}`;
  const draftState = useChatDraft(draftKey);
  const { draft } = draftState;
  const { error, busy, act } = useWorkerActions(api, id);
  const [visible, setVisible] = useState(300);
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const savedScroll = useRef(0);
  const geometry = useRef({ width: 0, height: 0 });
  const composer = useRef<HTMLTextAreaElement>(null);
  const matched = useRef<number | undefined>(undefined);
  const composed = useRef<number | undefined>(undefined);
  const status = run.view?.status ?? run.record.status;
  const ended = endedStatuses.has(status);
  const blocker = run.relay
    ? ended
      ? "This Relay worker has ended. Ask Relay to dispatch a new worker explicitly."
      : undefined
    : run.record.base === null
      ? "No baseline was captured for this run. Start a new isolated worker after setting up Git."
      : ended
        ? continueBlocker(run)
        : undefined;
  const inactive = ended && run.record.discardedAt !== undefined;
  const editable = run.view?.status === "idle" && !run.view.stopping && !run.view.modeChanging;
  const resumable = ended && blocker === undefined;
  const sendable = !blocker && (editable || resumable);
  const working = ["running", "waiting"].includes(status);
  const blocks = useMemo(() => transcript(events), [events]);
  const timings = useMemo(() => turnTimings(events, status), [events, status]);
  const presentation = run.view ? sessionStatus(run.view) : statusSpec[status];
  const runPending = run.view?.pending ?? [];
  const failure =
    error ||
    draftState.storageError ||
    historyError ||
    (["failed", "timed_out", "interrupted"].includes(status) ? run.record.reason : "");
  const target = request?.id === id ? request : undefined;

  useEffect(() => {
    if (!target?.compose || composed.current === target.serial || !active) return;
    composed.current = target.serial;
    composer.current?.focus({ preventScroll: true });
  }, [target, active]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: streaming blocks and history change the scroll height.
  useEffect(() => {
    const element = scroll.current;
    if (!active || !element) return;
    element.scrollTop = follow.current ? element.scrollHeight : savedScroll.current;
    geometry.current = { width: element.clientWidth, height: element.clientHeight };
  }, [blocks, active, visible]);
  useEffect(() => {
    const element = scroll.current;
    if (!active || !element) return;
    const observer = new ResizeObserver(() => {
      if (follow.current) element.scrollTop = element.scrollHeight;
      geometry.current = { width: element.clientWidth, height: element.clientHeight };
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [active]);
  useEffect(() => {
    if (
      !target ||
      target.eventIndex === undefined ||
      matched.current === target.serial ||
      !active ||
      loading ||
      !blocks.length
    )
      return;
    const blockIndex = blocks.findIndex((block) => block.key === String(target.eventIndex));
    if (blockIndex < 0) return;
    if (blocks.length - blockIndex > visible) {
      setVisible(blocks.length - blockIndex);
      return;
    }
    const element = scroll.current?.querySelector<HTMLElement>(
      `[data-event-index="${target.eventIndex}"]`,
    );
    if (!element) return;
    const activity = element.closest("details");
    if (activity) activity.open = true;
    follow.current = false;
    element.scrollIntoView({ block: "center" });
    savedScroll.current = scroll.current?.scrollTop ?? 0;
    element.focus({ preventScroll: true });
    matched.current = target.serial;
  }, [target, active, loading, blocks, visible]);
  async function send() {
    if (!sendable || busy || !draft.trim()) return;
    const sent = draftState.sent();
    const text = sent.text;
    if (await act({ type: resumable ? "continue" : "reply", id, text })) {
      draftState.clear(sent);
      follow.current = true;
    }
  }
  return (
    <main
      className="orchestration-chat-page worker-chat-page"
      id={`chat-${id}`}
      aria-labelledby={titleId}
      hidden={!active}
    >
      <header className="orchestration-chat-heading worker-chat-heading">
        <div className="worker-chat-identity">
          <h2 className="worker-chat-title" id={titleId}>
            <span className="chat-role-icon" aria-hidden="true">
              <Icon name="ai-agent" />
            </span>
            {label ?? `${run.record.agent} / ${id.slice(-6)}`}
          </h2>
          <span className="status-label worker-chat-subtitle" data-status={status}>
            {run.view?.stopping
              ? "Stopping agent…"
              : busy && resumable
                ? "Resuming session…"
                : presentation.label}
          </span>
        </div>
        {orchestrated && (
          <span
            className="status-label chat-worker-label"
            title="Dispatched by an orchestrator. Each tool call is allowed once without asking."
          >
            Orchestrator worker
          </span>
        )}
      </header>
      {run.relay && (
        <p role="status">
          {run.relay.cwd} ({run.relay.workspaceMode}).
          {run.relay.workspaceMode === "direct"
            ? " Direct edits have no isolated apply, undo or discard."
            : ""}{" "}
          Showing a bounded live transcript; original source remains on disk.
          {run.historyIncomplete ? " Earlier activity is omitted from this view." : ""}
        </p>
      )}
      {failure && (
        <div className="error-banner" role="alert">
          {failure}
          {historyError && (
            <button type="button" onClick={onRetry}>
              Retry reads
            </button>
          )}
        </div>
      )}
      {run.record.branch === null && (
        <div className="warning-banner">
          This agent works directly in your folder. Changes are not isolated; diff and discard are
          unavailable.
        </div>
      )}
      <div className="orchestration-chat-body">
        <div
          className="transcript"
          ref={scroll}
          role="log"
          aria-label="Worker conversation"
          onScroll={() => {
            const element = scroll.current;
            if (!active || !element) return;
            const resized =
              geometry.current.width !== element.clientWidth ||
              geometry.current.height !== element.clientHeight;
            if (resized && follow.current) element.scrollTop = element.scrollHeight;
            else
              follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
            geometry.current = { width: element.clientWidth, height: element.clientHeight };
            savedScroll.current = element.scrollTop;
          }}
        >
          {loading && !blocks.length ? (
            <p className="muted">Loading…</p>
          ) : (
            <>
              {blocks.length > visible && (
                <button
                  type="button"
                  onClick={() => {
                    follow.current = false;
                    setVisible((n) => n + 300);
                  }}
                >
                  Show earlier activity
                </button>
              )}
              {blocks.length === 0 && (
                <div className="activity-empty">
                  <p>
                    {sendable
                      ? "Send a prompt below to start this agent's first turn."
                      : "Agent activity will appear here."}
                  </p>
                </div>
              )}
              {blocks.slice(-visible).map((block) => {
                const activity =
                  block.automatic ||
                  ["thought", "toolCall", "permission", "note"].includes(block.type);
                const message = (
                  <ChatMessage
                    block={block}
                    openLink={api.openWebLink}
                    at={events[Number(block.key)]?.at}
                    visible={active}
                    onCopied={onCopied}
                    className={target?.eventIndex === Number(block.key) ? "search-match" : ""}
                    eventIndex={block.key}
                    tabIndex={-1}
                    detail={
                      block.detail ? (
                        <details>
                          <summary>Handoff summary</summary>
                          <pre>{block.detail}</pre>
                        </details>
                      ) : undefined
                    }
                  />
                );
                return (
                  <Fragment key={block.key}>
                    {activity ? (
                      <details className="chat-activity">
                        <summary>
                          <Icon name="terminal" />
                          Activity
                        </summary>
                        <div className="chat-activity-content">{message}</div>
                      </details>
                    ) : (
                      message
                    )}
                    {timings.get(block.key) && (
                      <TurnTimer timing={timings.get(block.key)} visible={active} />
                    )}
                  </Fragment>
                );
              })}
            </>
          )}
        </div>
        {runPending.length > 0 && (
          <section className="approvals" aria-label="Pending approvals">
            {runPending.map((permission) => (
              <div className="approval" key={permission.id}>
                <div>
                  <strong>Approval needed / {permission.kind}</strong>
                  <pre>{permission.title}</pre>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void act({ type: "permission", id: permission.id, answer: "deny" })
                  }
                >
                  Deny
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    void act({ type: "permission", id: permission.id, answer: "allow" })
                  }
                >
                  Allow once
                </button>
              </div>
            ))}
          </section>
        )}
        {inactive ? (
          <div className="composer composer-inactive" role="status">
            <p>Agent is inactive. Its worktree was deleted.</p>
            <SessionInfo
              state={run.view?.sessionState ?? run.record.sessionState}
              ended={ended}
              harness={run.record.agent}
              sessionId={id}
              active={active}
              editable={false}
              changing={!!run.view?.modeChanging}
              autoApproval={orchestrated}
              onMode={(change) => {
                void act({ type: "set-mode", id, change });
              }}
            />
          </div>
        ) : (
          <section className="composer" aria-label="Worker composer">
            <label className="sr-only" htmlFor={replyId}>
              Message
            </label>
            <textarea
              id={replyId}
              ref={composer}
              placeholder="Send a message..."
              value={draft}
              disabled={!sendable || busy}
              maxLength={1_000_000}
              onChange={(event) => {
                draftState.edit(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            {blocker && (
              <span className="chat-progress" role="status">
                {blocker}
              </span>
            )}
            <SessionInfo
              harness={run.record.agent}
              sessionId={id}
              active={active}
              state={run.view?.sessionState ?? run.record.sessionState}
              ended={ended}
              editable={editable && !busy}
              changing={!!run.view?.modeChanging}
              autoApproval={orchestrated}
              onMode={(change) => {
                void act({ type: "set-mode", id, change });
              }}
            >
              {working && run.view ? (
                <button
                  type="button"
                  className="composer-send"
                  disabled={busy || run.view.stopping}
                  onClick={() => void act({ type: "cancel", id })}
                >
                  <Icon name="stop" />
                  Stop
                </button>
              ) : (
                <button
                  type="button"
                  className="primary composer-send"
                  disabled={busy || !sendable || !draft.trim()}
                  onClick={() => void send()}
                >
                  Send <Icon name="arrow--up" />
                </button>
              )}
            </SessionInfo>
          </section>
        )}
      </div>
    </main>
  );
}
