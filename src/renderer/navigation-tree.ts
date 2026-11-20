import type { DesktopRun, OpenProject, OrchestrationChat } from "../bridge/index.js";
import { conversationId, conversations } from "./chats.js";
import {
  type PageId,
  type ParentPageId,
  pageAvailable,
  pageDefinitions,
  pages,
  parentPageIds,
  type SettingsSectionId,
  settingsIcons,
  settingsLabels,
  settingsSectionIds,
} from "./navigation.js";
import type { NavigationIconName } from "./navigation-icons.js";
import { pathLabel } from "./path-label.js";

export type NavigationTarget =
  | { kind: "provider"; id: string }
  | { kind: "custom-agent"; id: string }
  | { kind: "page"; id: PageId }
  | { kind: "settings"; id: SettingsSectionId }
  | { kind: "project"; id: string }
  | { kind: "conversation"; id: string };

export interface NavigationNode {
  id: string;
  label: string;
  icon?: NavigationIconName | undefined;
  available: boolean;
  reason?: string;
  title?: string;
  target: NavigationTarget;
}

export function navigationParent(id: PageId): ParentPageId | undefined {
  const page = pageDefinitions[id];
  if (page.parent) return page.parent;
  switch (page.group) {
    case "apps":
    case "tables":
    case "advanced":
    case "experiments":
      return page.group;
    default:
      return undefined;
  }
}

export function inNavigationBranch(id: PageId, parent: ParentPageId): boolean {
  if (id === parent) return true;
  const owner = navigationParent(id);
  return owner !== undefined && inNavigationBranch(owner, parent);
}

export function staticChildren(parent: ParentPageId, database: string | null): NavigationNode[] {
  const nodes: NavigationNode[] = pages
    .filter(({ id }) => !pageDefinitions[id].internal && navigationParent(id) === parent)
    .map(({ id }) => ({
      id,
      label: pageDefinitions[id].label,
      icon: pageDefinitions[id].icon,
      available: pageAvailable(id, database),
      ...(!pageAvailable(id, database) ? { reason: "Connect to a database first" } : {}),
      target: { kind: "page", id },
    }));
  if (parent === "settings")
    for (const id of settingsSectionIds)
      nodes.push({
        id,
        label: settingsLabels[id],
        icon: settingsIcons[id],
        available: true,
        target: { kind: "settings", id },
      });
  return nodes.sort((a, b) => a.label.localeCompare(b.label));
}

export function projectNodes(projects: readonly OpenProject[]): NavigationNode[] {
  return projects.map((project) => ({
    id: project.id,
    label: pathLabel(project.path),
    title: project.path,
    icon: "app-folder",
    available: true,
    target: { kind: "project", id: project.id },
  }));
}

export function projectConversations(
  project: OpenProject,
  chats: readonly OrchestrationChat[],
  runs: readonly DesktopRun[],
  selectedId?: string,
) {
  const workers = new Set(project.workerIds);
  return conversations(
    chats.filter((chat) => chat.projectId === project.id),
    runs.filter((run) => !run.relay && workers.has(run.record.id)),
    selectedId,
  );
}

export function conversationProject(
  id: string | undefined,
  projects: readonly OpenProject[],
  chats: readonly OrchestrationChat[],
  runs: readonly DesktopRun[],
): string | undefined {
  if (!id) return;
  const chat = chats.find((chat) => conversationId(chat) === id);
  if (chat?.kind === "relay" || runs.some((run) => run.record.id === id && run.relay)) return;
  return chat?.projectId ?? projects.find((project) => project.workerIds.includes(id))?.id;
}

export function conversationNodes(entries: ReturnType<typeof conversations>): NavigationNode[] {
  return entries
    .filter((entry) => !entry.parentId)
    .map((entry) => ({
      id: entry.id,
      label: entry.label,
      icon: entry.role === "orchestrator" ? "app-communication" : "app-down-right",
      available: true,
      target: { kind: "conversation", id: entry.id },
    }));
}

export function parentActivation(active: boolean, expanded: boolean) {
  return { navigate: !active, expanded: active ? !expanded : true };
}

export function isNavigationHome(id: PageId) {
  return (
    id === "home" ||
    id === "project" ||
    id === "provider" ||
    parentPageIds.some((parent) => parent === id)
  );
}

export function sidebarPageElementId(id: PageId, projectId?: string, providerId?: string) {
  if (id === "provider") return providerId ? `provider-${providerId}` : "tab-providers";
  if (id === "project") return projectId ? `project-${projectId}` : "tab-chat";
  if (id === "projects") return "tab-chat";
  if (id === "tables" || id === "advanced" || id === "experiments") return `${id}-toggle`;
  return `tab-${id}`;
}
