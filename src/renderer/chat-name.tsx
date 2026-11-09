import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function RenameChat({
  title,
  onSave,
  onClose,
}: {
  title: string;
  onSave(title: string): Promise<boolean>;
  onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(title);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    dialog.current?.querySelector("input")?.select();
    return () => {
      dialog.current?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return createPortal(
    <dialog ref={dialog} aria-label="Rename chat" onCancel={onClose}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending || !value.trim()) return;
          setPending(true);
          setError("");
          try {
            if (await onSave(value.trim())) onClose();
            else setError("Could not rename this chat. Try again.");
          } finally {
            setPending(false);
          }
        }}
      >
        <h2>Rename chat</h2>
        <label>
          Chat name
          <input
            value={value}
            maxLength={120}
            required
            disabled={pending}
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <div className="button-group">
          <button type="button" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="submit" disabled={pending || !value.trim()}>
            Save
          </button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}
