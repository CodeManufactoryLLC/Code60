import { type ComponentProps, useLayoutEffect, useRef, useState } from "react";
import type { OpenProject, ProjectAction } from "../bridge/index.js";
import { ChatSidebar } from "./chat-sidebar.js";
import { Icon } from "./icons.js";
import { pathLabel } from "./path-label.js";

type Props = ComponentProps<typeof ChatSidebar> & {
  projects: readonly OpenProject[];
  selectedProjectId: string | null | undefined;
  onProjectAction(request: ProjectAction): Promise<boolean>;
};

export function ProjectChatSidebar({
  projects,
  selectedProjectId,
  onProjectAction,
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
  const selectedProject =
    props.chats.find((chat) => chat.run?.id === props.selectedId)?.projectId ??
    projects.find((project) => project.workerIds.includes(props.selectedId ?? ""))?.id;
  // biome-ignore lint/correctness/useExhaustiveDependencies: New or explicit same-project destinations must reveal their manually collapsed ancestor.
  useLayoutEffect(() => {
    if (selectedProject)
      setExpanded((current) =>
        current.has(selectedProject) ? current : new Set([...current, selectedProject]),
      );
  }, [selectedProject, props.selectedId, props.navigationSerial]);
  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <>
      <ChatSidebar
        {...props}
        chats={props.chats.filter((chat) => chat.kind !== "project")}
        runs={props.runs.filter((run) => run.relay)}
      />
      {projects.map((project) => {
        const open = expanded.has(project.id);
        const name = pathLabel(project.path);
        const menuId = `project-menu-${project.id}`;
        const action = (type: "close" | "stop-folder") => {
          document.getElementById(menuId)?.hidePopover();
          void onProjectAction({ type, projectId: project.id });
        };
        const workerIds = new Set(project.workerIds);
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
                className="icon-button"
                aria-label={`Toggle chats for ${project.path}`}
                aria-expanded={open}
                aria-controls={`project-chats-${project.id}`}
                onClick={() => toggle(project.id)}
              >
                <Icon name={open ? "chevron--down" : "chevron--right"} />
              </button>
              <button
                type="button"
                className="project-chat-name"
                title={project.path}
                aria-current={selectedProjectId === project.id || undefined}
                disabled={props.pending}
                onClick={() => void onProjectAction({ type: "select", projectId: project.id })}
              >
                <span>{name}</span>
                {project.active && <span className="project-chat-activity">Active</span>}
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={`New chat in ${name}`}
                title={`New chat in ${project.path}`}
                disabled={props.pending}
                onClick={() => void props.onAction?.({ type: "new", projectId: project.id })}
              >
                <Icon name="add" />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={`More for ${project.path}`}
                title={`More for ${project.path}`}
                popoverTarget={menuId}
                aria-haspopup="menu"
                disabled={props.pending}
              >
                <Icon name="overflow-menu--horizontal" />
              </button>
              <div
                id={menuId}
                popover="auto"
                className="project-chat-menu"
                role="menu"
                aria-label={`Actions for ${project.path}`}
              >
                <button type="button" role="menuitem" onClick={() => action("stop-folder")}>
                  Stop folder
                </button>
                <button type="button" role="menuitem" onClick={() => action("close")}>
                  Close project
                </button>
              </div>
            </div>
            <div
              id={`project-chats-${project.id}`}
              className="project-chat-pages"
              hidden={!open}
              inert={!open}
            >
              <ChatSidebar
                {...props}
                chats={props.chats.filter((chat) => chat.projectId === project.id)}
                runs={props.runs.filter((run) => !run.relay && workerIds.has(run.record.id))}
              />
            </div>
          </section>
        );
      })}
    </>
  );
}
