import { useEffect, useId, useMemo, useRef, useState } from "react";
import type {
  Command,
  DesktopApi,
  DesktopRun,
  OrchestrationChat,
  OrchestrationChatAction,
  PlanSummary,
  ReviewSummary,
} from "../bridge/index.js";
import type { RunEvent } from "../core/index.js";
import { ActivityDisplay } from "./activity-display.js";
import { ChatMarkdown } from "./chat-markdown.js";
import { RenameChat } from "./chat-name.js";
import { delegatedActivity, turnTimings } from "./chat-presentation.js";
import { CommandComposer, CommandMessage, invokedCommand } from "./command-composer.js";
import { Icon } from "./icons.js";
import { McpBadge } from "./mcp-badge.js";
import { MessageCopy, TurnTimer } from "./message-controls.js";
import { SessionInfo } from "./session-info.js";
import { type Block, statusSpec, transcript } from "./state.js";

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
function reviewAt(review: ReviewSummary, chatId: string | undefined, turn: number) {
  return (
    review.chatId === chatId &&
    ((review.originChatId === chatId && review.turn === turn) || feedbackAt(review, chatId, turn))
  );
}

function ChatMessage({
  block,
  commands = [],
  api,
}: {
  block: Block;
  commands?: readonly Command[];
  api: DesktopApi;
}) {
  const speaker =
    block.type === "prompt"
      ? block.automatic
        ? "Automatic worker update"
        : "You"
      : block.type === "message"
        ? "Assistant"
        : block.type === "thought"
          ? "Thinking"
          : block.type === "toolCall"
            ? "Tool"
            : block.type === "permission"
              ? "Permission"
              : block.type === "stderr"
                ? "Error"
                : "Session";
  return (
    <article
      className={`event ${block.type}${block.automatic ? " automatic" : ""}`}
      aria-label={speaker}
    >
      {block.type !== "message" && <div className="chat-message-speaker">{speaker}</div>}
      <McpBadge mcp={block.mcp} />
      {block.type === "message" ? (
        <ChatMarkdown text={block.text} openLink={api.openWebLink} />
      ) : (
        <pre>
          {block.type === "prompt" && !block.automatic ? (
            <CommandMessage text={block.text} commands={commands} />
          ) : (
            block.text
          )}
        </pre>
      )}
      {(block.type === "message" || (block.type === "prompt" && !block.automatic)) && (
        <MessageCopy text={block.text} />
      )}
      {block.detail && <pre>{block.detail}</pre>}
    </article>
  );
}

