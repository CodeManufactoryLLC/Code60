import { useEffect, useRef, useState } from "react";
import type { AgentSetupSnapshot } from "../bridge/index.js";
import { AnchoredMenu } from "./anchored-menu.js";
import { Button as AppButton } from "./carbon/button.js";
import { Icon } from "./icons.js";
import { type ProviderManagement, providerActionReasons } from "./provider-management.js";

export function ProviderMenu({
  provider,
  name,
  setup,
  management,
  active = true,
}: {
  provider: string;
  name: string;
  setup: AgentSetupSnapshot | undefined;
  management: ProviderManagement;
  active?: boolean;
}) {
  const [position, setPosition] = useState<{ x: number; y: number }>();
  const trigger = useRef<HTMLButtonElement>(null);
  const connected = setup?.enabled.includes(provider);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Close a popup when its owner, visibility or pending state changes.
  useEffect(() => {
    setPosition(undefined);
  }, [active, connected, provider, management.pending]);
  const reasons = providerActionReasons(setup, provider, management.pending);
  return (
    <>
      <AppButton
        ref={trigger}
        type="button"
        className="icon-button"
        aria-label={`More actions for ${name}`}
        aria-haspopup="menu"
        aria-expanded={Boolean(position)}
        aria-disabled={management.pending || undefined}
        onClick={(event) => {
          if (management.pending) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          setPosition(position ? undefined : { x: bounds.right, y: bounds.bottom });
        }}
      >
        <Icon name="overflow-menu--horizontal" />
      </AppButton>
      {position && active && connected && (
        <AnchoredMenu
          className="provider-dropdown"
          anchor={trigger.current}
          {...position}
          label={`${name} actions`}
          onClose={() => setPosition(undefined)}
          items={[
            {
              label: "Disconnect",
              disabled: Boolean(reasons.disconnect),
              reason: reasons.disconnect ?? undefined,
              run: () => void management.act({ type: "disconnect", provider }),
            },
            {
              label: "Set as Primary",
              disabled: Boolean(reasons.primary),
              reason: reasons.primary ?? undefined,
              run: () => void management.act({ type: "set-primary", provider }),
            },
          ]}
        />
      )}
    </>
  );
}
