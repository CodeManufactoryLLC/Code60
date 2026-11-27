import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ApplicationClient, DesktopRun } from "../bridge/index.js";
import type { RunEvent } from "../core/index.js";
import { ActivityLoading } from "./carbon/activity-loading.js";
import { Button } from "./carbon/button.js";
import { Surface as Card } from "./carbon/surfaces.js";
import { useChatDraft } from "./chat-draft.js";
import { ChatMessage } from "./chat-message.js";
import { chatFailureReason, sessionStatus, turnTimings } from "./chat-presentation.js";
import { useChatScroll, whenChatEventAppears } from "./chat-scroll.js";
import type { OpenChat } from "./chats.js";
import { ChatTurn, EmbeddedChat } from "./embedded-chat.js";
import { Icon } from "./icons.js";
import { TurnTimer } from "./message-controls.js";
import { PageTitle } from "./page-title.js";
import { PendingApprovals } from "./pending-approvals.js";
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
  hidden = !active,
  selectionPending = false,
  request,
  loading,
  historyError,
  onRetry,
  onCopied,
  notice,
}: {
  api: ApplicationClient;
  run: DesktopRun;
  /** Defaults to the provider and short run ID. */
  label?: string;
  orchestrated: boolean;
  events: readonly RunEvent[];
  active: boolean;
  hidden?: boolean;
  selectionPending?: boolean;
  request: OpenChat | undefined;
  loading: boolean;
  historyError: string | undefined;
  onRetry(): void;
  onCopied?: (() => void) | undefined;
  notice?: ReactNode;
}) {
  const id = run.record.id;
  const titleId = useId();
  const draftKey = `code60.workerDraft:${id}`;
  const draftState = useChatDraft(draftKey);
  const { draft } = draftState;
  const { error, busy, act } = useWorkerActions(api, id);
  const [visible, setVisible] = useState(300);
  const { onViewport, pause, resume } = useChatScroll(active, id);
  const frame = useRef<HTMLDivElement>(null);
  const matched = useRef<number | undefined>(undefined);
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
    (["failed", "timed_out", "interrupted"].includes(status)
      ? chatFailureReason(status, run.record.reason)
      : "");
  const target = request?.id === id ? request : undefined;

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
    return whenChatEventAppears(frame.current, target.eventIndex, (element) => {
      const activity = element.closest("details");
      if (activity) activity.open = true;
      pause();
      element.scrollIntoView({ block: "center" });
      element.focus({ preventScroll: true });
      matched.current = target.serial;
    });
  }, [target, active, loading, blocks, visible, pause]);
  async function send(text: string) {
    if (!sendable || busy || !text.trim()) return false;
    const sent = draftState.sent();
    if (sent.text.trim() === text) text = sent.text;
    if (await act({ type: resumable ? "continue" : "reply", id, text })) {
      draftState.clear(sent);
      resume();
      return true;
    }
    return false;
  }
  const promptControls = (
    <SessionInfo
      harness={run.record.agent}
      state={run.view?.sessionState ?? run.record.sessionState}
      sessionId={id}
      active={active}
      ended={ended}
      editable={!inactive && editable && !busy}
      changing={!!run.view?.modeChanging}
      onSaveDefault={
        inactive
          ? undefined
          : () => {
              void act({ type: "save-model-default", id });
            }
      }
      onMode={(change) => {
        void act({ type: "set-mode", id, change });
      }}
    />
  );
  const footer = inactive ? (
    <Card className="composer composer-inactive" role="status">
      <p>Agent is inactive. Its worktree was deleted.</p>
      {promptControls}
    </Card>
  ) : (
    <Card as="section" className="composer" aria-label="Worker composer">
      {blocker && (
        <span className="chat-progress" role="status">
          {blocker}
        </span>
      )}
    </Card>
  );
  return (
    <main
      className="orchestration-chat-page worker-chat-page"
      id={`chat-${id}`}
      aria-labelledby={titleId}
      hidden={hidden}
      inert={selectionPending}
      data-navigation-pending={selectionPending || undefined}
      aria-busy={selectionPending || undefined}
    >
      <header className="orchestration-chat-heading worker-chat-heading">
        <div className="worker-chat-identity">
          <PageTitle
            page="worker"
            as="h2"
            className="worker-chat-title"
            id={titleId}
            target={{ kind: "conversation", id }}
          >
            {label ?? `${run.record.agent} / ${id.slice(-6)}`}
          </PageTitle>
          <div className="status-label worker-chat-subtitle" data-status={status}>
            {active && !run.view?.stopping && (working || status === "queued") && (
              <ActivityLoading />
            )}
            {run.view?.stopping
              ? "Stopping agent…"
              : busy && resumable
                ? "Resuming session…"
                : presentation.label}
          </div>
        </div>
        {orchestrated && (
          <span className="status-label chat-worker-label" title="Dispatched by an orchestrator.">
            Orchestrator worker
          </span>
        )}
      </header>
      {notice}
      {run.relay && (
        <p role="status">
          {run.relay.cwd} ({run.relay.workspaceMode}).
          {run.relay.workspaceMode === "direct"
            ? " Undo in Relay also rewinds manual edits since the checkpoint."
            : ""}{" "}
          Showing a bounded live transcript; original source remains on disk.
          {run.historyIncomplete ? " Earlier activity is omitted from this view." : ""}
        </p>
      )}
      {failure && (
        <div className="error-banner" role="alert">
          {failure}
          {historyError && (
            <Button type="button" onClick={onRetry}>
              Retry reads
            </Button>
          )}
        </div>
      )}
      {run.record.branch === null && (
        <div className="warning-banner">
          This agent works directly in your folder. Changes are not isolated; diff and discard are
          unavailable.
        </div>
      )}
      <div className="orchestration-chat-body" ref={frame}>
        <EmbeddedChat
          footer={footer}
          promptControls={inactive ? undefined : promptControls}
          active={active}
          label="Message"
          draft={draft}
          onEdit={draftState.edit}
          onSend={send}
          canSend={sendable && !busy}
          disabled={!sendable || busy}
          hideInput={inactive}
          stop={
            working && run.view && !run.view.stopping && !busy
              ? () => act({ type: "cancel", id })
              : undefined
          }
          focus={target?.compose ? target.serial : undefined}
          onViewport={onViewport}
        >
          {loading && !blocks.length && <p className="muted">Loading…</p>}
          {blocks.length > visible && (
            <Button
              variant="quiet"
              type="button"
              onClick={() => {
                pause();
                setVisible((n) => n + 300);
              }}
            >
              Show earlier activity
            </Button>
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
              block.automatic || ["thought", "toolCall", "permission", "note"].includes(block.type);
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
              <ChatTurn
                key={block.key}
                at={events[Number(block.key)]?.at}
                from={block.type === "prompt" && !block.automatic ? "user" : "assistant"}
              >
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
              </ChatTurn>
            );
          })}

          {runPending.length > 0 && (
            <PendingApprovals
              requests={runPending}
              onAnswer={(id, answer) => api.action({ type: "permission", id, answer })}
            />
          )}
        </EmbeddedChat>
      </div>
    </main>
  );
}
