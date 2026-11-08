import { type ReactNode, useEffect, useId, useRef } from "react";
import { Icon } from "./icons.js";

export function Modal({
  title,
  busy,
  wide = false,
  className = "",
  onClose,
  children,
}: {
  title: string;
  busy: boolean;
  wide?: boolean;
  className?: string;
  onClose(): void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.showModal();
    return () => previous?.focus();
  }, []);
  return (
    <dialog
      ref={dialog}
      className={`setup-dialog ${wide ? "changes-dialog" : "picker-dialog"} ${className}`}
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="modal-heading">
        <h2 id={id}>{title}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label={`Close ${title}`}
          disabled={busy}
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
