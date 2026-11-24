import { ComposedModal, FeatureFlags, ModalBody, ModalHeader } from "@carbon/react";
import { type ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

/** Page-owned evidence only; shared server confirmations keep their existing owner.
 * Native Carbon dialogs preserve browser inertness and the application's dialog shortcut guards.
 */
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
  const launcher = useRef<HTMLButtonElement | null>(
    returnFocus ??
      (typeof document !== "undefined" && document.activeElement instanceof HTMLButtonElement
        ? document.activeElement
        : null),
  );
  useEffect(
    () => () => {
      const target = launcher.current;
      if (target?.isConnected && !target.closest("[inert], [hidden]")) target.focus();
    },
    [],
  );
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="carbon-scheduled-jobs carbon-job-modal-host">
      <FeatureFlags flags={{ "enable-dialog-element": true }}>
        <ComposedModal
          open
          size="lg"
          preventCloseOnClickOutside
          onClose={onClose}
          launcherButtonRef={launcher}
          className="carbon-job-modal"
          aria-label={title}
        >
          <ModalHeader title={title} closeModal={onClose} iconDescription={`Close ${title}`} />
          <ModalBody hasScrollingContent onBlur={(event) => event.stopPropagation()}>
            {children}
          </ModalBody>
        </ComposedModal>
      </FeatureFlags>
    </div>,
    document.body,
  );
}
