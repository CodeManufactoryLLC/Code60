import type { Rectangle } from "@glideapps/glide-data-grid";
import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./icons.js";

type MenuItem = {
  label: string;
  icon: IconName;
  disabled: boolean;
  /** Why the item is unavailable, shown as its tooltip. */
  reason?: string | undefined;
  keys?: string | undefined;
  danger?: boolean | undefined;
  run(): void;
};

export function ActionsMenu({
  bounds,
  label,
  groups,
  onClose,
}: {
  bounds: Rectangle;
  label: string;
  groups: MenuItem[][];
  onClose(): void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: bounds.x, top: bounds.y + bounds.height });
  const close = useRef(onClose);
  close.current = onClose;
  const items = () => [
    ...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
  ];
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let restore = true;
    const rect = menu.current?.getBoundingClientRect();
    if (rect)
      setPosition({
        left: Math.max(8, Math.min(bounds.x, innerWidth - rect.width - 8)),
        top: Math.max(8, Math.min(bounds.y + bounds.height, innerHeight - rect.height - 8)),
      });
    // The grid refocuses its canvas after a click, so focus the menu once that has happened.
    const timer = setTimeout(() =>
      menu.current
        ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([aria-disabled="true"])')
        ?.focus(),
    );
    // Outside clicks, resizing, and window blur dismiss without forcing focus back.
    const dismiss = () => {
      restore = false;
      close.current();
    };
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) dismiss();
    };
    const escapeKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close.current();
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", escapeKey, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", escapeKey, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
      if (restore) previous?.focus();
    };
  }, [bounds.x, bounds.y, bounds.height]);
  const focusAt = (index: number) => {
    const list = items();
    list.at(index % list.length)?.focus();
  };
  return (
    <div
      ref={menu}
      className="actions-menu"
      role="menu"
      aria-label={label}
      style={position}
      onKeyDown={(event) => {
        const list = items();
        const index = list.indexOf(document.activeElement as HTMLButtonElement);
        if (event.key === "Tab") {
          event.preventDefault();
          onClose();
        } else if (
          (event.key === "Enter" || event.key === " ") &&
          event.target instanceof HTMLButtonElement
        ) {
          // The grid cancels Enter's default action, so a focused item is activated here.
          event.preventDefault();
          event.target.click();
        } else if (event.key === "Home" || event.key === "End") {
          event.preventDefault();
          focusAt(event.key === "Home" ? 0 : list.length - 1);
        } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          focusAt(index + (event.key === "ArrowDown" ? 1 : list.length - 1));
        } else if (/^\p{L}$/u.test(event.key) && !event.metaKey && !event.ctrlKey) {
          // Typing a letter jumps to the next item that starts with it.
          const letter = event.key.toLocaleLowerCase();
          const next = [...list.slice(index + 1), ...list.slice(0, index + 1)].find((item) =>
            item.textContent?.trim().toLocaleLowerCase().startsWith(letter),
          );
          if (next) {
            event.preventDefault();
            next.focus();
          }
        }
      }}
    >
      {groups
        .filter((group) => group.length)
        .map((group) => (
          // biome-ignore lint/a11y/useSemanticElements: a fieldset would add form semantics and its own frame to a row of buttons.
          <div className="menu-group" role="group" key={group.map((item) => item.label).join()}>
            {group.map((item) => (
              <button
                type="button"
                role="menuitem"
                key={item.label}
                tabIndex={-1}
                className={item.danger ? "danger-text" : undefined}
                aria-disabled={item.disabled || undefined}
                data-tooltip={item.disabled ? item.reason : undefined}
                onClick={() => {
                  if (item.disabled) return;
                  onClose();
                  item.run();
                }}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
                <span className="menu-key">{item.keys}</span>
              </button>
            ))}
          </div>
        ))}
    </div>
  );
}
