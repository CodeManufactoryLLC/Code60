import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  CustomAgentSummary,
  DesktopRun,
  OpenProject,
  OrchestrationChat,
} from "../bridge/index.js";
import type { RunEvent } from "../core/index.js";
import { buildChatHistorySections } from "./chat-history-model.js";
import { conversationId, hasConversationRun } from "./chats.js";
import type { NavigationActions } from "./navigation-actions.js";
import { loadReadMarker, readMarkerKey, replyTurns, unreadCount } from "./unread.js";

const CarbonChatHistory = lazy(() => import("./carbon-chat-history.js"));

export interface ChatHistoryPanelProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  chatOpen: boolean;
  conversationVisible: boolean;
  chats: readonly OrchestrationChat[];
  runs: readonly DesktopRun[];
  openProjects: readonly OpenProject[] | undefined;
  customAgents: readonly CustomAgentSummary[];
  selectedId: string | undefined;
  database: string | null;
  eventsByRun: Readonly<Record<string, readonly RunEvent[]>>;
  navigation: NavigationActions;
  onOpenProject(): void;
}

export function ChatHistoryPanel({
  open,
  onOpenChange,
  chatOpen,
  conversationVisible,
  chats,
  runs,
  openProjects,
  customAgents,
  selectedId,
  database,
  eventsByRun,
  navigation,
  onOpenProject,
}: ChatHistoryPanelProps) {
  const markers = useRef(new Map<string, number>());
  const railRef = useRef<HTMLElement | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    if (!open) return;
    const rail = railRef.current;
    if (!rail) return;
    const onToggle = (event: Event) => {
      const source = event.target instanceof HTMLElement ? event.target : null;
      const menu = source?.closest<HTMLElement>("[data-history-section-id]");
      const id = menu?.getAttribute("data-history-section-id");
      const expanded = (event as CustomEvent<{ expanded?: boolean }>).detail?.expanded;
      if (!id || typeof expanded !== "boolean") return;
      setCollapsedGroups((current) => {
        const has = current.has(id);
        if (expanded ? !has : has) return current;
        const next = new Set(current);
        if (expanded) next.delete(id);
        else next.add(id);
        return next;
      });
    };
    rail.addEventListener("cds-side-nav-menu-toggled", onToggle);
    return () => rail.removeEventListener("cds-side-nav-menu-toggled", onToggle);
  }, [open]);
  const relayChats = useMemo(() => chats.filter((chat) => chat.kind === "relay"), [chats]);
  const markerScope = (id: string) => {
    const relayOwner = relayChats.find(
      (chat) => conversationId(chat) === id || chat.workers?.includes(id),
    );
    return relayOwner ? `relay:${relayOwner.conversationId ?? id}` : database;
  };
  const replies = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(eventsByRun).map(([id, events]) => [id, replyTurns(events)]),
      ),
    [eventsByRun],
  );
  const summaries = useMemo(
    () =>
      new Map([
        ...chats.flatMap((chat) =>
          chat.run && chat.replies ? [[chat.run.id, chat.replies] as const] : [],
        ),
        ...runs.flatMap((run) => (run.replies ? [[run.record.id, run.replies] as const] : [])),
      ]),
    [chats, runs],
  );
  const markerKey = (scope: string, id: string) =>
    readMarkerKey(scope, id, summaries.has(id) ? "reply-count" : undefined);

  const selectedScope = selectedId ? markerScope(selectedId) : null;
  const selectedMarkerKey =
    selectedScope && selectedId && hasConversationRun(chats, runs, selectedId)
      ? markerKey(selectedScope, selectedId)
      : null;
  const selectedReplies = summaries.get(selectedId ?? "")?.count;

  useLayoutEffect(() => {
    if (!selectedMarkerKey || !conversationVisible || !selectedId) return;
    const read =
      selectedReplies ??
      (replies[selectedId] ?? []).reduce(
        (latest, turn) => Math.max(latest, turn),
        markers.current.get(selectedMarkerKey) ?? loadReadMarker(sessionStorage, selectedMarkerKey),
      );
    markers.current.set(selectedMarkerKey, read);
    try {
      sessionStorage.setItem(selectedMarkerKey, String(read));
    } catch {
      // Keep in-memory read state when browser storage is unavailable.
    }
  }, [selectedMarkerKey, conversationVisible, selectedId, replies, selectedReplies]);

  const unreadById = useMemo(() => {
    const result: Record<string, number> = {};
    for (const chat of chats) {
      const id = conversationId(chat);
      if (!id || chat.archived) continue;
      if (chatOpen && id === selectedId) {
        result[id] = 0;
        continue;
      }
      const relayOwner = relayChats.find(
        (entry) => conversationId(entry) === id || entry.workers?.includes(id),
      );
      const scope = (relayOwner ? `relay:${relayOwner.conversationId ?? id}` : database) ?? "";
      const key = readMarkerKey(scope, id, summaries.has(id) ? "reply-count" : undefined);
      const read = markers.current.get(key) ?? loadReadMarker(sessionStorage, key);
      const summary = summaries.get(id);
      result[id] = summary
        ? Math.max(0, summary.count - read)
        : unreadCount(replies[id] ?? [], read);
    }
    return result;
  }, [chats, chatOpen, selectedId, replies, summaries, database, relayChats]);

  const sections = useMemo(
    () =>
      buildChatHistorySections({
        chats,
        runs,
        openProjects,
        customAgents,
        selectedId,
        chatOpen,
        database,
        pending: navigation.pending,
        unreadById,
      }),
    [
      chats,
      runs,
      openProjects,
      customAgents,
      selectedId,
      chatOpen,
      database,
      navigation.pending,
      unreadById,
    ],
  );

  if (!open) return null;
  return (
    <aside ref={railRef} className="chat-history-rail" aria-label="Chat history">
      <Suspense fallback={<div className="chat-history-loading" aria-busy="true" />}>
        <CarbonChatHistory
          sections={sections}
          collapsedGroups={collapsedGroups}
          openProjects={openProjects ?? []}
          database={database}
          navigation={navigation}
          onClose={() => onOpenChange(false)}
          onOpenProject={onOpenProject}
        />
      </Suspense>
    </aside>
  );
}
