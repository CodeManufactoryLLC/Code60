import { useEffect, useRef, useState } from "react";
import type {
  DesktopApi,
  DesktopRun,
  OpenProject,
  OrchestrationChat,
  OrchestrationChatAction,
  ProjectAction,
} from "../bridge/index.js";
import { conversationId } from "./chats.js";
import type { PageId, SettingsSectionId } from "./navigation.js";
import type { NavigationTarget } from "./navigation-tree.js";
import type { PageTabs } from "./tabs.js";

interface Context {
  api: DesktopApi;
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
  status: (pending: boolean, error: string, projectPending: boolean) => void,
) {
  let pending = false;
  let serial = 0;
  const scope = () => JSON.stringify([read().database, read().databaseEpoch]);
  async function run(
    operation: (current: () => boolean) => Promise<void>,
    success?: () => void,
    projectPending = false,
    valid: () => boolean = () => true,
  ) {
    if (pending) return false;
    pending = true;
    const ticket = ++serial;
    const owner = scope();
    const destination = read().tabs;
    const current = () =>
      ticket === serial && owner === scope() && read().tabs === destination && valid();
    status(true, "", projectPending);
    try {
      await operation(current);
      if (!current()) return false;
      success?.();
      return true;
    } catch (cause) {
      if (current())
        status(true, cause instanceof Error ? cause.message : String(cause), projectPending);
      return false;
    } finally {
      pending = false;
      status(false, "", false);
    }
  }
  const chatAction = (request: OrchestrationChatAction) => {
    const before = read();
    const relay = before.chats.find((chat) => chat.kind === "relay");
    const relayId = relay && conversationId(relay);
    const id = "id" in request ? request.id : undefined;
    if (!before.database && !(request.type === "select" && id === relayId))
      return Promise.resolve(false);
    const archiveCurrent =
      request.type === "archive" && id === before.selectedId && before.tabs.active === "chat";
    return run(
      async (current) => {
        await before.api.orchestrationChatAction(request);
        if (archiveCurrent && relayId && current())
          await before.api.orchestrationChatAction({ type: "select", id: relayId });
      },
      () => {
        if (archiveCurrent) {
          read().onArchived();
          read().selectWorker(undefined, null);
          read().onPage("chat");
        } else if (request.type === "select" || request.type === "new") {
          const projectId =
            request.type === "new"
              ? request.projectId
              : before.chats.find((chat) => conversationId(chat) === request.id)?.projectId;
          read().selectWorker(undefined, projectId ?? null);
          read().onPage("chat");
        }
      },
      false,
      () => {
        if (request.type === "select")
          return read().chats.some((chat) => conversationId(chat) === request.id && !chat.archived);
        if (request.type === "new" && request.projectId)
          return read().projects.some((project) => project.id === request.projectId);
        return true;
      },
    );
  };
  const open = async (target: NavigationTarget) => {
    const context = read();
    switch (target.kind) {
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
            if (read().projects.some((project) => project.id === target.id))
              read().onProject(target.id);
          },
          true,
          () => read().projects.some((project) => project.id === target.id),
        );
      case "conversation":
        if (context.chats.some((chat) => !chat.archived && conversationId(chat) === target.id))
          return chatAction({ type: "select", id: target.id });
        if (!pending && context.runs.some((run) => run.record.id === target.id)) {
          const worker = context.runs.find((run) => run.record.id === target.id);
          if (!worker?.relay && !context.database) return false;
          return run(
            async (current) => {
              if ((await context.selectWorker(target.id, undefined, current)) === false)
                throw new Error("Unable to open conversation");
            },
            () => read().onPage("chat"),
            false,
            () => read().runs.some((run) => run.record.id === target.id),
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
  const [state, setState] = useState({ pending: false, error: "", projectPending: false });
  const [actions] = useState(() =>
    createNavigationActions(
      () => latest.current,
      (pending, error, projectPending) => {
        // Suspend selected details before project selection can publish a different owner.
        latest.current.onProjectPending?.(projectPending);
        if (mounted.current)
          setState((previous) => ({
            pending,
            projectPending,
            error: pending ? error : previous.error,
          }));
      },
    ),
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      actions.invalidate();
    };
  }, [actions]);
  return { ...actions, ...state };
}

export type NavigationActions = ReturnType<typeof useNavigationActions>;
