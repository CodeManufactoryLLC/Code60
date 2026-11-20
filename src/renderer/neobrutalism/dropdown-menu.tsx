// Adapted from neobrutalism.dev/r/dropdown-menu.json; see README.md and LICENSE.
import { useEffect, useId, useRef, useState } from "react";
import { AnchoredMenu } from "../anchored-menu.js";
import { Icon } from "../icons.js";
import { Button } from "./button.js";

/** Upstream dropdown presentation with Code60's native, anchored menu lifecycle. */
export function DropdownMenu({
  label,
  active,
  disabled,
  items,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  items: readonly { label: string; run(): void }[];
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number; last: boolean }>();
  const expanded = active && !disabled && !!position;
  useEffect(() => {
    if (!active || disabled) setPosition(undefined);
  }, [active, disabled]);
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) setPosition(undefined);
    };
    document.addEventListener("visibilitychange", hidden);
    return () => document.removeEventListener("visibilitychange", hidden);
  }, []);
  const open = (last = false) => {
    const bounds = trigger.current?.getBoundingClientRect();
    if (bounds) setPosition({ x: bounds.right, y: bounds.bottom + 4, last });
  };
  return (
    <>
      <Button
        ref={trigger}
        data-slot="dropdown-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={expanded}
        aria-controls={expanded ? id : undefined}
        disabled={disabled}
        onClick={() => (expanded ? setPosition(undefined) : open())}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          open(event.key === "ArrowUp");
        }}
      >
        {label}
        <Icon name="chevron--down" />
      </Button>
      {expanded && position && (
        <AnchoredMenu
          id={id}
          x={position.x}
          y={position.y}
          align="end"
          anchor={trigger.current}
          initialFocus={position.last ? "last" : "first"}
          appearance="neobrutalism"
          label={label}
          items={items}
          onClose={() => setPosition(undefined)}
        />
      )}
    </>
  );
}
