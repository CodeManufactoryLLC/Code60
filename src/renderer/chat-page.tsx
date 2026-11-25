import {
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ApplicationClient,
  Command,
  DesktopRun,
  OrchestrationChat,
  ReviewSummary,
} from "../bridge/index.js";
import type { RunEvent } from "../core/index.js";
import { ActivityDisplay } from "./activity-display.js";
import { Button } from "./carbon/button.js";
import { Surface as Card } from "./carbon/surfaces.js";
import { chatDraftKey, useChatDraft } from "./chat-draft.js";
import { ChatMessage } from "./chat-message.js";
import { ChatMessageLayout } from "./chat-message-layout.js";
import { RenameChat } from "./chat-name.js";
import {
  chatFailureReason,
  delegatedActivity,
  isLiveMessage,
  turnTimings,
} from "./chat-presentation.js";
import { useChatScroll, whenChatEventAppears } from "./chat-scroll.js";
import { conversationId, type OpenChat } from "./chats.js";
import { CommandMessage, invokedCommand } from "./command-composer.js";
import { revisionSlot, useConversationRevisions } from "./conversation-revisions.js";
import { ChatTurn, EmbeddedChat } from "./embedded-chat.js";
import { TurnTimer } from "./message-controls.js";
import { useOrchestratorActions } from "./orchestrator-actions.js";
import { PageTitle } from "./page-title.js";
import { PendingApprovals } from "./pending-approvals.js";
import { RelayInputFocus } from "./relay-pulse.js";
import type { ReviewPreview } from "./review-actions.js";
import { SessionExtras, SessionInfo } from "./session-info.js";
import { statusSpec } from "./session-presentation.js";
import { TacticsControl } from "./tactics.js";
import { type Block, transcript } from "./transcript.js";
import { useTransitionTimes } from "./transition-times.js";

function isActivityBlock(block: Block): boolean {
  return (
    block.automatic === true || ["thought", "toolCall", "permission", "note"].includes(block.type)
  );
}

function feedbackAt(review: ReviewSummary, chatId: string | undefined, turn: number) {
  return (
    review.chatId === chatId &&
    review.submissions.some(
      (batch) =>
        (batch.deliveredChatId ?? review.originChatId) === chatId && batch.deliveredTurn === turn,
    )
  );
}

