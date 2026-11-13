import type { DesktopApi, OrchestrationChatAction, Snapshot } from "../bridge/index.js";
import { conversationId } from "./chats.js";
import { pageAvailable } from "./navigation.js";
import {
  type Current,
  type Destination,
  destination,
  type NavigationRecorder,
  type Settle,
  useNavigationHistory,
} from "./navigation-history.js";
import { type PageId, type PageTabs, type SettingsSectionId, updateTabs } from "./tabs.js";

/** Announces an orchestrator change before it is requested from the main process. */
export type ChatNavigation = (request: OrchestrationChatAction) => [Settle, Current] | undefined;

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

interface HistoryDependencies {
  api: Pick<DesktopApi, "orchestrationChatAction">;
  snapshot: Snapshot | undefined;
  tabs: PageTabs;
  settingsSection: SettingsSectionId;
  workerId: string | undefined;
  setTabs(update: (current: PageTabs) => PageTabs): void;
  setSettingsSection(id: SettingsSectionId): void;
  closeMenus(): void;
  selectWorker(id: string | undefined): void;
  openChat(id: string): void;
  setError(message: string): void;
}

const currentDestination = ({ snapshot, tabs, settingsSection, workerId }: HistoryDependencies) =>
  destination(
    tabs.active,
    settingsSection,
    workerId ?? (snapshot && conversationId(snapshot.chat)),
  );

/** Back and Forward for the window: pages, Settings pages and specific chats. */
export function useHistoryNavigation(dependencies: HistoryDependencies) {
  return historyNavigation(useNavigationHistory(currentDestination(dependencies)), dependencies);
}

/** Connects a recorder to the app's page, Settings and chat selection. */
export function historyNavigation(recorder: NavigationRecorder, dependencies: HistoryDependencies) {
  const {
    api,
    snapshot,
    workerId,
    setTabs,
    setSettingsSection,
    closeMenus,
    selectWorker,
    openChat,
    setError,
  } = dependencies;
  const database = snapshot?.database ?? null;
  const orchestrator = snapshot && conversationId(snapshot.chat);
  const current = currentDestination(dependencies);
  const orchestratorChat = (id: string) =>
    snapshot?.chats.find((chat) => conversationId(chat) === id);
  const available = (entry: Destination) => {
    if (!pageAvailable(entry.page, database)) return false;
    if (!entry.chat) return true;
    const chat = orchestratorChat(entry.chat);
    if (chat) return !chat.archived;
    return Boolean(snapshot?.runs.some(({ record }) => record.id === entry.chat));
  };
  // Orchestrator selection shows Chat with the old selection until the snapshot catches up.
  const passing = (): Destination[] => [
    current,
    { page: "chat" },
    ...(orchestrator ? [{ page: "chat" as const, chat: orchestrator }] : []),
    ...(workerId ? [{ page: "chat" as const, chat: workerId }] : []),
  ];
  const selectPage = (id: PageId) => {
    closeMenus();
    setTabs((tabs) => updateTabs(tabs, { type: "select", id }));
  };
  const restore = async (entry: Destination, isCurrent: Current) => {
    if (entry.section) setSettingsSection(entry.section);
    if (!entry.chat) return selectPage(entry.page);
    closeMenus();
    if (!orchestratorChat(entry.chat)) return openChat(entry.chat);
    if (orchestrator !== entry.chat) {
      try {
        await api.orchestrationChatAction({ type: "select", id: entry.chat });
      } catch (cause) {
        if (isCurrent()) setError(message(cause));
        throw cause;
      }
      // A newer navigation wins over a slow restore.
      if (!isCurrent()) return;
    }
    selectWorker(undefined);
    selectPage("chat");
  };
  const expectChat: ChatNavigation = (request) => {
    if (request.type === "select")
      return recorder.expect(({ page, chat }) => page === "chat" && chat === request.id, passing());
    if (request.type !== "new") return undefined;
    const known = new Set([
      ...(snapshot?.chats.flatMap((chat) => conversationId(chat) ?? []) ?? []),
      ...(snapshot?.runs.map(({ record }) => record.id) ?? []),
    ]);
    return recorder.expect(
      ({ page, chat }) => page === "chat" && chat !== undefined && !known.has(chat),
      passing(),
    );
  };
  return {
    canGoBack: recorder.canGo(-1, available),
    canGoForward: recorder.canGo(1, available),
    back: () => recorder.go(-1, available, restore, passing()),
    forward: () => recorder.go(1, available, restore, passing()),
    expectChat,
  };
}
