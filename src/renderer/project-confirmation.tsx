import { Modal } from "./modal.js";
import { pathLabel } from "./path-label.js";

export function ProjectConfirmation({
  path,
  busy,
  blocked,
  error,
  onCancel,
  onConfirm,
}: {
  path: string;
  busy: boolean;
  blocked: boolean;
  error: string;
  onCancel(): void;
  onConfirm(): void;
}) {
  return (
    <Modal title="Open project?" className="project-confirmation" busy={busy} onClose={onCancel}>
      <p>Open {pathLabel(path)}?</p>
      <p className="project-confirmation-path">{path}</p>
      {blocked && <p>Finish or stop all runs before switching projects.</p>}
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <div className="modal-footer">
        <button type="button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="primary" disabled={busy || blocked} onClick={onConfirm}>
          Open project
        </button>
      </div>
    </Modal>
  );
}