export function ChatPage({
  api,
  chat,
  hidden = false,
  events,
  database,
  project = null,
  active,
  onDatabase,
  runs,
  reviews = [],
  commands = [],
  onReview,
  onRevisionPreview,
  onCopied,
  autoApproval = true,
  notice,
  request,
  selectionPending = false,
}: {
  api: ApplicationClient;
  chat: OrchestrationChat | undefined;
  hidden?: boolean;
  selectionPending?: boolean;
  events: readonly RunEvent[];
  database: string | null;
  project?: string | null;
  active: boolean;
  onDatabase(): void;
  runs: readonly DesktopRun[];
  reviews?: ReviewSummary[];
  commands?: readonly Command[];
  onReview?(id: string): void;
  onRevisionPreview?(preview: ReviewPreview): void;
  onCopied?: (() => void) | undefined;
  autoApproval?: boolean;
  notice?: ReactNode;
  request?: OpenChat | undefined;
}) {
  const reportRelayFocus = useContext(RelayInputFocus);
  const [renaming, setRenaming] = useState(false);
  const id = useId();
  const run = chat?.run;
  const titleTarget = chat && conversationId(chat);
  const relay = chat?.kind === "relay";
  const available = !!database || relay;
  const key = chatDraftKey(chat);
  const currentKey = useRef(key);
  currentKey.current = key;
  const draftState = useChatDraft(key, run?.id, chat?.conversationId);
  const { draft, edit } = draftState;
  const {
    pending,
    error: actionError,
    setError,
    action,
  } = useOrchestratorActions(api, database, key, relay);
  const busy = pending !== null;
  const error = actionError || draftState.storageError;
  const [visible, setVisible] = useState(300);
  const [expandedActivities, setExpandedActivities] = useState<Set<string>>(() => new Set());
  const { activityDetails: detailsDuration } = useTransitionTimes();
  const {
    scroll,
    onViewport,
    pause,
    resume,
    reveal: revealActivity,
  } = useChatScroll(active && !hidden, key);
  const frame = useRef<HTMLDivElement>(null);
  const shown = active && !hidden;
  const revisionFlow = useConversationRevisions({
    api,
    chat,
    reviews,
    runs,
    active: shown,
    onPreview: onRevisionPreview,
  });
  const visibility = useRef({ key, shown, since: Date.now() });
  if (visibility.current.key !== key || visibility.current.shown !== shown)
    visibility.current = { key, shown, since: Date.now() };
  const receivedEvents = useRef({ key, count: events.length });
  if (receivedEvents.current.key !== key) receivedEvents.current = { key, count: events.length };
  useLayoutEffect(() => {
    receivedEvents.current = { key, count: events.length };
  }, [key, events.length]);
  const working = (run?.status === "running" || run?.status === "waiting") && run.turns > 0;
  const connecting = run?.status === "queued" || (run?.status === "running" && run.turns === 0);
  const ready =
    available &&
    chat?.checkpoint?.phase !== "undoing" &&
    !!run &&
    (run.status === "idle" ||
      !!chat?.restored ||
      !["queued", "running", "waiting"].includes(run.status)) &&
    !run.stopping &&
    !run.modeChanging;
  const ended = run && !["queued", "running", "waiting", "idle"].includes(run.status);
  const initialized = Boolean(
    available && run && (run.turns > 0 || run.status === "idle" || chat?.restored || ended),
  );
  const target = request?.id === run?.id ? request : undefined;
  const matched = useRef("");
  const blocks = useMemo(() => transcript(events), [events]);
  const latestRequest = blocks.findLast((block) => block.type === "prompt" && !block.automatic);
  const timings = useMemo(
    () => turnTimings(events, run?.status ?? "interrupted"),
    [events, run?.status],
  );
  const delegated = delegatedActivity(chat?.workers ?? [], runs);
  const items = useMemo(() => {
    const result: { key: string; activity: boolean; blocks: Block[] }[] = [];
    for (const block of blocks.slice(-visible)) {
      const activity = isActivityBlock(block);
      const previous = result.at(-1);
      if (
        activity &&
        previous?.activity &&
        block.type !== "prompt" &&
        !previous.blocks.some((item) => item.type === "prompt")
      )
        previous.blocks.push(block);
      else result.push({ key: block.key, activity, blocks: [block] });
    }
    return result;
  }, [blocks, visible]);
  const revisionSlots = new Map<number, ReactNode[]>();
  for (const card of revisionFlow.cards) {
    const slot = revisionSlot(
      card.at,
      card.summary.originChatId,
      run?.id,
      items.map((item) => events[Number(item.blocks[0]?.key)]?.at),
    );
    revisionSlots.set(slot, [...(revisionSlots.get(slot) ?? []), card.content]);
  }
  const activityTurns = useMemo(() => {
    const groups = new Map<string, Block[]>();
    const included = new Set(blocks.slice(-visible).map((block) => block.key));
    let current = blocks.find((block) => block.type === "prompt")?.key ?? "session";
    for (const block of blocks) {
      if (block.type === "prompt") current = block.key;
      if (!included.has(block.key) || !isActivityBlock(block)) continue;
      const group = groups.get(current) ?? [];
      group.push(block);
      groups.set(current, group);
    }
    return { groups, current };
  }, [blocks, visible]);
  const liveActivity = !!(
    working ||
    connecting ||
    run?.stopping ||
    (pending && ["send", "cancel", "stop", "restart"].includes(pending)) ||
    (chat?.activity && chat.activity.state !== "idle")
  );
  const liveTurn = liveActivity ? activityTurns.current : null;
  useEffect(() => {
    if (!shown || target?.eventIndex === undefined || matched.current === `${key}:${target.serial}`)
      return;
    const blockIndex = blocks.findIndex((block) => block.key === String(target.eventIndex));
    if (blockIndex < 0) return;
    if (blocks.length - blockIndex > visible) {
      setVisible(blocks.length - blockIndex);
      return;
    }
    const group = [...activityTurns.groups].find(([, blocks]) =>
      blocks.some((block) => block.key === String(target.eventIndex)),
    )?.[0];
    if (group && !expandedActivities.has(group)) {
      setExpandedActivities((current) => new Set([...current, group]));
      return;
    }
    return whenChatEventAppears(frame.current, target.eventIndex, (element) => {
      const viewport = scroll.current;
      if (!viewport) return;
      pause();
      const top =
        viewport.scrollTop +
        element.getBoundingClientRect().top -
        viewport.getBoundingClientRect().top -
        viewport.clientHeight / 3;
      revealActivity(top, group ? detailsDuration : 0, () => element.isConnected);
      element.focus({ preventScroll: true });
      matched.current = `${key}:${target.serial}`;
    });
  }, [
    shown,
    target,
    key,
    blocks,
    visible,
    activityTurns,
    expandedActivities,
    scroll,
    pause,
    revealActivity,
    detailsDuration,
  ]);
  const detailsId = (turn: string) => `${id}-activity-details-${turn}`;
  const historyId = (turn: string) => `${id}-activity-history-${turn}`;
  const toggleActivity = (turn: string) => {
    pause();
    setExpandedActivities((current) => {
      const next = new Set(current);
      if (next.has(turn)) next.delete(turn);
      else next.add(turn);
      return next;
    });
    if (!expandedActivities.has(turn)) {
      requestAnimationFrame(() => {
        const viewport = scroll.current;
        const details = document.getElementById(detailsId(turn));
        const trigger = document.getElementById(
          liveTurn === turn ? `${id}-live-activity` : historyId(turn),
        );
        if (currentKey.current !== key || !viewport || !details || details.inert || !trigger)
          return;
        const bounds = viewport.getBoundingClientRect();
        const height = details.querySelector(".activity-details-content")?.scrollHeight ?? 0;
        if (height + details.getBoundingClientRect().top > bounds.bottom) {
          const destination = viewport.scrollTop + trigger.getBoundingClientRect().top - bounds.top;
          // The scroll range grows with the dropdown. Reveal its beginning as it opens.
          revealActivity(
            destination,
            detailsDuration,
            () => currentKey.current === key && details.isConnected && !details.inert,
          );
        }
      });
    }
  };
  const activityDetails = (turn: string) => (
    <section
      id={detailsId(turn)}
      className="activity-details"
      aria-label="Activity details"
      aria-live="off"
      data-expanded={expandedActivities.has(turn)}
      aria-hidden={!expandedActivities.has(turn)}
      inert={!expandedActivities.has(turn)}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        pause();
        setExpandedActivities((current) => new Set([...current].filter((key) => key !== turn)));
        document
          .getElementById(liveTurn === turn ? `${id}-live-activity` : historyId(turn))
          ?.focus();
      }}
    >
      <div className="activity-details-clip">
        <div className="activity-details-content">
          {activityTurns.groups
            .get(turn)
            ?.map((block) => (
              <ChatMessage
                key={block.key}
                block={block}
                openLink={api.openWebLink}
                eventIndex={block.key}
                className={target?.eventIndex === Number(block.key) ? "search-match" : ""}
                {...(target?.eventIndex === Number(block.key) ? { tabIndex: -1 } : {})}
              />
            )) ?? <p>No activity yet.</p>}
        </div>
      </div>
    </section>
  );
  const latest = events.findLast(
    (event) =>
      event.type !== "status" &&
      event.type !== "turnEnd" &&
      event.type !== "acp" &&
      event.type !== "sessionState",
  );
  const progress =
    run?.stopping || pending === "cancel" || pending === "stop"
      ? "Stopping"
      : connecting || pending === "restart"
        ? "Connecting"
        : run?.status === "waiting"
          ? "Waiting for approval"
          : working
            ? latest?.type === "message"
              ? "Responding"
              : latest?.type === "toolCall" || latest?.type === "permission"
                ? "Working"
                : "Thinking"
            : pending === "send"
              ? "Sending"
              : "";
  const failed = run && ["failed", "timed_out", "interrupted"].includes(run.status);
  const failure =
    error || chatFailureReason(run?.status, chat?.error || (failed ? run.reason : undefined));
  const opening = progress === "Connecting" && !failure;
  useEffect(() => {
    setError("");
    setVisible(300);
    setExpandedActivities(new Set());
  }, [setError]);
  async function send(submitted: string) {
    if (!ready || busy || !run || !submitted.trim()) return false;
    const sent = draftState.sent();
    const text = sent.text.trim() === submitted ? sent.text : submitted;
    const command = relay ? undefined : invokedCommand(commands, text);
    if (
      await action({
        type: "send",
        id: run.id,
        text,
        ...(sent.attachments.length
          ? { references: sent.attachments.map((item) => item.reference) }
          : {}),
        ...(command ? { command: command.name } : {}),
      })
    ) {
      draftState.clear(sent);
      resume();
      return true;
    }
    return false;
  }
  async function undoRequest() {
    const undoId = run?.id ?? (relay ? chat?.conversationId : undefined);
    if (!undoId || !chat?.checkpoint || busy) return;
    const sent = draftState.sent();
    await action(
      {
        type: "undo-request",
        id: undoId,
        checkpointId: chat.checkpoint.id,
        replacesDraft: !!sent.text || sent.attachments.length > 0,
      },
      (result) => {
        if (!draftState.restore(sent, result.text, result.references))
          setError("Undo finished, but a newer draft was preserved.");
      },
    );
  }
  const label = connecting
    ? "Connecting"
    : ready
      ? "Ready"
      : run
        ? statusSpec[run.status].label
        : "Not connected";
  const hasLiveDetails = liveTurn !== null && activityTurns.groups.has(liveTurn);
  const liveOverride =
    run?.stopping || pending === "cancel" || pending === "stop"
      ? "Stopping"
      : pending === "send"
        ? "Sending"
        : undefined;
  const responding = chat?.activity?.state === "responding" && !liveOverride;
  const liveAnchor = items.find((item) => item.key === liveTurn);
  // Activity belongs to its prompt. Giving the status or its collapsed details
  // their own Carbon messages creates empty assistant bubbles and announcements.
  const liveContent = !opening && liveTurn !== null && (
    <>
      {responding ? (
        hasLiveDetails && (
          <Button
            variant="quiet"
            type="button"
            className="activity-history-toggle"
            id={`${id}-live-activity`}
            aria-expanded={expandedActivities.has(liveTurn)}
            aria-controls={detailsId(liveTurn)}
            onClick={() => toggleActivity(liveTurn)}
          >
            Activity details
          </Button>
        )
      ) : (
        <ActivityDisplay
          id={`${id}-live-activity`}
          controls={detailsId(liveTurn)}
          expanded={expandedActivities.has(liveTurn)}
          onToggle={() => toggleActivity(liveTurn)}
          activity={chat?.activity?.state === "connecting" ? undefined : chat?.activity}
          fallback={progress || label}
          delegated={delegated}
          hidden={hidden}
          override={liveOverride}
        />
      )}
      {(!responding || hasLiveDetails) && activityDetails(liveTurn)}
    </>
  );
  const promptControls = (
    <SessionInfo
      sessionId={run?.id ?? ""}
      active={active}
      state={run?.sessionState}
      ended={!!ended}
      editable={ready && !busy}
      changing={!!run?.modeChanging || pending === "set-mode"}
      sessionRole="orchestrator"
      onSaveDefault={() => {
        if (run) void action({ type: "save-model-default", id: run.id });
      }}
      onMode={(change) => {
        if (run) void action({ type: "set-mode", id: run.id, change });
      }}
    />
  );
  const footer = (
    <Card as="section" className="composer" aria-label="Chat composer">
      {chat?.checkpoint?.phase === "undoing" && (
        <p role="alert">
          Undo needs recovery before another request can start.
          <Button type="button" disabled={busy} onClick={() => void undoRequest()}>
            Resume Undo
          </Button>
        </p>
      )}
      {!!draftState.attachments.length && (
        <ul className="chat-attachments" aria-label="Attached code references">
          {draftState.attachments.map((attachment, index) => (
            <li key={JSON.stringify(attachment.reference)}>
              {attachment.label}
              <Button
                variant="quiet"
                type="button"
                disabled={busy}
                aria-label={`Remove ${attachment.label}`}
                onClick={() => draftState.remove(index)}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      {!relay && /^\$\S+/.test(draft) && !invokedCommand(commands, draft) && (
        <p className="command-plain-text muted" role="status">
          No matching command. This message will be sent as plain text.
        </p>
      )}
      <SessionExtras
        harness={run?.agent ?? "N/A"}
        ended={!!ended}
        active={active}
        autoApproval={autoApproval}
        onAutoApprovalChange={(value) => api.setOrchestrationAutoApproval(value)}
      >
        {!relay && (
          <TacticsControl
            selection={chat?.tactic}
            disabled={!database || !run || busy}
            active={active && !hidden}
            context={`${run?.id ?? ""}:${project ?? ""}`}
            onChange={(tactic) =>
              run
                ? action({ type: "set-tactic", id: run.id, project, tactic })
                : Promise.resolve(false)
            }
          />
        )}
      </SessionExtras>
    </Card>
  );
  return (
    <main
      className="orchestration-chat-page"
      aria-labelledby={id}
      hidden={hidden}
      inert={selectionPending}
      data-navigation-pending={selectionPending || undefined}
      aria-busy={selectionPending || undefined}
      data-chat-id={run?.id}
    >
      <header className="orchestration-chat-heading">
        <PageTitle
          page={relay && !chat?.customAgentId ? "relay" : chat ? "orchestrator" : "chat"}
          id={id}
          target={titleTarget ? { kind: "conversation", id: titleTarget } : undefined}
          actions={[
            ...(!relay
              ? [
                  {
                    id: "rename",
                    label: "Rename",
                    disabled: !available || !run,
                    run: () => setRenaming(true),
                  },
                ]
              : []),
            ...(!available
              ? [{ id: "connect", label: "Connect to database", run: onDatabase }]
              : connecting && !chat?.restored
                ? [
                    {
                      id: "cancel-connection",
                      label: "Cancel",
                      disabled: busy,
                      run: () => void action({ type: "stop", id: run?.id ?? null }),
                    },
                  ]
                : relay && (!run || ended)
                  ? [
                      {
                        id: "retry-connection",
                        label: "Retry connection",
                        disabled: busy,
                        run: () =>
                          void action({
                            type: "restart",
                            id: run?.id ?? chat?.conversationId ?? null,
                          }),
                      },
                    ]
                  : []),
          ]}
        >
          {chat?.title ?? (relay ? "Relay" : "Chat")}
        </PageTitle>
        {renaming && run && (
          <RenameChat
            title={chat?.title ?? "Chat"}
            onClose={() => setRenaming(false)}
            onSave={(title) => action({ type: "rename", id: run.id, title })}
          />
        )}
      </header>
      {!liveAnchor && liveContent}
      {notice}
      {failure && (
        <div className="error-banner" role="alert">
          {failure}
        </div>
      )}
      {relay && chat?.historySaving === "unavailable" && (
        <div className="warning-banner" role="status">
          History isn’t being saved. Recent messages may be unavailable after restart.
        </div>
      )}
      <div className="orchestration-chat-body">
        <div className="chat-connection-frame" ref={frame}>
          <ActivityDisplay
            key={run?.id ?? "empty"}
            presentation="connecting"
            activity={undefined}
            fallback="Connecting"
            delegated=""
            override={opening ? "Connecting" : undefined}
            hidden={
              hidden ||
              !active ||
              !!failure ||
              working ||
              pending === "send" ||
              progress === "Stopping"
            }
          />
          <EmbeddedChat
            footer={footer}
            promptControls={promptControls}
            key={JSON.stringify([key, chat?.conversationId, chat?.generation])}
            active={shown}
            onInputFocusChange={relay && !chat?.customAgentId ? reportRelayFocus : undefined}
            label="Message to orchestrator"
            draft={draft}
            canSend={!!ready && !busy}
            disabled={
              !available || !run || pending === "undo-request" || (connecting && !chat?.restored)
            }
            commands={relay ? undefined : commands}
            onEdit={edit}
            onSend={send}
            stop={
              working && available && !busy && !run?.stopping
                ? () => action({ type: "cancel", id: run?.id ?? null })
                : undefined
            }
            onViewport={onViewport}
          >
            {blocks.length === 0 && initialized && (
              <div className="chat-empty">
                <h2>Give Code60 a task.</h2>
              </div>
            )}
            {blocks.length > visible && (
              <Button
                variant="quiet"
                type="button"
                onClick={() => {
                  pause();
                  setVisible((count) => count + 300);
                }}
              >
                Show earlier activity
              </Button>
            )}
            {items.map((item, index) => {
              if (
                item.activity &&
                item !== liveAnchor &&
                !revisionSlots.has(index) &&
                !item.blocks.some((block) => {
                  const timing = timings.get(block.key);
                  return timing && !timing.active;
                })
              )
                return null;
              const first = item.blocks[0];
              return (
                <ChatTurn
                  key={item.key}
                  at={events[Number(first?.key)]?.at}
                  from={first?.type === "prompt" && !first.automatic ? "user" : "assistant"}
                >
                  <div className="chat-turn-content">
                    {revisionSlots.get(index)}
                    {!item.activity &&
                      (() => {
                        const block = item.blocks[0] as Block;
                        const event = events[Number(block.key)];
                        const feedback =
                          event?.type === "prompt"
                            ? revisionFlow.summaries.find((review) =>
                                feedbackAt(review, run?.id, event.turn),
                              )
                            : undefined;
                        const fresh =
                          Number(block.key) >= receivedEvents.current.count &&
                          isLiveMessage(event?.at, visibility.current.since) &&
                          !chat?.restored &&
                          active &&
                          !hidden;
                        const message = feedback ? (
                          <article
                            className={`event prompt${target?.eventIndex === Number(block.key) ? " search-match" : ""}`}
                            data-event-index={block.key}
                            tabIndex={-1}
                            aria-label="Your review feedback"
                          >
                            <div className="chat-message-speaker">You</div>
                            <p>Feedback on {feedback.title}</p>
                            <Button
                              variant="quiet"
                              type="button"
                              onClick={() => {
                                const batch = feedback.submissions.find(
                                  (batch) =>
                                    (batch.deliveredChatId ?? feedback.originChatId) === run?.id &&
                                    batch.deliveredTurn ===
                                      (event?.type === "prompt" ? event.turn : undefined),
                                );
                                if (
                                  batch &&
                                  revisionFlow.showFeedback(feedback.id, batch.revisionId)
                                )
                                  return;
                                if (!relay) onReview?.(feedback.id);
                              }}
                            >
                              View submitted feedback
                            </Button>
                          </article>
                        ) : (
                          <ChatMessage
                            key={item.key}
                            block={block}
                            eventIndex={block.key}
                            className={
                              target?.eventIndex === Number(block.key) ? "search-match" : ""
                            }
                            {...(target?.eventIndex === Number(block.key) ? { tabIndex: -1 } : {})}
                            at={events[Number(block.key)]?.at}
                            prompt={
                              relay ? (
                                block.text
                              ) : (
                                <CommandMessage text={block.text} commands={commands} />
                              )
                            }
                            openLink={api.openWebLink}
                            incoming={block.type === "message" && fresh}
                            visible={active && !hidden}
                            onCopied={onCopied}
                            actions={
                              block === latestRequest &&
                              chat?.checkpoint && (
                                <Button
                                  variant="quiet"
                                  className="message-undo"
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void undoRequest()}
                                >
                                  Undo
                                </Button>
                              )
                            }
                          />
                        );
                        return block.type === "message" || block.type === "prompt" ? (
                          <ChatMessageLayout incoming={fresh} active={active && !hidden}>
                            {message}
                          </ChatMessageLayout>
                        ) : (
                          message
                        );
                      })()}
                    {item.blocks.map((block) => {
                      const timing = timings.get(block.key);
                      return timing && !timing.active ? (
                        <div className="chat-turn-history" key={block.key}>
                          <TurnTimer
                            timing={timing}
                            visible={active}
                            disclosure={
                              liveTurn !== block.key && activityTurns.groups.has(block.key)
                                ? {
                                    id: historyId(block.key),
                                    controls: detailsId(block.key),
                                    expanded: expandedActivities.has(block.key),
                                    toggle: () => toggleActivity(block.key),
                                  }
                                : undefined
                            }
                          />
                          {liveTurn !== block.key &&
                            activityTurns.groups.has(block.key) &&
                            activityDetails(block.key)}
                        </div>
                      ) : null;
                    })}
                    {item === liveAnchor && liveContent}
                  </div>
                </ChatTurn>
              );
            })}
            {revisionSlots.get(items.length)}
            {revisionFlow.footer}
            {liveTurn === null &&
              activityTurns.current === "session" &&
              activityTurns.groups.has("session") && (
                <>
                  <Button
                    variant="quiet"
                    type="button"
                    className="activity-history-toggle"
                    id={historyId("session")}
                    aria-expanded={expandedActivities.has("session")}
                    aria-controls={detailsId("session")}
                    onClick={() => toggleActivity("session")}
                  >
                    Session details
                  </Button>
                  {activityDetails("session")}
                </>
              )}
            {run && run.pending.length > 0 && (
              <PendingApprovals
                requests={run.pending}
                key={`approval-${run.id}`}
                onAnswer={(permissionId, answer) =>
                  api.orchestrationChatAction({
                    type: "permission",
                    id: run.id,
                    permissionId,
                    answer,
                  })
                }
              />
            )}
          </EmbeddedChat>
        </div>
      </div>
    </main>
  );
}
