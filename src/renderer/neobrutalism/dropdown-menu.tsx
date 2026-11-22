// Adapted from neobrutalism.dev/r/dropdown-menu.json; see README.md and LICENSE.
import { type RefObject, useEffect, useId, useRef, useState } from "react";
import { AnchoredMenu } from "../anchored-menu.js";
import { Icon } from "../icons.js";
import { Button } from "./button.js";

/** Upstream dropdown presentation with Code60's native, anchored menu lifecycle. */
export function DropdownMenu({
  label,
  iconOnly = false,
  active,
  disabled,
  items,
  triggerRef,
}: {
  label: string;
  iconOnly?: boolean;
  active: boolean;
  disabled: boolean;
  items: readonly { label: string; run(): void }[];
  triggerRef?: RefObject<HTMLButtonElement | null>;
}) {
  const id = useId();
  const localTrigger = useRef<HTMLButtonElement>(null);
  const trigger = triggerRef ?? localTrigger;
  const [position, setPosition] = useState<{ x: number; y: number; last: boolean }>();
  const expanded = active && !disabled && !!position;
  useEffect(() => {
    if (!active || disabled) setPosition(undefined);
  }, [active, disabled]);
  const open = (last = false) => {
    const bounds = trigger.current?.getBoundingClientRect();
    if (bounds) setPosition({ x: bounds.right, y: bounds.bottom + 4, last });
  };
  return (
    <>
      <Button
        ref={trigger}
        className={iconOnly ? "icon-button" : undefined}
        aria-label={iconOnly ? label : undefined}
        title={iconOnly ? label : undefined}
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
        {!iconOnly && label}
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
