import { type ComponentProps, useLayoutEffect, useRef, useState } from "react";
import type { OpenProject, ProjectAction } from "../bridge/index.js";
import { AnchoredMenu } from "./anchored-menu.js";
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
        chats={props.chats.filter((chat) => chat.kind === "relay")}
        runs={props.runs.filter((run) => run.relay)}
      />
      {projects.map((project) => {
        const open = expanded.has(project.id);
        const name = pathLabel(project.path);
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
              <button
                type="button"
                className="icon-button project-chats-toggle"
                aria-label={`Toggle chats for ${project.path}`}
                aria-expanded={open}
                aria-controls={`project-chats-${project.id}`}
                onClick={() => toggle(project.id)}
              >
                <Icon name={open ? "chevron--down" : "chevron--right"} />
              </button>
            </div>
            <div
              id={`project-chats-${project.id}`}
              className="project-chat-pages"
              hidden={!open}
              inert={!open}
              aria-hidden={!open}
            >
              <ChatSidebar
                {...props}
                chats={props.chats.filter((chat) => chat.projectId === project.id)}
                runs={props.runs.filter((run) => !run.relay && workerIds.has(run.record.id))}
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
