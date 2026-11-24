import type { DatabaseMode } from "../bridge/index.js";
import { Button as AppButton } from "./carbon/button.js";
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
        <AppButton type="button" disabled={busy} onClick={onClose}>
          Cancel
        </AppButton>
        {/* biome-ignore lint/a11y/useSemanticElements: a fieldset would add form semantics and its own frame to a row of buttons. */}
        <div className="button-group" role="group" aria-label="Database">
          <AppButton type="button" disabled={busy} onClick={() => onChoose("open")}>
            Open existing database…
          </AppButton>
          <AppButton
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => onChoose("create")}
          >
            Create database…
          </AppButton>
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
          <AppButton type="button" disabled={props.busy} onClick={onClose}>
            Cancel
          </AppButton>
        }
      />
    </Modal>
  );
}
