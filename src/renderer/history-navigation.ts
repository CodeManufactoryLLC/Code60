import type { DesktopRun, OrchestrationChatAction, Snapshot } from "../bridge/index.js";
import { conversationId } from "./chats.js";
import { pageAvailable } from "./navigation.js";
import type { NavigationActions, NavigationIntent } from "./navigation-actions.js";
import {
  type Current,
  type Destination,
  destination,
  type NavigationRecorder,
  type Settle,
  useNavigationHistory,
} from "./navigation-history.js";
import type { NavigationTarget } from "./navigation-tree.js";
import type { PageTabs, SettingsSectionId } from "./tabs.js";

export type ChatNavigation = (request: OrchestrationChatAction) => [Settle, Current] | undefined;

interface HistoryDependencies {
  snapshot: Snapshot | undefined;
  tabs: PageTabs;
  settingsSection: SettingsSectionId | null;
  workerId: string | undefined;
  runs: readonly DesktopRun[];
  navigation: Pick<NavigationActions, "open" | "busy">;
  setError(message: string): void;
}

const currentDestination = ({
  snapshot,
  tabs,
  settingsSection,
  workerId,
}: HistoryDependencies): Destination => {
  if (tabs.active === "project" && tabs.projectId)
    return { page: "project", project: tabs.projectId };
  return destination(
    tabs.active,
    settingsSection,
    workerId ?? (snapshot && conversationId(snapshot.chat)),
  );
};

export function useHistoryNavigation(dependencies: HistoryDependencies) {
  return historyNavigation(useNavigationHistory(currentDestination(dependencies)), dependencies);
}

/** Use the same owner-aware selection paths as sidebar and breadcrumb navigation. */
export function historyNavigation(recorder: NavigationRecorder, dependencies: HistoryDependencies) {
  const { snapshot, runs, navigation, setError, workerId } = dependencies;
  const database = snapshot?.database ?? null;
  const orchestrator = snapshot && conversationId(snapshot.chat);
  const current = currentDestination(dependencies);
  const chatById = (id: string) => snapshot?.chats.find((chat) => conversationId(chat) === id);
  const available = (entry: Destination) => {
    if (!pageAvailable(entry.page, database)) return false;
    if (entry.project)
      return Boolean(snapshot?.openProjects?.some((project) => project.id === entry.project));
    if (entry.page === "project") return false;
    if (!entry.chat) return true;
    const chat = chatById(entry.chat);
    if (chat) return !chat.archived && (Boolean(database) || chat.kind === "relay");
    return runs.some((run) => run.record.id === entry.chat && (Boolean(database) || run.relay));
  };
  const passing = (): Destination[] => [
    current,
    { page: "chat" },
    ...(orchestrator ? [{ page: "chat" as const, chat: orchestrator }] : []),
    ...(workerId ? [{ page: "chat" as const, chat: workerId }] : []),
  ];
  const restore = async (entry: Destination) => {
    const target: NavigationTarget = entry.chat
      ? { kind: "conversation", id: entry.chat }
      : entry.project
        ? { kind: "project", id: entry.project }
        : entry.section
          ? { kind: "settings", id: entry.section }
          : { kind: "page", id: entry.page };
    if (!(await navigation.open(target)))
      throw new Error("Unable to restore navigation destination.");
  };
  const expectTarget = (target: NavigationIntent): [Settle, Current] | undefined => {
    // Restores already own the recorder's pending traversal; do not turn them into visits.
    if (recorder.traversing) return undefined;
    const known = new Set([
      ...(snapshot?.chats.flatMap((chat) => conversationId(chat) ?? []) ?? []),
      ...runs.map(({ record }) => record.id),
    ]);
    return recorder.expect((entry) => {
      switch (target.kind) {
        case "conversation":
          return entry.page === "chat" && entry.chat === target.id;
        case "new-conversation":
          return entry.page === "chat" && entry.chat !== undefined && !known.has(entry.chat);
        case "custom-agent":
          return (
            entry.page === "chat" &&
            Boolean(entry.chat && chatById(entry.chat)?.customAgentId === target.id)
          );
        case "project":
          return entry.page === "project" && entry.project === target.id;
        case "settings":
          return entry.page === "settings" && entry.section === target.id;
        case "page":
          return entry.page === target.id;
      }
    }, passing());
  };
  const expectChat: ChatNavigation = (request) =>
    request.type === "select"
      ? expectTarget({ kind: "conversation", id: request.id })
      : request.type === "new"
        ? expectTarget({ kind: "new-conversation" })
        : undefined;
  const go = (direction: -1 | 1) => {
    if (navigation.busy) return;
    recorder.go(
      direction,
      available,
      async (entry, isCurrent) => {
        try {
          await restore(entry);
        } catch (cause) {
          if (isCurrent()) setError(cause instanceof Error ? cause.message : String(cause));
          throw cause;
        }
      },
      passing(),
    );
  };
  return {
    current,
    available,
    restore,
    settled: recorder.settled && !navigation.busy,
    canGoBack: !navigation.busy && recorder.canGo(-1, available),
    canGoForward: !navigation.busy && recorder.canGo(1, available),
    back: () => go(-1),
    forward: () => go(1),
    expectChat,
    expectTarget,
  };
}
