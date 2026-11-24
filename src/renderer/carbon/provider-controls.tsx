import type { ComponentProps } from "react";
import { AnchoredMenu } from "../anchored-menu.js";
import { Icon } from "../icons.js";

export function ProviderDropdown(props: ComponentProps<typeof AnchoredMenu>) {
  return <AnchoredMenu {...props} className="provider-dropdown" />;
}

export function PrimaryProviderMark({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={`provider-primary${compact ? " provider-primary-compact" : ""}`}
      role="img"
      aria-label="Primary Provider"
      tabIndex={compact ? -1 : 0}
      data-tooltip="Primary Provider"
    >
      <Icon name="checkmark" />
    </span>
  );
}
