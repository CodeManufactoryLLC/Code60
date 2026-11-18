import { useId } from "react";
import { defaultSidebarAppearance, type SidebarAppearance } from "./appearance.js";
import { InfoTip } from "./overlays.js";

export function SidebarAppearanceSettings({
  appearance,
  saved,
  blurSupported,
  onChange,
}: {
  appearance: SidebarAppearance;
  saved: boolean;
  blurSupported: boolean | undefined;
  onChange(appearance: SidebarAppearance): void;
}) {
  const id = useId();
  const fields = [
    {
      key: "opacity",
      label: "Background opacity",
      max: 100,
      unit: "%",
      tip: "Changes the entire background to the left of the sidebar divider immediately. Text and icons stay sharp. Zero is transparent; 100% is opaque. This works independently of the Transparent background setting for the rest of the window.",
    },
    {
      key: "blur",
      label: "Background blur",
      max: 100,
      unit: "%",
      tip:
        blurSupported === false
          ? "Native desktop background blur is available on macOS. Sidebar opacity remains available on Linux."
          : "Controls the strength of native macOS blur behind the sidebar. Zero turns blur off. Lower Background opacity to see the effect. Text and icons stay sharp; macOS controls the blur radius.",
    },
  ] as const;
  return (
    <fieldset className="settings-group sidebar-appearance-settings">
      <legend className="settings-group-title">Left sidebar</legend>
      <button
        type="button"
        className="settings-group-reset"
        onClick={() => onChange(defaultSidebarAppearance)}
      >
        Reset sidebar
      </button>
      {fields.map((field) => {
        const slider = `${id}-${field.key}`;
        const tip = `${slider}-tip`;
        const value = appearance[field.key];
        return (
          <div className="sidebar-appearance-setting" key={field.key}>
            <div className="sidebar-appearance-heading">
              <span className="settings-label">
                <label htmlFor={slider}>{field.label}</label>
                <InfoTip label={field.label} id={tip}>
                  {field.tip}
                </InfoTip>
              </span>
              <output htmlFor={slider}>{`${value}${field.unit}`}</output>
            </div>
            <div className="transition-range">
              <input
                id={slider}
                type="range"
                min={0}
                max={field.max}
                step={1}
                value={value}
                disabled={field.key === "blur" && blurSupported !== true}
                aria-valuetext={`${value}${field.unit}`}
                aria-describedby={tip}
                onChange={(event) =>
                  onChange({ ...appearance, [field.key]: event.target.valueAsNumber })
                }
              />
            </div>
          </div>
        );
      })}
      {!saved && (
        <div role="alert">
          Sidebar changes apply for this session but could not be saved. Adjust a slider or use
          Reset sidebar to retry.
        </div>
      )}
    </fieldset>
  );
}
