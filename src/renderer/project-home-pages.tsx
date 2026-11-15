import type { DesktopRun, OpenProject, OrchestrationChat } from "../bridge/index.js";
import type { NavigationActions } from "./navigation-actions.js";
import { NavigationHomePage } from "./navigation-home-page.js";
import { conversationNodes, projectConversations, projectNodes } from "./navigation-tree.js";
import { pathLabel } from "./path-label.js";

export function ProjectsHomePage({
  projects,
  navigation,
  onOpenProject,
  database,
}: {
  projects: readonly OpenProject[];
  navigation: NavigationActions;
  onOpenProject(): void;
  database: string | null;
}) {
  return (
    <NavigationHomePage
      page="projects"
      cards={projectNodes(projects)}
      onOpen={({ target }) => void navigation.open(target)}
      empty="No open projects"
      error={navigation.error}
      pending={navigation.pending}
      create={{
        label: "New Project",
        title: database ? "Open Project" : "Connect to database",
        onClick: onOpenProject,
      }}
    />
  );
}

export function ProjectHomePages({
  projects,
  chats,
  runs,
  selectedId,
  activeId,
  navigation,
}: {
  projects: readonly OpenProject[];
  chats: readonly OrchestrationChat[];
  runs: readonly DesktopRun[];
  selectedId: string | undefined;
  activeId: string | undefined;
  navigation: NavigationActions;
}) {
  return projects.map((project) => (
    <NavigationHomePage
      key={project.id}
      page="project"
      id={`project-${project.id}`}
      label={pathLabel(project.path)}
      hidden={activeId !== project.id}
      cards={conversationNodes(projectConversations(project, chats, runs, selectedId))}
      onOpen={({ target }) => void navigation.open(target)}
      empty="No conversations"
      error={navigation.error}
      pending={navigation.pending}
      create={{
        label: "New Chat",
        ariaLabel: `New chat in ${pathLabel(project.path)}`,
        onClick: () => void navigation.chatAction({ type: "new", projectId: project.id }),
      }}
    />
  ));
}
