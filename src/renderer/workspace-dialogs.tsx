import type { DatabaseMode } from "../bridge/index.js";
import { Button as AppButton } from "./carbon/button.js";
import { Modal } from "./modal.js";
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
    <Modal
      size="sm"
      initialFocus=".database-choices button"
      title="Select database"
      busy={busy}
      onClose={onClose}
    >
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
      <div className="database-choices">
        <AppButton disabled={busy} onClick={() => onChoose("open")}>
          Open existing database…
        </AppButton>
        <AppButton disabled={busy} onClick={() => onChoose("create")}>
          Create database…
        </AppButton>
      </div>
    </Modal>
  );
}
