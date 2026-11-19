import { type ComponentProps, useLayoutEffect, useRef, useState } from "react";
import type { OpenProject, ProjectAction } from "../bridge/index.js";
import { AnchoredMenu } from "./anchored-menu.js";
import { ChatSidebar } from "./chat-sidebar.js";
import { Icon } from "./icons.js";
import { NavigationIcon } from "./navigation-icons.js";
import {
  conversationProject,
  type NavigationTarget,
  parentActivation,
  projectConversations,
} from "./navigation-tree.js";
import { pathLabel } from "./path-label.js";

type Props = ComponentProps<typeof ChatSidebar> & {
  projects: readonly OpenProject[];
  selectedProjectId: string | null | undefined;
  onProjectAction(request: ProjectAction): Promise<boolean>;
  homeProjectId: string | undefined;
  onProjectOpen(id: string): void;
  destination?: NavigationTarget | undefined;
};

export function ProjectChatSidebar({
  projects,
  selectedProjectId,
  onProjectAction,
  homeProjectId,
  onProjectOpen,
  ancestorsExpanded = true,
  destination,
  ...props
}: Props) {
  const [menu, setMenu] = useState<{ projectId: string; x: number; y: number } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(projects.map((project) => project.id)),
  );
  const known = useRef(new Set(projects.map((project) => project.id)));
  useLayoutEffect(() => {
    const live = new Set(projects.map((project) => project.id));
    const added = [...live].filter((id) => !known.current.has(id));
    known.current = live;
    setExpanded((current) => {
      if (!ancestorsExpanded) return current.size ? new Set() : current;
      const next = new Set([...current].filter((id) => live.has(id)));
      for (const id of added) next.add(id);
      return next.size === current.size && [...next].every((id) => current.has(id))
        ? current
        : next;
    });
  }, [projects, ancestorsExpanded]);
  const selectedProject = conversationProject(props.selectedId, projects, props.chats, props.runs);
  const previousSelection = useRef({ id: props.selectedId, serial: props.navigationSerial });
  // biome-ignore lint/correctness/useExhaustiveDependencies: Page activation alone must not reveal a stale project selection while navigating to Relay.
  useLayoutEffect(() => {
    const previous = previousSelection.current;
    previousSelection.current = { id: props.selectedId, serial: props.navigationSerial };
    const changed = previous.id !== props.selectedId || previous.serial !== props.navigationSerial;
    const matches = destination?.kind !== "conversation" || destination.id === props.selectedId;
    const reveal =
      homeProjectId ?? (props.open && changed && matches ? selectedProject : undefined);
    if (reveal)
      setExpanded((current) => (current.has(reveal) ? current : new Set([...current, reveal])));
  }, [selectedProject, props.selectedId, props.navigationSerial, homeProjectId]);
  const destinationProject =
    destination?.kind === "project"
      ? destination.id
      : destination?.kind === "conversation"
        ? conversationProject(destination.id, projects, props.chats, props.runs)
        : undefined;
  useLayoutEffect(() => {
    if (destination && destinationProject)
      setExpanded((current) =>
        current.has(destinationProject) ? current : new Set([...current, destinationProject]),
      );
  }, [destination, destinationProject]);
  return (
    <>
      {projects.map((project) => {
        const open = expanded.has(project.id);
        const panelId = `project-chats-${project.id}`;
        const name = pathLabel(project.path);
        const toggleProject = () => {
          if (props.pending) return;
          const next = parentActivation(homeProjectId === project.id, open);
          setExpanded((current) => {
            const result = new Set(current);
            if (next.expanded) result.add(project.id);
            else result.delete(project.id);
            return result;
          });
          if (next.navigate) onProjectOpen(project.id);
        };
        return (
          <section
            key={project.id}
            className="project-chat-group"
            aria-label={`Project ${project.path}`}
          >
            {/* biome-ignore lint/a11y/useSemanticElements: navigation controls, not a form fieldset. */}
            <div
              role="group"
              aria-label={`Project controls for ${project.path}`}
              className="project-chat-heading"
              data-project-selected={selectedProjectId === project.id}
              data-nav-active={homeProjectId === project.id}
              onClick={(event) => {
                if (event.target === event.currentTarget) toggleProject();
              }}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault();
                event.stopPropagation();
                setExpanded((current) => {
                  const next = new Set(current);
                  if (event.key === "ArrowLeft") next.delete(project.id);
                  else next.add(project.id);
                  return next;
                });
              }}
            >
              <button
                type="button"
                className="project-chat-name"
                id={`project-${project.id}`}
                title={project.path}
                aria-current={homeProjectId === project.id ? "page" : undefined}
                aria-expanded={open}
                aria-controls={`panel-project ${panelId}`}
                disabled={props.pending}
                onClick={toggleProject}
              >
                <span className="project-chat-label">
                  <NavigationIcon name="app-folder" />
                  <span className="project-chat-title">{name}</span>
                </span>
                {project.active && <span className="project-chat-activity">Active</span>}
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={`More for ${project.path}`}
                title={`More for ${project.path}`}
                aria-haspopup="menu"
                aria-expanded={menu?.projectId === project.id}
                disabled={props.pending}
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  setMenu({ projectId: project.id, x: rect.left, y: rect.bottom });
                }}
              >
                <Icon name="overflow-menu--horizontal" />
              </button>
            </div>
            <div
              id={panelId}
              className="project-chat-pages"
              hidden={!open}
              inert={!open}
              aria-hidden={!open}
            >
              <button
                type="button"
                className="project-session-new"
                aria-label={`New Session in ${name}`}
                title={`New Session in ${project.path}`}
                disabled={props.pending}
                onClick={() => void props.onAction?.({ type: "new", projectId: project.id })}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowLeft") return;
                  event.preventDefault();
                  event.stopPropagation();
                  setExpanded((current) => {
                    const next = new Set(current);
                    next.delete(project.id);
                    return next;
                  });
                  document.getElementById(`project-${project.id}`)?.focus();
                }}
              >
                <span className="navigation-icon" aria-hidden="true">
                  <Icon name="add" />
                </span>
                <span className="page-tab-label">New Session</span>
              </button>
              <ChatSidebar
                {...props}
                ancestorsExpanded={ancestorsExpanded && open}
                entries={projectConversations(project, props.chats, props.runs, props.selectedId)}
              />
            </div>
            {menu?.projectId === project.id && (
              <AnchoredMenu
                x={menu.x}
                y={menu.y}
                label={`Actions for ${project.path}`}
                onClose={() => setMenu(null)}
                items={[
                  {
                    label: "Stop folder",
                    run: () => void onProjectAction({ type: "stop-folder", projectId: project.id }),
                  },
                  {
                    label: "Close project",
                    run: () => void onProjectAction({ type: "close", projectId: project.id }),
                  },
                ]}
              />
            )}
          </section>
        );
      })}
    </>
  );
}
