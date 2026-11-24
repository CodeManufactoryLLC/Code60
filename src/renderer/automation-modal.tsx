import type { ReactNode } from "react";
import { Modal } from "./modal.js";
export function AutomationModal({
  title,
  onClose,
  children,
  returnFocus,
}: {
  title: string;
  onClose(): void;
  children: ReactNode;
  returnFocus?: HTMLButtonElement | null;
}) {
  return (
    <Modal wide passive title={title} busy={false} returnFocus={returnFocus} onClose={onClose}>
      <div className="carbon-scheduled-jobs carbon-job-modal-host">{children}</div>
    </Modal>
  );
}
