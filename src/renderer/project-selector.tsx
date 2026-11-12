import type { ReactNode } from "react";
import type { DatabaseMode, ProjectEntry } from "../bridge/index.js";
import { Icon } from "./icons.js";
import { pathLabel } from "./path-label.js";

export interface ProjectSelectorProps {
  projects: readonly ProjectEntry[];
  database: string | null;
  busy: boolean;
  error: string;
  onConnect(mode: DatabaseMode): void;
  onOpen(path: string): void;
  onCreate(): void;
  onRemove(path: string): void;
  footerAction?: ReactNode;
}

/** Shared project controls for the startup sidebar and the in-app modal. */
export function ProjectSelector({
  projects,
  database,
  busy,
  error,
  onConnect,
  onOpen,
  onCreate,
  onRemove,
  footerAction,
}: ProjectSelectorProps) {
  return (
    <>
      {!database ? (
        <>
          <p className="muted">No database connected.</p>
          {/* biome-ignore lint/a11y/useSemanticElements: This group contains actions, not form inputs. */}
          <div className="button-group" role="group" aria-label="Database connection">
            <button type="button" disabled={busy} onClick={() => onConnect("open")}>
              Open existing database…
            </button>
            <button type="button" disabled={busy} onClick={() => onConnect("create")}>
              Create database…
            </button>
          </div>
        </>
      ) : projects.length > 0 ? (
        <ul className="project-list" aria-label="Recent projects">
          {projects.map((project) => (
            <li key={project.path} className="project-row">
              <button
                type="button"
                className="project-item"
                disabled={busy}
                onClick={() => onOpen(project.path)}
              >
                <strong>{pathLabel(project.path)}</strong>
                <span className="path">{project.path}</span>
              </button>
              <button
                type="button"
                className="project-remove"
                aria-label={`Remove ${pathLabel(project.path)} from history`}
                title={`Remove ${project.path} from history`}
                disabled={busy}
                onClick={() => onRemove(project.path)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No recent projects.</p>
      )}
      <button
        type="button"
        className="project-open-folder"
        disabled={busy || !database}
        onClick={onCreate}
      >
        <Icon name="add" />
        <span>Open Folder</span>
      </button>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {footerAction && <div className="modal-footer">{footerAction}</div>}
    </>
  );
}
