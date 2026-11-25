import { ComposedModal, FeatureFlags, ModalBody, ModalFooter, ModalHeader } from "@carbon/react";
import {
  createContext,
  type FocusEvent,
  type KeyboardEventHandler,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

// Carbon 1.121 centers the next control on blur, which can move it between
// pointerdown and click. Native dialog focus already scrolls controls into view.
const sectionFocusProps = {
  onBlur(event: FocusEvent<HTMLElement>) {
    event.stopPropagation();
  },
};

const FooterTarget = createContext<HTMLElement | null>(null);

/** Keep editor-owned validation beside its form while rendering actions in the modal footer. */
export function ModalActions({ children }: { children: ReactNode }) {
  const target = useContext(FooterTarget);
  return target ? createPortal(children, target) : children;
}

/** Backend-owned decisions keep their existing callbacks and busy refusal. */
export function Modal({
  title,
  busy,
  wide = false,
  size = wide ? "lg" : "md",
  footer,
  editorFooter = false,
  className = "",
  passive = false,
  returnFocus,
  initialFocus,
  onKeyDown,
  onKeyDownCapture,
  closeLabel,
  onClose,
  children,
}: {
  title: string;
  busy: boolean;
  wide?: boolean;
  size?: "sm" | "md" | "lg";
  editorFooter?: boolean;
  footer?: ReactNode;
  className?: string;
  passive?: boolean;
  returnFocus?: HTMLElement | null | undefined;
  initialFocus?: string | undefined;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  onKeyDownCapture?: KeyboardEventHandler<HTMLDivElement>;
  closeLabel?: string;
  onClose(): void;
  children: ReactNode;
}) {
  const [footerTarget, setFooterTarget] = useState<HTMLElement | null>(null);
  const header = useRef<HTMLDivElement>(null);
  const lastFocused = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    // ModalHeader does not expose a disabled prop for its owned close control.
    const close = header.current?.querySelector("button");
    if (close) close.disabled = busy;
    // Opening a host chooser disables its launcher before the server returns the nested dialog.
    if (!busy && lastFocused.current) {
      const frame = requestAnimationFrame(() => {
        const dialog = header.current?.closest("dialog");
        const target = lastFocused.current;
        if (
          dialog?.matches(":modal") &&
          target &&
          dialog.contains(target) &&
          (document.activeElement === document.body || document.activeElement === dialog)
        )
          target.focus();
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [busy]);
  useEffect(() => {
    const container = header.current?.closest("dialog");
    if (!container) return;
    const field =
      "input:not([type=hidden], :disabled), textarea:not(:disabled), select:not(:disabled)";
    const target =
      (initialFocus && container.querySelector<HTMLElement>(initialFocus)) ||
      container.querySelector<HTMLElement>(
        ".cds--modal-footer:has(.cds--btn--danger) .cds--btn--secondary:not(:disabled)",
      ) ||
      container.querySelector<HTMLElement>(field) ||
      container.querySelector<HTMLElement>(
        ".cds--modal-footer .cds--btn--primary:not(:disabled), [data-modal-primary-focus]:not(:disabled)",
      ) ||
      container.querySelector<HTMLElement>(".cds--modal-close");
    target?.focus();
  }, [initialFocus]);
  const previous = useRef<HTMLElement | null>(
    returnFocus ??
      (typeof document !== "undefined" && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null),
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
        onFocusCapture={(event) => {
          if (
            event.target instanceof HTMLElement &&
            event.target.closest("dialog") === header.current?.closest("dialog")
          )
            lastFocused.current = event.target;
        }}
        preventCloseOnClickOutside={!passive || busy}
        size={size}
        className="code60-modal"
        containerClassName={className}
        aria-label={title}
        aria-busy={busy}
        selectorPrimaryFocus="input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [data-modal-primary-focus]"
        onClose={() => {
          if (busy) return false;
          onClose();
          return false;
        }}
      >
        <ModalHeader
          {...sectionFocusProps}
          ref={header}
          title={title}
          iconDescription={closeLabel ?? `Close ${title}`}
        />
        <ModalBody hasScrollingContent {...sectionFocusProps}>
          {editorFooter ? (
            <FooterTarget.Provider value={footerTarget}>{children}</FooterTarget.Provider>
          ) : (
            children
          )}
        </ModalBody>
        {(footer || editorFooter) && (
          <ModalFooter {...sectionFocusProps} ref={editorFooter ? setFooterTarget : undefined}>
            {footer}
          </ModalFooter>
        )}
      </ComposedModal>
    </FeatureFlags>
  );
  return typeof document === "undefined" ? modal : createPortal(modal, document.body);
}
