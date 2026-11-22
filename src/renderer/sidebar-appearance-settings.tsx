import { useId } from "react";
import {
  defaultSidebarAppearance,
  type SidebarAppearance,
  sidebarPercentageLimit,
} from "./appearance.js";
import { ControlDescription } from "./overlays.js";

export function SidebarAppearanceSettings({
  appearance,
  saved,
  blurSupported,
  nativeError,
  onChange,
}: {
  appearance: SidebarAppearance;
  saved: boolean;
  nativeError: string;
  blurSupported: boolean | undefined;
  onChange(appearance: SidebarAppearance): void;
}) {
  const id = useId();
  const fields = [
    {
      key: "opacity",
      label: "Background opacity",
      tip: "Changes the background behind the entire app window immediately, including its title strip, margins and footer. Zero is transparent; 100% is opaque. Cards, text and icons stay opaque and sharp.",
    },
    {
      key: "blur",
      label: "Background blur",
      tip:
        blurSupported === false
          ? "Native desktop background blur is available on macOS. Window background opacity remains available on Linux."
          : "Controls the strength of native macOS blur behind the entire app window. Zero turns blur off. Lower Background opacity to see the effect. Text and icons stay sharp; macOS controls the blur radius.",
    },
  ] as const;
  return (
    <fieldset className="settings-group sidebar-appearance-settings">
      <legend className="settings-group-title">Window background</legend>
      <button
        type="button"
        className="settings-group-reset"
        onClick={() => onChange({ ...defaultSidebarAppearance })}
      >
        Reset background
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
                <ControlDescription id={tip}>{field.tip}</ControlDescription>
              </span>
              <output htmlFor={slider}>{`${value}%`}</output>
            </div>
            <div className="transition-range">
              <input
                id={slider}
                type="range"
                min={0}
                max={sidebarPercentageLimit}
                step={1}
                value={value}
                disabled={field.key === "blur" && blurSupported !== true}
                aria-valuetext={`${value}%`}
                aria-describedby={tip}
                onChange={(event) =>
                  onChange({ ...appearance, [field.key]: event.target.valueAsNumber })
                }
              />
            </div>
          </div>
        );
      })}
      {nativeError && <div role="alert">{nativeError}</div>}
      {!saved && (
        <div role="alert">
          Window background changes apply for this session but could not be saved. Adjust a slider
          or use Reset background to retry.
        </div>
      )}
    </fieldset>
  );
}
