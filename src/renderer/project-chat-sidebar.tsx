import { type ComponentProps, useLayoutEffect, useRef, useState } from "react";
import type { OpenProject, ProjectAction } from "../bridge/index.js";
import { Button as AppButton } from "./carbon/button.js";
import { ChatSidebar } from "./chat-sidebar.js";
import { Icon } from "./icons.js";
import { NavigationIcon } from "./navigation-icons.js";
import { projectConversations } from "./navigation-tree.js";
import { pathLabel } from "./path-label.js";

type Props = ComponentProps<typeof ChatSidebar> & {
  projects: readonly OpenProject[];
  selectedProjectId: string | null | undefined;
  onProjectAction(request: ProjectAction): Promise<boolean>;
  homeProjectId: string | undefined;
  onProjectOpen(id: string): void;
};

export function ProjectChatSidebar({
  projects,
  selectedProjectId,
  onProjectAction,
  homeProjectId,
  onProjectOpen,
  ancestorsExpanded = true,
  ...props
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(projects.map((project) => project.id)),
  );
  const known = useRef(new Set(projects.map((project) => project.id)));
  useLayoutEffect(() => {
    const live = new Set(projects.map((project) => project.id));
    const added = [...live].filter((id) => !known.current.has(id));
    known.current = live;
    setExpanded((current) => {
      const next = new Set([...current].filter((id) => live.has(id)));
      for (const id of added) next.add(id);
      return next.size === current.size && [...next].every((id) => current.has(id))
        ? current
        : next;
    });
  }, [projects]);
  return (
    <>
      {projects.map((project) => {
        const open = expanded.has(project.id);
        const panelId = `project-chats-${project.id}`;
        const name = pathLabel(project.path);
        const setOpen = (value: boolean) => {
          setExpanded((current) => {
            const next = new Set(current);
            if (value) next.add(project.id);
            else next.delete(project.id);
            return next;
          });
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
              onKeyDown={(event) => {
                // Row navigation never changes this project's disclosure.
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                  event.preventDefault();
                  event.stopPropagation();
                }
              }}
            >
              <AppButton
                type="button"
                className="project-chat-name"
                id={`project-${project.id}`}
                title={project.path}
                aria-current={homeProjectId === project.id ? "page" : undefined}
                aria-controls="panel-project"
                disabled={props.pending}
                onClick={() => onProjectOpen(project.id)}
              >
                <span className="project-chat-label">
                  <NavigationIcon name="app-folder" />
                  <span className="project-chat-title">{name}</span>
                </span>
                {project.active && <span className="project-chat-activity">Active</span>}
              </AppButton>
              <AppButton
                type="button"
                className="icon-button project-session-add"
                aria-label={`New Session in ${name}`}
                title={`New Session in ${project.path}`}
                data-tooltip="New Session"
                disabled={props.pending}
                onClick={() => void props.onAction?.({ type: "new", projectId: project.id })}
              >
                <span className="sidebar-card-add" aria-hidden="true">
                  <Icon name="add" />
                </span>
              </AppButton>
              <AppButton
                type="button"
                className="icon-button project-folder-stop"
                aria-label={`Close Project: ${project.path}`}
                title="Close Project"
                data-tooltip="Close Project"
                disabled={props.pending}
                onClick={() => void onProjectAction({ type: "stop-folder", projectId: project.id })}
              >
                <span className="sidebar-card-stop" aria-hidden="true">
                  <Icon name="close" />
                </span>
              </AppButton>
              <AppButton
                type="button"
                className="icon-button project-chat-toggle"
                id={`project-toggle-${project.id}`}
                aria-label={`${open ? "Collapse" : "Expand"} project ${project.path}`}
                aria-expanded={open}
                aria-controls={panelId}
                data-tooltip=""
                onClick={() => setOpen(!open)}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                  event.preventDefault();
                  event.stopPropagation();
                  setOpen(event.key === "ArrowRight");
                }}
              >
                <span className="sidebar-card-chevron" aria-hidden="true">
                  <Icon name="chevron--down" />
                </span>
              </AppButton>
            </div>
            <div
              id={panelId}
              className="project-chat-pages"
              hidden={!open}
              inert={!open}
              aria-hidden={!open}
            >
              <ChatSidebar
                {...props}
                ancestorsExpanded={ancestorsExpanded && open}
                entries={projectConversations(project, props.chats, props.runs, props.selectedId)}
              />
            </div>
          </section>
        );
      })}
    </>
  );
}
