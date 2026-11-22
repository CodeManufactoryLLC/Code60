import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { menuAnchorMoved } from "./menu-anchor.js";
import { menuTypeahead } from "./menu-typeahead.js";

export function AnchoredMenu({
  className,
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
  className?: string;
  x: number;
  y: number;
  label: string;
  items: readonly {
    id?: string;
    label: string;
    disabled?: boolean | undefined;
    reason?: string | undefined;
    checked?: boolean;
    describedBy?: string;
    run(): void;
  }[];
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
    let bounds = previous instanceof HTMLElement ? previous.getBoundingClientRect() : undefined;
    const rect = menu.current?.getBoundingClientRect();
    if (rect)
      setPosition({
        left: Math.max(
          8,
          Math.min(align === "end" ? x - rect.width : x, innerWidth - rect.width - 8),
        ),
        top: Math.max(8, Math.min(y, innerHeight - rect.height - 8)),
      });
    // A live title can change the trigger's position without changing its owner.
    // Reposition the same menu without resetting the highlighted item or focus.
    let disposed = false;
    let resize: ResizeObserver | undefined;
    if (anchor && bounds && typeof ResizeObserver !== "undefined") {
      const offsetX = x - (align === "end" ? bounds.right : bounds.left);
      const offsetY = y - bounds.bottom;
      resize = new ResizeObserver(() => {
        if (disposed) return;
        const rect = menu.current?.getBoundingClientRect();
        if (!rect) return;
        bounds = anchor.getBoundingClientRect();
        const next = {
          left: Math.max(
            8,
            Math.min(
              (align === "end" ? bounds.right - rect.width : bounds.left) + offsetX,
              innerWidth - rect.width - 8,
            ),
          ),
          top: Math.max(8, Math.min(bounds.bottom + offsetY, innerHeight - rect.height - 8)),
        };
        setPosition((current) =>
          current.left === next.left && current.top === next.top ? current : next,
        );
      });
      resize.observe(anchor);
      const title = anchor.closest(".content-page-heading")?.querySelector(".content-page-title");
      if (title) resize.observe(title);
    }
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
      disposed = true;
      resize?.disconnect();
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("scroll", outside, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
      if (
        restore &&
        previous instanceof HTMLElement &&
        previous.isConnected &&
        !previous.closest("[hidden], [inert]")
      )
        previous.focus();
    };
  }, [x, y, align, initialFocus, anchor]);
  return createPortal(
    <div
      ref={menu}
      id={id}
      className={["actions-menu", appearance && "neo-dropdown-menu", className]
        .filter(Boolean)
        .join(" ")}
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
          const next = menuTypeahead(buttons, index, event.key);
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
          {...(item.checked === undefined
            ? { role: "menuitem" as const }
            : { role: "menuitemcheckbox" as const, "aria-checked": item.checked })}
          aria-describedby={item.describedBy}
          key={item.id ?? item.label}
          aria-disabled={item.disabled || undefined}
          aria-description={item.reason}
          title={item.reason}
          data-tooltip={item.reason}
          onClick={() => {
            if (item.disabled) return;
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