export function ChatPage({
  api,
  chat,
  hidden = false,
  events,
  database,
  active,
  onDatabase,
  runs,
  reviews = [],
  plans = [],
  commands = [],
  onPlan,
  onReview,
}: {
  api: DesktopApi;
  chat: OrchestrationChat | undefined;
  hidden?: boolean;
  events: readonly RunEvent[];
  database: string | null;
  active: boolean;
  onDatabase(): void;
  runs: readonly DesktopRun[];
  reviews?: ReviewSummary[];
  plans?: PlanSummary[];
  commands?: readonly Command[];
  onPlan?: (id: string) => void;
  onReview?(id: string): void;
}) {
  const [renaming, setRenaming] = useState(false);
  const id = useId();
  const run = chat?.run;
  const key = run ? `code60.orchestrationDraft:${run.id}` : "";
  const currentKey = useRef(key);
  currentKey.current = key;
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<OrchestrationChatAction["type"] | null>(null);
  const busy = pending !== null;
  const [error, setError] = useState("");
  const [visible, setVisible] = useState(300);
  const [expandedActivities, setExpandedActivities] = useState<Set<string>>(() => new Set());
  const inFlight = useRef(false);
  const scroll = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const position = useRef(0);
  const geometry = useRef({ width: 0, height: 0, contentHeight: 0 });
  const working = (run?.status === "running" || run?.status === "waiting") && run.turns > 0;
  const connecting = run?.status === "queued" || (run?.status === "running" && run.turns === 0);
  const ready = !!database && run?.status === "idle" && !run.stopping && !run.modeChanging;
  const ended = run && !["queued", "running", "waiting", "idle"].includes(run.status);
  const blocks = useMemo(() => transcript(events), [events]);
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
  const detailsId = (turn: string) => `${id}-activity-details-${turn}`;
  const historyId = (turn: string) => `${id}-activity-history-${turn}`;
  const toggleActivity = (turn: string) => {
    follow.current = false;
    if (scroll.current) position.current = scroll.current.scrollTop;
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
          const started = performance.now();
          // The scroll range grows with the dropdown. Reveal its beginning as it opens.
          const reveal = (now: number) => {
            if (currentKey.current !== key || !details.isConnected || details.inert) return;
            viewport.scrollTop = destination;
            position.current = viewport.scrollTop;
            if (now - started < 250) requestAnimationFrame(reveal);
          };
          requestAnimationFrame(reveal);
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
            ?.map((block) => <ChatMessage key={block.key} block={block} api={api} />) ?? (
            <p>No activity yet.</p>
          )}
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
  const failure = error || chat?.error || (failed ? run.reason : "");
  useEffect(() => {
    setDraft(key ? (sessionStorage.getItem(key) ?? "") : "");
    setError("");
    setVisible(300);
    setExpandedActivities(new Set());
    follow.current = true;
    position.current = 0;
  }, [key]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: streamed text and expanded history change the scroll height.
  useEffect(() => {
    const element = scroll.current;
    if (!active || !element) return;
    element.scrollTop = follow.current ? element.scrollHeight : position.current;
    geometry.current = {
      width: element.clientWidth,
      height: element.clientHeight,
      contentHeight: element.scrollHeight,
    };
  }, [active, events, visible, progress]);
  useEffect(() => {
    const element = scroll.current;
    if (!active || !element) return;
    const resize = new ResizeObserver(() => {
      if (follow.current) element.scrollTop = element.scrollHeight;
      geometry.current = {
        width: element.clientWidth,
        height: element.clientHeight,
        contentHeight: element.scrollHeight,
      };
    });
    resize.observe(element);
    if (content.current) resize.observe(content.current);
    return () => resize.disconnect();
  }, [active]);
  function edit(text: string) {
    setDraft(text);
    if (key) sessionStorage.setItem(key, text);
  }
  async function action(request: OrchestrationChatAction) {
    if (!database || inFlight.current) return false;
    inFlight.current = true;
    setPending(request.type);
    setError("");
    try {
      await api.orchestrationChatAction(request);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      inFlight.current = false;
      setPending(null);
    }
  }
  async function send() {
    if (!ready || !run || !draft.trim()) return;
    const text = draft;
    const command = invokedCommand(commands, text);
    if (
      (await action({
        type: "send",
        id: run.id,
        text,
        ...(command ? { command: command.name } : {}),
      })) &&
      currentKey.current === key
    ) {
      setDraft((current) => (current === text ? "" : current));
      if (sessionStorage.getItem(key) === text) sessionStorage.removeItem(key);
      follow.current = true;
    }
  }
  const label = connecting
    ? "Connecting"
    : ready
      ? "Ready"
      : run
        ? statusSpec[run.status].label
        : "Not connected";
  return (
    <main className="orchestration-chat-page" aria-labelledby={id} hidden={hidden}>
      <header className="orchestration-chat-heading">
        <h1 id={id}>
          <button
            type="button"
            className="chat-title"
            aria-label={`Rename chat: ${chat?.title ?? "Chat"}`}
            disabled={!database || !run}
            onClick={() => setRenaming(true)}
          >
            {chat?.title ?? "Chat"}
          </button>
        </h1>
        {renaming && run && (
          <RenameChat
            title={chat?.title ?? "Chat"}
            onClose={() => setRenaming(false)}
            onSave={(title) => action({ type: "rename", id: run.id, title })}
          />
        )}
        <div className="orchestration-chat-status">
          {plans.length > 0 && (
            <nav className="chat-plans" aria-label="Plans">
              {plans.map((plan) => (
                <button type="button" key={plan.id} onClick={() => onPlan?.(plan.id)}>
                  Plan · {plan.title}
                </button>
              ))}
            </nav>
          )}
          {!database ? (
            <button type="button" onClick={onDatabase}>
              Connect to database
            </button>
          ) : connecting ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void action({ type: "stop", id: run?.id ?? null })}
            >
              Cancel
            </button>
          ) : (
            (!run || ended) && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void action({ type: "restart", id: run?.id ?? null })}
              >
                Retry
              </button>
            )
          )}
        </div>
      </header>
      {failure && (
        <div className="error-banner" role="alert">
          {failure}
        </div>
      )}
      {run && !ended && chat?.updates.paused && (
        <div className="warning-banner" role="status">
          <span>
            Automatic worker updates are paused
            {chat.updates.pending > 0 ? ` (${chat.updates.pending} waiting)` : ""}. Sending a
            message also resumes them.
          </span>
          <button
            type="button"
            disabled={!database || busy}
            onClick={() => void action({ type: "resume-updates", id: run.id })}
          >
            Resume updates
          </button>
        </div>
      )}
      <div className="orchestration-chat-body">
        <div
          className="transcript"
          ref={scroll}
          role="log"
          aria-label="Orchestration conversation"
          // Content growth during streaming can make a scroll event look like a resize,
          // so explicit upward input releases following before that event arrives.
          onWheel={(event) => {
            if (event.deltaY < 0) follow.current = false;
          }}
          onKeyDown={(event) => {
            if (["ArrowUp", "PageUp", "Home"].includes(event.key)) follow.current = false;
          }}
          onScroll={() => {
            if (!active || !scroll.current) return;
            const element = scroll.current;
            const resized =
              geometry.current.width !== element.clientWidth ||
              geometry.current.height !== element.clientHeight ||
              geometry.current.contentHeight !== element.scrollHeight;
            if (resized && follow.current) element.scrollTop = element.scrollHeight;
            else
              follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
            geometry.current = {
              width: element.clientWidth,
              height: element.clientHeight,
              contentHeight: element.scrollHeight,
            };
            position.current = element.scrollTop;
          }}
        >
          <div className="chat-transcript-content" ref={content}>
            {blocks.length === 0 && (
              <div className="chat-empty">
                <h2>Give Code60 a task.</h2>
              </div>
            )}
            {blocks.length > visible && (
              <button
                type="button"
                onClick={() => {
                  follow.current = false;
                  setVisible((count) => count + 300);
                }}
              >
                Show earlier activity
              </button>
            )}
            {items.map((item) => (
              <div className="chat-turn-content" key={item.key}>
                {!item.activity &&
                  (() => {
                    const block = item.blocks[0] as Block;
                    const event = events[Number(block.key)];
                    const feedback =
                      event?.type === "prompt"
                        ? reviews.find((review) => feedbackAt(review, run?.id, event.turn))
                        : undefined;
                    return feedback ? (
                      <article className="event prompt" aria-label="Your review feedback">
                        <div className="chat-message-speaker">You</div>
                        <p>Feedback on {feedback.title}</p>
                        <button type="button" onClick={() => onReview?.(feedback.id)}>
                          View submitted feedback
                        </button>
                      </article>
                    ) : (
                      <ChatMessage key={item.key} block={block} commands={commands} api={api} />
                    );
                  })()}
                {item.blocks.flatMap((block) => {
                  const event = events[Number(block.key)];
                  if (event?.type !== "prompt") return [];
                  return reviews
                    .filter((review) => reviewAt(review, run?.id, event.turn))
                    .map((review) => (
                      <div className="chat-review-activity" key={review.id}>
                        <span>{review.title}</span>
                        <span>
                          {review.workers
                            .map(
                              (worker) =>
                                `${worker.label}: ${statusSpec[runs.find((run) => run.record.id === worker.runId)?.view?.status ?? runs.find((run) => run.record.id === worker.runId)?.record.status ?? "interrupted"].label}`,
                            )
                            .join(" · ")}
                        </span>
                        <button type="button" onClick={() => onReview?.(review.id)}>
                          {review.submissions.some((batch) => batch.state === "delivered")
                            ? "Review updates"
                            : "Review changes"}
                        </button>
                      </div>
                    ));
                })}
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
              </div>
            ))}
            {reviews
              .filter(
                (review) =>
                  review.chatId === run?.id &&
                  review.workers.length > 0 &&
                  !events.some(
                    (event) => event.type === "prompt" && reviewAt(review, run?.id, event.turn),
                  ),
              )
              .map((review) => (
                <div className="chat-review-activity" key={review.id}>
                  <span>{review.title}</span>
                  <span>
                    {review.workers
                      .map(
                        (worker) =>
                          `${worker.label}: ${statusSpec[runs.find((run) => run.record.id === worker.runId)?.view?.status ?? runs.find((run) => run.record.id === worker.runId)?.record.status ?? "interrupted"].label}`,
                      )
                      .join(" · ")}
                  </span>
                  <button type="button" onClick={() => onReview?.(review.id)}>
                    {review.submissions.some((batch) => batch.state === "delivered")
                      ? "Review updates"
                      : "Review changes"}
                  </button>
                </div>
              ))}
            <ActivityDisplay
              key={run?.id ?? "empty"}
              id={`${id}-live-activity`}
              controls={detailsId(activityTurns.current)}
              expanded={expandedActivities.has(activityTurns.current)}
              onToggle={() => toggleActivity(activityTurns.current)}
              activity={chat?.activity}
              fallback={progress || label}
              delegated={delegated}
              hidden={hidden}
              override={
                run?.stopping || pending === "cancel" || pending === "stop"
                  ? "Stopping"
                  : pending === "restart"
                    ? "Connecting"
                    : pending === "send"
                      ? "Sending"
                      : undefined
              }
            />
            {liveTurn !== null && activityDetails(liveTurn)}
            {liveTurn === null &&
              activityTurns.current === "session" &&
              activityTurns.groups.has("session") && (
                <>
                  <button
                    type="button"
                    className="activity-history-toggle"
                    id={historyId("session")}
                    aria-expanded={expandedActivities.has("session")}
                    aria-controls={detailsId("session")}
                    onClick={() => toggleActivity("session")}
                  >
                    Session details
                  </button>
                  {activityDetails("session")}
                </>
              )}
          </div>
        </div>
        <section className="composer" aria-label="Chat composer">
          <label className="sr-only" htmlFor={`${id}-message`}>
            Message to orchestrator
          </label>
          <CommandComposer
            key={key}
            id={`${id}-message`}
            value={draft}
            commands={commands}
            disabled={!database || !run || !!ended || connecting}
            onChange={edit}
            onSend={() => void send()}
          />
          <SessionInfo
            harness={run?.agent ?? "N/A"}
            sessionId={run?.id ?? ""}
            active={active}
            state={run?.sessionState}
            ended={!!ended}
            editable={ready && !busy}
            changing={!!run?.modeChanging || pending === "set-mode"}
            autoApproval
            onMode={(change) => {
              if (run) void action({ type: "set-mode", id: run.id, change });
            }}
          >
            {working ? (
              <button
                type="button"
                className="composer-send"
                disabled={!database || busy || !!run?.stopping}
                onClick={() => void action({ type: "cancel", id: run?.id ?? null })}
              >
                <Icon name="stop" />
                Stop
              </button>
            ) : (
              <button
                type="button"
                className="primary composer-send"
                disabled={busy || !ready || !draft.trim()}
                onClick={() => void send()}
              >
                Send <Icon name="arrow--up" />
              </button>
            )}
          </SessionInfo>
        </section>
      </div>
    </main>
  );
}
