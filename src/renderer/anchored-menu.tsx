import { Menu, MenuItem, MenuItemSelectable } from "@carbon/react";
import { useLayoutEffect, useRef } from "react";
import { Icon, type IconName } from "./icons.js";
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
    icon?: IconName;
    keys?: string | undefined;
    danger?: boolean | undefined;
    describedBy?: string;
    run(): void;
  }[];
  onClose(): void;
  id?: string;
  align?: "start" | "end";
  initialFocus?: "first" | "last";
  anchor?: HTMLElement | null;
}) {
  const menu = useRef<HTMLUListElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const previous = anchor ?? document.activeElement;
    const bounds = previous instanceof HTMLElement ? previous.getBoundingClientRect() : undefined;
    const dismiss = () => close.current();
    let observer: ResizeObserver | undefined;
    if (anchor && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => {
        if (bounds && menuAnchorMoved(anchor, bounds)) dismiss();
      });
      observer.observe(anchor);
    }
    const outside = (event: Event) => {
      if (
        event.target instanceof Node &&
        (menu.current?.contains(event.target) || anchor?.contains(event.target))
      )
        return;
      if (
        event.type === "scroll" &&
        bounds &&
        previous instanceof HTMLElement &&
        !menuAnchorMoved(previous, bounds)
      )
        return;
      dismiss();
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("scroll", outside, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    return () => {
      observer?.disconnect();
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("scroll", outside, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
    };
  }, [anchor]);
  return (
    <Menu
      ref={menu}
      open
      label={label}
      x={x}
      y={y}
      size="md"
      {...(id ? { id } : {})}
      {...(className ? { className } : {})}
      menuAlignment={align === "end" ? "bottom-end" : "bottom-start"}
      onClose={onClose}
      onOpen={() => {
        if (initialFocus === "last")
          [
            ...(menu.current?.querySelectorAll<HTMLElement>(
              '[role^="menuitem"]:not([aria-disabled="true"])',
            ) ?? []),
          ]
            .at(-1)
            ?.focus();
      }}
      onKeyDownCapture={(event) => {
        const entries = [
          ...(menu.current?.querySelectorAll<HTMLElement>(
            '[role^="menuitem"]:not([aria-disabled="true"])',
          ) ?? []),
        ];
        let next: HTMLElement | undefined;
        if (event.key === "Home") next = entries[0];
        else if (event.key === "End") next = entries.at(-1);
        else if (/^\p{L}$/u.test(event.key) && !event.metaKey && !event.ctrlKey)
          next = menuTypeahead(
            entries,
            entries.indexOf(document.activeElement as HTMLElement),
            event.key,
          );
        if (next) {
          event.preventDefault();
          event.stopPropagation();
          next.focus();
        }
      }}
    >
      {items.map((item) => {
        const icon = item.icon;
        const props = {
          label: item.label,
          kind: item.danger ? ("danger" as const) : ("default" as const),
          ...(item.keys ? { shortcut: item.keys } : {}),
          ...(icon ? { renderIcon: () => <Icon name={icon} /> } : {}),
          disabled: item.disabled ?? false,
          ...(item.reason ? { title: item.reason, "aria-description": item.reason } : {}),
          ...(item.describedBy ? { "aria-describedby": item.describedBy } : {}),
          onClick: () => {
            if (!item.disabled) {
              onClose();
              item.run();
            }
          },
        };
        return item.checked === undefined ? (
          <MenuItem key={item.id ?? item.label} {...props} />
        ) : (
          <MenuItemSelectable key={item.id ?? item.label} {...props} selected={item.checked} />
        );
      })}
    </Menu>
  );
}
