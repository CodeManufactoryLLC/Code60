import { useEffect, useRef, useState } from "react";
import type {
  ApplicationClient,
  DesktopRun,
  OpenProject,
  OrchestrationChat,
  OrchestrationChatAction,
  ProjectAction,
} from "../bridge/index.js";
import { conversationId } from "./chats.js";
import type { PageId, SettingsSectionId } from "./navigation.js";
import type { Current, Settle } from "./navigation-history.js";
import type { NavigationTarget } from "./navigation-tree.js";
import type { PageTabs } from "./tabs.js";

function canOpenChat(chat: OrchestrationChat, id: string | null) {
  return conversationId(chat) === id && (!chat.archived || Boolean(chat.run?.pending.length));
}

export type NavigationIntent = NavigationTarget | { kind: "new-conversation" };

interface Context {
  onNavigate?(target: NavigationIntent): [Settle, Current] | undefined;
  api: ApplicationClient;
  tabs: PageTabs;
  database: string | null;
  databaseEpoch: number | undefined;
  projects: readonly OpenProject[];
  chats: readonly OrchestrationChat[];
  runs: readonly DesktopRun[];
  selectedId: string | undefined;
  onPage(id: PageId): void;
  onSection(id: SettingsSectionId | null): void;
  onProject(id: string): void;
  selectWorker(
    id: string | undefined,
    projectId?: string | null,
    current?: () => boolean,
  ): undefined | Promise<boolean>;
  onArchived(): void;
  onProjectPending?(pending: boolean): void;
}

export function createNavigationActions(
  read: () => Context,
  status: (pending: boolean, error: string, projectPending: boolean, blocking?: boolean) => void,
  reveal: (target: NavigationTarget) => void = () => {},
) {
  let pending = false;
  let serial = 0;
  const scope = () => JSON.stringify([read().database, read().databaseEpoch]);
  async function run(
    operation: (current: () => boolean) => Promise<void>,
    success?: () => void,
    projectPending = false,
    valid: () => boolean = () => true,
    blocking = true,
    target?: NavigationIntent,
  ) {
    if (pending) return false;
    pending = true;
    const ticket = ++serial;
    const owner = scope();
    const destination = read().tabs;
    const current = () =>
      ticket === serial && owner === scope() && read().tabs === destination && valid();
    const expectation = target ? read().onNavigate?.(target) : undefined;
    let succeeded = false;
    status(true, "", projectPending, blocking);
    try {
      await operation(current);
      if (!current()) return false;
      success?.();
      succeeded = true;
      return true;
    } catch (cause) {
      if (current())
        status(
          true,
          cause instanceof Error ? cause.message : String(cause),
          projectPending,
          blocking,
        );
      return false;
    } finally {
      expectation?.[0](succeeded);
      pending = false;
      status(false, "", false);
    }
  }
  const chatAction = (request: OrchestrationChatAction) => {
    const before = read();
    const relay = before.chats.find((chat) => chat.kind === "relay" && !chat.customAgentId);
    const relayId = relay && conversationId(relay);
    const id = "id" in request ? request.id : undefined;
    if (
      !before.database &&
      !before.chats.some((chat) => chat.kind === "relay" && conversationId(chat) === id)
    )
      return Promise.resolve(false);
    const archiveCurrent =
      request.type === "archive" && id === before.selectedId && before.tabs.active === "chat";
    const archivedProjectId = archiveCurrent
      ? before.chats.find((chat) => conversationId(chat) === id)?.projectId
      : undefined;
    const archiveToProject =
      archivedProjectId &&
      !before.chats.some(
        (chat) =>
          chat.projectId === archivedProjectId && !chat.archived && conversationId(chat) !== id,
      )
        ? archivedProjectId
        : undefined;
    return run(
      async (current) => {
        await before.api.orchestrationChatAction(request);
        if (archiveToProject && current())
          await before.api.projectAction({ type: "select", projectId: archiveToProject });
        else if (archiveCurrent && relayId && current())
          await before.api.orchestrationChatAction({ type: "select", id: relayId });
      },
      () => {
        if (archiveCurrent) {
          read().onArchived();
          read().selectWorker(undefined, archiveToProject ?? null);
          if (archiveToProject) {
            reveal({ kind: "project", id: archiveToProject });
            read().onProject(archiveToProject);
          } else {
            if (relayId) reveal({ kind: "conversation", id: relayId });
            read().onPage("chat");
          }
        } else if (request.type === "select" || request.type === "new") {
          const projectId =
            request.type === "new"
              ? request.projectId
              : before.chats.find((chat) => conversationId(chat) === request.id)?.projectId;
          read().selectWorker(undefined, projectId ?? null);
          if (request.type === "select") reveal({ kind: "conversation", id: request.id });
          else if (projectId) reveal({ kind: "project", id: projectId });
          read().onPage("chat");
        }
      },
      !!archiveToProject,
      () => {
        if (archiveToProject)
          return read().projects.some((project) => project.id === archiveToProject);
        if (request.type === "select")
          return read().chats.some((chat) => canOpenChat(chat, request.id));
        if (request.type === "new" && request.projectId)
          return read().projects.some((project) => project.id === request.projectId);
        return true;
      },
      request.type !== "select",
      request.type === "select"
        ? { kind: "conversation", id: request.id }
        : request.type === "new"
          ? { kind: "new-conversation" }
          : undefined,
    );
  };
  const open = async (target: NavigationTarget) => {
    const context = read();
    switch (target.kind) {
      case "custom-agent":
        return run(
          async () => {
            if (!context.api.customAgent) throw new Error("Custom assistants are unavailable");
            await context.api.customAgent({ type: "open", id: target.id });
          },
          () => {
            read().selectWorker(undefined, null);
            read().onPage("chat");
            reveal(target);
          },
          false,
          () => true,
          true,
          target,
        );
      case "page":
        ++serial;
        if (target.id === "settings") context.onSection(null);
        context.onPage(target.id);
        return true;
      case "settings":
        ++serial;
        context.onSection(target.id);
        context.onPage("settings");
        return true;
      case "project":
        if (!context.projects.some((project) => project.id === target.id)) return false;
        return run(
          async () => context.api.projectAction({ type: "select", projectId: target.id }),
          () => {
            if (read().projects.some((project) => project.id === target.id)) {
              reveal(target);
              read().onProject(target.id);
            }
          },
          true,
          () => read().projects.some((project) => project.id === target.id),
          false,
          target,
        );
      case "conversation":
        if (context.chats.some((chat) => canOpenChat(chat, target.id)))
          return chatAction({ type: "select", id: target.id });
        if (!pending && context.runs.some((run) => run.record.id === target.id)) {
          const worker = context.runs.find((run) => run.record.id === target.id);
          if (!worker?.relay && !context.database) return false;
          return run(
            async (current) => {
              if ((await context.selectWorker(target.id, undefined, current)) === false)
                throw new Error("Unable to open conversation");
            },
            () => {
              reveal(target);
              read().onPage("chat");
            },
            false,
            () => read().runs.some((run) => run.record.id === target.id),
            false,
            target,
          );
        }
        return false;
    }
  };
  return {
    open,
    chatAction,
    projectAction: (request: ProjectAction) => run(async () => read().api.projectAction(request)),
    invalidate: () => {
      ++serial;
    },
  };
}

