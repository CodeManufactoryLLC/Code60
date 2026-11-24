import { AnchoredMenu } from "./anchored-menu.js";
import type { IconName } from "./icons.js";
import type { Rectangle } from "./table-types.js";

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
  return (
    <AnchoredMenu
      x={bounds.x}
      y={bounds.y + bounds.height}
      label={label}
      items={groups.flat()}
      onClose={onClose}
    />
  );
}
