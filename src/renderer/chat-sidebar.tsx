import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DesktopRun, OrchestrationChat } from "../bridge/index.js";
import type { RunEvent } from "../core/index.js";
import { sessionStatus } from "./chat-presentation.js";
import { type Conversation, conversations, reconcileDisclosure } from "./chats.js";
import { Icon } from "./icons.js";
import { statusSpec } from "./state.js";
import { loadReadMarker, readMarkerKey, replyTurns, unreadCount } from "./unread.js";

export function ChatSidebar({
  chats,
  runs,
  selectedId,
  navigationSerial,
  database,
  eventsByRun,
  open,
  pending,
  onSelect,
}: {
  chats: readonly OrchestrationChat[];
  runs: readonly DesktopRun[];
  selectedId: string | undefined;
  navigationSerial: number | undefined;
  database: string | null;
  eventsByRun: Readonly<Record<string, readonly RunEvent[]>>;
  open: boolean;
  pending: boolean;
  onSelect(id: string): void;
}) {
  const entries = useMemo(() => conversations(chats, runs), [chats, runs]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const previous = useRef<Record<string, string[]>>({});
  const markers = useRef(new Map<string, number>());
  const replies = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(eventsByRun).map(([id, events]) => [id, replyTurns(events)]),
      ),
    [eventsByRun],
  );
  useLayoutEffect(() => {
    const prior = previous.current;
    setCollapsed((current) => {
      const next = reconcileDisclosure(prior, entries, current);
      return next.size === current.size && [...next].every((id) => current.has(id))
        ? current
        : next;
    });
    const children: Record<string, string[]> = {};
    for (const entry of entries) {
      if (entry.parentId) {
        children[entry.parentId] ??= [];
        children[entry.parentId]?.push(entry.id);
      }
    }
    previous.current = children;
  }, [entries]);
  const parentId = entries.find(({ id }) => id === selectedId)?.parentId;
  // biome-ignore lint/correctness/useExhaustiveDependencies: explicit navigation to the same worker must reveal its parent.
  useLayoutEffect(() => {
    if (!parentId || !selectedId || !open) return;
    setCollapsed((current) => {
      if (!current.has(parentId)) return current;
      const next = new Set(current);
      next.delete(parentId);
      return next;
    });
  }, [selectedId, parentId, open, navigationSerial]);
  useLayoutEffect(() => {
    if (!database || !open || !selectedId) return;
    const key = readMarkerKey(database, selectedId);
    const read = (replies[selectedId] ?? []).reduce(
      (latest, turn) => Math.max(latest, turn),
      markers.current.get(key) ?? loadReadMarker(sessionStorage, key),
    );
    markers.current.set(key, read);
    try {
      sessionStorage.setItem(key, String(read));
    } catch {
      // Keep in-memory read state when browser storage is unavailable.
    }
  }, [database, open, selectedId, replies]);

  const chatById = new Map(chats.map((chat) => [chat.run?.id, chat]));
  const runById = new Map(runs.map((run) => [run.record.id, run]));
  const childrenById = new Map<string, Conversation[]>();
  for (const entry of entries) {
    if (!entry.parentId) continue;
    const children = childrenById.get(entry.parentId) ?? [];
    children.push(entry);
    childrenById.set(entry.parentId, children);
  }
  function row(entry: Conversation) {
    const chat = chatById.get(entry.id);
    const worker = runById.get(entry.id);
    const view = chat?.run ?? worker?.view;
    const presentation = view
      ? sessionStatus(view)
      : statusSpec[worker?.record.status ?? "interrupted"];
    const error = chat?.error;
    const key = readMarkerKey(database ?? "", entry.id);
    const read = markers.current.get(key) ?? loadReadMarker(sessionStorage, key);
    const unread = open && entry.id === selectedId ? 0 : unreadCount(replies[entry.id] ?? [], read);
    const unreadLabel = unread > 0 ? `${unread} unread ${unread === 1 ? "reply" : "replies"}` : "";
    const approvals = view?.pending.length ?? 0;
    const description = [
      entry.role === "orchestrator" ? "Orchestrator" : "Worker",
      error || presentation.label,
      approvals ? `${approvals} approvals waiting` : "",
      unreadLabel,
    ]
      .filter(Boolean)
      .join(". ");
    const children = childrenById.get(entry.id) ?? [];
    const expanded = !collapsed.has(entry.id);
    return (
      <div className="chat-sidebar-group" key={entry.id} data-conversation-id={entry.id}>
        <div className="chat-sidebar-row">
          <button
            type="button"
            id={`conversation-${entry.id}`}
            className="chat-sidebar-entry"
            data-role={entry.role}
            aria-label={entry.label}
            aria-description={description}
            aria-current={entry.id === selectedId ? "true" : undefined}
            disabled={pending}
            onClick={() => onSelect(entry.id)}
            title={description}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" && children.length) {
                event.preventDefault();
                event.stopPropagation();
                setCollapsed((current) => new Set([...current].filter((id) => id !== entry.id)));
                if (expanded) document.getElementById(`conversation-${children[0]?.id}`)?.focus();
              } else if (
                event.key === "ArrowLeft" &&
                (entry.parentId || (children.length && expanded))
              ) {
                event.preventDefault();
                event.stopPropagation();
                if (children.length && expanded)
                  setCollapsed((current) => new Set([...current, entry.id]));
                else document.getElementById(`conversation-${entry.parentId}`)?.focus();
              }
            }}
          >
            {view && (view.stopping || ["queued", "running", "waiting"].includes(view.status)) && (
              <span className="chat-loader" aria-hidden="true" />
            )}
            <Icon name={entry.role === "orchestrator" ? "branch" : "terminal"} />
            <span className="chat-sidebar-label">{entry.label}</span>
            {unread > 0 && (
              <span className="chat-unread" role="img" aria-label={unreadLabel}>
                <Icon name="chat" />
                <span>{unread}</span>
              </span>
            )}
            {(error || presentation.icon !== "chat") && (
              <Icon name={error ? "warning--alt--filled" : presentation.icon} />
            )}
            {approvals > 0 && <span className="chat-approval-count">({approvals})</span>}
            <span className="sr-only">{description}</span>
          </button>
          {children.length > 0 && (
            <button
              type="button"
              className="icon-button chat-workers-toggle"
              aria-label={`Workers for ${entry.label}`}
              aria-expanded={expanded}
              aria-controls={`workers-${entry.id}`}
              onClick={() =>
                setCollapsed((current) => {
                  const next = new Set(current);
                  if (next.has(entry.id)) next.delete(entry.id);
                  else next.add(entry.id);
                  return next;
                })
              }
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault();
                event.stopPropagation();
                setCollapsed((current) => {
                  const next = new Set(current);
                  if (event.key === "ArrowLeft") next.add(entry.id);
                  else next.delete(entry.id);
                  return next;
                });
                document.getElementById(`conversation-${entry.id}`)?.focus();
              }}
            >
              <Icon name={expanded ? "chevron--down" : "chevron--right"} />
            </button>
          )}
        </div>
        {children.length > 0 && (
          // biome-ignore lint/a11y/useSemanticElements: navigation disclosure, not a form fieldset.
          <div
            id={`workers-${entry.id}`}
            className="chat-worker-children"
            role="group"
            aria-label={`${entry.label} workers`}
            hidden={!expanded}
          >
            {children.map(row)}
          </div>
        )}
      </div>
    );
  }
  return (
    <nav className="chat-sidebar" aria-label="Chat conversations">
      <div className="chat-sidebar-list">
        {entries.filter(({ parentId }) => !parentId).map(row)}
      </div>
    </nav>
  );
}