export function useNavigationActions(context: Context) {
  const mounted = useRef(true);
  const latest = useRef(context);
  latest.current = context;
  const [state, setState] = useState<{
    pending: boolean;
    /** Any navigation is in flight, including non-blocking selections that ignore new clicks. */
    busy: boolean;
    error: string;
    projectPending: boolean;
    destination?: NavigationTarget;
    expectedConversation?: NavigationTarget | undefined;
  }>({ pending: false, busy: false, error: "", projectPending: false });
  const [actions] = useState(() =>
    createNavigationActions(
      () => latest.current,
      (pending, error, projectPending, blocking = true) => {
        // Suspend selected details before project selection can publish a different owner.
        latest.current.onProjectPending?.(projectPending);
        if (mounted.current)
          setState((previous) => ({
            ...previous,
            pending: pending && blocking,
            busy: pending,
            projectPending,
            error: pending ? error : previous.error,
          }));
      },
      (destination) => {
        if (mounted.current)
          setState((previous) => ({
            ...previous,
            destination,
            expectedConversation:
              destination.kind === "custom-agent" || destination.kind === "conversation"
                ? destination
                : undefined,
          }));
      },
    ),
  );
  const expected = state.expectedConversation;
  // IPC completion can precede the app-stream selection update. Never expose the old composer.
  const conversationPending =
    expected?.kind === "custom-agent"
      ? !context.chats.some(
          (chat) =>
            chat.customAgentId === expected.id &&
            conversationId(chat) !== undefined &&
            conversationId(chat) === context.selectedId,
        )
      : expected?.kind === "conversation" && context.selectedId !== expected.id;
  useEffect(() => {
    if (expected && !conversationPending)
      setState((previous) =>
        previous.expectedConversation === expected
          ? { ...previous, expectedConversation: undefined }
          : previous,
      );
  }, [expected, conversationPending]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      actions.invalidate();
    };
  }, [actions]);
  return { ...actions, ...state, conversationPending };
}

export type NavigationActions = ReturnType<typeof useNavigationActions>;
