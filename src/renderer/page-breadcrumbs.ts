import type { DesktopRun, OpenProject, OrchestrationChat } from "../bridge/index.js";
import { conversationId, conversations, conversationTitle } from "./chats.js";
import {
  isSettingsSection,
  type PageId,
  pageDefinitions,
  type SettingsSectionId,
} from "./navigation.js";
import type { NavigationIconName } from "./navigation-icons.js";
import { type NavigationTarget, navigationParent } from "./navigation-tree.js";
import { pathLabel } from "./path-label.js";

export type PageTitleId = PageId | SettingsSectionId | "relay" | "orchestrator" | "worker";
interface Breadcrumb {
  label: string;
  icon?: NavigationIconName | undefined;
  target: NavigationTarget;
}
export interface BreadcrumbSource {
  projects: readonly OpenProject[];
  chats: readonly OrchestrationChat[];
  runs: readonly DesktopRun[];
}

const pageCrumb = (id: PageId): Breadcrumb => ({
  label: pageDefinitions[id].label,
  icon: pageDefinitions[id].icon,
  target: { kind: "page", id },
});

export function breadcrumbAncestors(
  page: PageTitleId,
  source: BreadcrumbSource,
  target?: NavigationTarget,
): Breadcrumb[] {
  return page === "home" ? [] : [pageCrumb("home"), ...pageAncestors(page, source, target)];
}

function pageAncestors(
  page: PageTitleId,
  source: BreadcrumbSource,
  target?: NavigationTarget,
): Breadcrumb[] {
  if (isSettingsSection(page)) return [pageCrumb("settings")];
  if (page === "project") return [pageCrumb("projects")];
  if (page === "relay") return [];
  if (page !== "orchestrator" && page !== "worker") {
    const parent = navigationParent(page);
    return parent ? [...pageAncestors(parent, source), pageCrumb(parent)] : [];
  }
  if (target?.kind !== "conversation") return [];
  const run = source.runs.find((run) => run.record.id === target.id);
  const entry = conversations(source.chats, source.runs, target.id).find(
    (entry) => entry.id === target.id,
  );
  const ownerId = page === "worker" ? entry?.parentId : target.id;
  const owner = ownerId
    ? source.chats.find((chat) => !chat.archived && conversationId(chat) === ownerId)
    : undefined;
  const project =
    run?.relay || owner?.kind === "relay"
      ? undefined
      : source.projects.find((project) =>
          owner?.projectId ? project.id === owner.projectId : project.workerIds.includes(target.id),
        );
  const ancestors: Breadcrumb[] = owner?.customAgentId
    ? [pageCrumb("custom-agents")]
    : project
      ? [
          pageCrumb("projects"),
          {
            label: pathLabel(project.path),
            icon: "app-folder",
            target: { kind: "project", id: project.id },
          },
        ]
      : [];
  if (page === "worker") {
    const chat =
      owner ??
      (run?.relay &&
        source.chats.find(
          (chat) => chat.kind === "relay" && chat.conversationId === run.relay?.conversationId,
        ));
    const id = chat && !chat.archived ? conversationId(chat) : undefined;
    if (chat && id)
      ancestors.push({
        label: conversationTitle(source.chats, chat),
        icon: chat.kind === "relay" ? "app-steering-wheel" : "app-communication",
        target: { kind: "conversation", id },
      });
  }
  return ancestors;
}
