import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { menuAnchorMoved } from "./menu-anchor.js";

export function AnchoredMenu({
  x,
  y,
  label,
  items,
  onClose,
  id,
  align = "start",
  initialFocus = "first",
  appearance,
  anchor,
}: {
  x: number;
  y: number;
  label: string;
  items: readonly { label: string; run(): void }[];
  onClose(): void;
  id?: string;
  align?: "start" | "end";
  initialFocus?: "first" | "last";
  appearance?: "neobrutalism";
  anchor?: HTMLElement | null;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const previous = anchor ?? document.activeElement;
    const bounds = previous instanceof HTMLElement ? previous.getBoundingClientRect() : undefined;
    const rect = menu.current?.getBoundingClientRect();
    if (rect)
      setPosition({
        left: Math.max(
          8,
          Math.min(align === "end" ? x - rect.width : x, innerWidth - rect.width - 8),
        ),
        top: Math.max(8, Math.min(y, innerHeight - rect.height - 8)),
      });
    menu.current
      ?.querySelector<HTMLButtonElement>(initialFocus === "last" ? "button:last-child" : "button")
      ?.focus({ preventScroll: true });
    let restore = true;
    const dismiss = () => {
      restore = false;
      close.current();
    };
    const outside = (event: Event) => {
      if (
        event.type === "pointerdown" &&
        event.target instanceof Node &&
        anchor?.contains(event.target)
      )
        return;
      // A scroll queued before opening is not movement of this menu's anchor.
      if (
        event.type === "scroll" &&
        bounds &&
        previous instanceof HTMLElement &&
        !menuAnchorMoved(previous, bounds)
      )
        return;
      if (!(event.target instanceof Node) || !menu.current?.contains(event.target)) dismiss();
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("scroll", outside, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("scroll", outside, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
      if (restore && previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [x, y, align, initialFocus, anchor]);
  return createPortal(
    <div
      ref={menu}
      id={id}
      className={appearance ? "actions-menu neo-dropdown-menu" : "actions-menu"}
      data-slot={appearance ? "dropdown-menu-content" : undefined}
      role="menu"
      aria-label={label}
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
        } else if (/^\p{L}$/u.test(event.key) && !event.metaKey && !event.ctrlKey) {
          const letter = event.key.toLocaleLowerCase();
          const next = [...buttons.slice(index + 1), ...buttons.slice(0, index + 1)].find(
            (button) => button.textContent?.trim().toLocaleLowerCase().startsWith(letter),
          );
          if (next) {
            event.preventDefault();
            next.focus();
          }
        }
      }}
    >
      {items.map((item) => (
        <button
          type="button"
          role="menuitem"
          data-slot={appearance ? "dropdown-menu-item" : undefined}
          key={item.label}
          onClick={() => {
            onClose();
            item.run();
          }}
        >
          <span className="chat-menu-label">{item.label}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
}
