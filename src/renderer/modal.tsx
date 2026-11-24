import { ComposedModal, FeatureFlags, ModalBody, ModalHeader } from "@carbon/react";
import {
  type KeyboardEventHandler,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import { createPortal } from "react-dom";

/** Backend-owned decisions keep their existing callbacks and busy refusal. */
export function Modal({
  title,
  busy,
  wide = false,
  className = "",
  initialFocus,
  onKeyDown,
  onKeyDownCapture,
  closeLabel,
  focusHeading = false,
  onClose,
  children,
}: {
  title: string;
  busy: boolean;
  wide?: boolean;
  className?: string;
  initialFocus?: string;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  onKeyDownCapture?: KeyboardEventHandler<HTMLDivElement>;
  closeLabel?: string;
  focusHeading?: boolean;
  onClose(): void;
  children: ReactNode;
}) {
  const header = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // ModalHeader does not expose a disabled prop for its owned close control.
    const close = header.current?.querySelector("button");
    if (close) close.disabled = busy;
  }, [busy]);
  useEffect(() => {
    if (!focusHeading) return;
    const heading = header.current?.querySelector("h2");
    if (heading?.textContent === title) {
      heading.tabIndex = -1;
      heading.focus();
    }
  }, [title, focusHeading]);
  useEffect(() => {
    if (initialFocus)
      header.current
        ?.closest(".cds--modal-container")
        ?.querySelector<HTMLElement>(initialFocus)
        ?.focus();
  }, [initialFocus]);
  const previous = useRef<HTMLElement | null>(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  useEffect(
    () => () => {
      const target = previous.current;
      if (target?.isConnected && !target.closest("[hidden], [inert]")) target.focus();
    },
    [],
  );
  const modal = (
    <FeatureFlags flags={{ "enable-dialog-element": true }}>
      <ComposedModal
        open
        {...(onKeyDown ? { onKeyDown } : {})}
        {...(onKeyDownCapture ? { onKeyDownCapture } : {})}
        preventCloseOnClickOutside
        size={wide ? "lg" : "md"}
        className="code60-modal"
        containerClassName={className}
        aria-label={title}
        aria-busy={busy}
        selectorPrimaryFocus="input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [data-modal-primary-focus]"
        onClose={() => {
          if (busy) return false;
          onClose();
        }}
      >
        <ModalHeader ref={header} title={title} iconDescription={closeLabel ?? `Close ${title}`} />
        {/* Carbon 1.121's outer blur handler centers the next field during pointerdown,
          cancelling clicks. Child blur handlers still run; native dialog focus scrolls. */}
        <ModalBody hasScrollingContent onBlur={(event) => event.stopPropagation()}>
          {children}
        </ModalBody>
      </ComposedModal>
    </FeatureFlags>
  );
  return typeof document === "undefined" ? modal : createPortal(modal, document.body);
}
