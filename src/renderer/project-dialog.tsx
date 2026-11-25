import { Button } from "@carbon/react";
import type { DatabaseMode, ProjectEntry } from "../bridge/index.js";
import { Button as AppButton } from "./carbon/button.js";
import { Icon } from "./icons.js";
import { Modal } from "./modal.js";
import { pathLabel } from "./path-label.js";

interface ProjectDialogProps {
  projects: readonly ProjectEntry[];
  database: string | null;
  busy: boolean;
  error: string;
  onConnect(mode: DatabaseMode): void;
  onOpen(path: string): void;
  onCreate(): void;
  onRemove(path: string): void;
  onClose(): void;
}

export function ProjectDialog({
  projects,
  database,
  busy,
  error,
  onConnect,
  onOpen,
  onCreate,
  onRemove,
  onClose,
}: ProjectDialogProps) {
  return (
    <Modal
      title="Open Project"
      busy={busy}
      size="sm"
      className="project-dialog"
      initialFocus=".project-item:enabled, .button-group button:enabled, .cds--modal-footer .cds--btn--primary:enabled"
      onClose={onClose}
      footer={
        <>
          <Button kind="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button kind="primary" disabled={busy || !database} onClick={onCreate}>
            Open Folder
          </Button>
        </>
      }
    >
      {!database ? (
        <>
          <p className="muted">No database connected.</p>
          {/* biome-ignore lint/a11y/useSemanticElements: This group contains actions, not form inputs. */}
          <div className="button-group" role="group" aria-label="Database connection">
            <AppButton type="button" disabled={busy} onClick={() => onConnect("open")}>
              Open existing database…
            </AppButton>
            <AppButton type="button" disabled={busy} onClick={() => onConnect("create")}>
              Create database…
            </AppButton>
          </div>
        </>
      ) : projects.length > 0 ? (
        <ul className="project-list" aria-label="Recent projects">
          {projects.map((project) => (
            <li key={project.path} className="project-row">
              <AppButton
                type="button"
                variant="quiet"
                className="project-item"
                disabled={busy}
                onClick={() => onOpen(project.path)}
              >
                <strong>{pathLabel(project.path)}</strong>
                <span className="path">{project.path}</span>
              </AppButton>
              <AppButton
                type="button"
                className="icon-button project-remove"
                aria-label={`Remove ${pathLabel(project.path)} from history`}
                title={`Remove ${project.path} from history`}
                disabled={busy}
                onClick={() => onRemove(project.path)}
              >
                <Icon name="close" />
              </AppButton>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No recent projects.</p>
      )}
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
    </Modal>
  );
}
