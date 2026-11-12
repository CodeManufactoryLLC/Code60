import type { DatabaseMode } from "../bridge/index.js";
import { Modal } from "./modal.js";
import { ProjectSelector, type ProjectSelectorProps } from "./project-selector.js";
export function DatabaseDialog({
  database,
  busy,
  error,
  onClose,
  onChoose,
}: {
  database: string | null;
  busy: boolean;
  error: string;
  onClose(): void;
  onChoose(mode: DatabaseMode): void;
}) {
  return (
    <Modal title="Select database" busy={busy} onClose={onClose}>
      {database && (
        <p className="muted">
          Connected to <span className="connected-path">{database}</span>
        </p>
      )}
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <div className="modal-footer">
        <button type="button" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        {/* biome-ignore lint/a11y/useSemanticElements: a fieldset would add form semantics and its own frame to a row of buttons. */}
        <div className="button-group" role="group" aria-label="Database">
          <button type="button" disabled={busy} onClick={() => onChoose("open")}>
            Open existing database…
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => onChoose("create")}
          >
            Create database…
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function ProjectDialog({
  onClose,
  ...props
}: Omit<ProjectSelectorProps, "footerAction"> & { onClose(): void }) {
  return (
    <Modal title="Open Project" busy={props.busy} className="project-dialog" onClose={onClose}>
      <ProjectSelector
        {...props}
        footerAction={
          <button type="button" disabled={props.busy} onClick={onClose}>
            Cancel
          </button>
        }
      />
    </Modal>
  );
}
