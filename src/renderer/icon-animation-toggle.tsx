import block from "./icons/apps/animation-block.svg?no-inline";
import { NavigationIcon } from "./navigation-icons.js";

export function IconAnimationToggle({
  enabled,
  saved,
  onChange,
}: {
  enabled: boolean;
  saved: boolean;
  onChange(enabled: boolean): void;
}) {
  return (
    <button
      type="button"
      className="icon-button breadcrumb-animation-toggle"
      aria-label="Icon animations"
      aria-pressed={enabled}
      title={`Icon animations: ${enabled ? "On" : "Off"}. ${saved ? "" : "Changes could not be saved; toggle again to retry. "}${enabled ? "Disable" : "Enable"} icon animations`}
      onClick={() => onChange(!enabled)}
    >
      <NavigationIcon name="app-icon-animations" playOnEnable />
      {!enabled && (
        <img
          className="navigation-icon icon-animation-block"
          src={block}
          alt=""
          aria-hidden="true"
          draggable={false}
        />
      )}
      {!saved && (
        <span className="sr-only" role="alert">
          Icon animation setting could not be saved. Toggle again to retry.
        </span>
      )}
    </button>
  );
}
