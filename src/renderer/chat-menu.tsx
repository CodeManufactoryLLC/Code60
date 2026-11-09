import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function ChatMenu({
  x,
  y,
  onAction,
  onClose,
}: {
  x: number;
  y: number;
  onAction(action: "open" | "rename" | "archive"): void;
  onClose(): void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const previous = document.activeElement;
    const rect = menu.current?.getBoundingClientRect();
    if (rect)
      setPosition({
        left: Math.max(8, Math.min(x, innerWidth - rect.width - 8)),
        top: Math.max(8, Math.min(y, innerHeight - rect.height - 8)),
      });
    menu.current?.querySelector("button")?.focus();
    let restore = true;
    const dismiss = () => {
      restore = false;
      close.current();
    };
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) dismiss();
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
      if (restore && previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [x, y]);
  return createPortal(
    <div
      ref={menu}
      className="actions-menu"
      role="menu"
      aria-label="Chat actions"
      style={position}
      onKeyDown={(event) => {
        event.stopPropagation();
        const buttons = [...(menu.current?.querySelectorAll("button") ?? [])];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (event.key === "Escape" || event.key === "Tab") {
          event.preventDefault();
          onClose();
        } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? buttons.length - 1
                : (index + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length;
          buttons[next]?.focus();
        }
      }}
    >
      {(["open", "rename", "archive"] as const).map((action) => (
        <button
          type="button"
          role="menuitem"
          key={action}
          onClick={() => {
            onClose();
            onAction(action);
          }}
        >
          <span className="chat-menu-label">
            {action[0]?.toUpperCase()}
            {action.slice(1)}
          </span>
        </button>
      ))}
    </div>,
    document.body,
  );
}
