import { type ReactNode, useId } from "react";
import type { Versions } from "../bridge/index.js";
import { AboutSection } from "./about-section.js";
import { parseTheme, type SidebarAppearance, type Theme } from "./appearance.js";
import { type IconAppearance, iconContrastBounds } from "./icon-appearance.js";
import { type SettingsSectionId, settingsLabels } from "./navigation.js";
import { ControlDescription } from "./overlays.js";
import { SettingsCard, SettingsHeader } from "./settings-layout.js";
import { SidebarAppearanceSettings } from "./sidebar-appearance-settings.js";
import { type RowDensity, rowDensities, type TableLines } from "./table-preferences.js";
import { TextSettings } from "./text-settings.js";
import { TransitionSettings } from "./transition-settings.js";
import type { TextStyles } from "./typography.js";
export function SettingsPage({
  section,
  updates,
  versions,
  memory,
  pollingControls,
  theme,
  onTheme,
  iconAppearance,
  iconAppearanceSaved,
  onIconAppearance,
  sidebarAppearance,
  sidebarAppearanceSaved,
  sidebarBlurSupported,
  sidebarBlurError,
  onSidebarAppearance,
  textStyles,
  onTextStyles,
  lines,
  onLines,
  density,
  onDensity,
  fit,
  onFit,
  focusHighlight,
  onFocusHighlight,
  signals,
  onSignals,
  charts,
  onCharts,
}: {
  section: SettingsSectionId | null;
  updates: ReactNode;
  versions: Versions | undefined;
  memory?: ReactNode;
  pollingControls: ReactNode;
  focusHighlight: boolean;
  onFocusHighlight(on: boolean): void;
  signals: boolean;
  onSignals(on: boolean): void;
  charts: boolean;
  onCharts(on: boolean): void;
  theme: Theme;
  onTheme(theme: Theme): void;
  iconAppearance: IconAppearance;
  iconAppearanceSaved: boolean;
  onIconAppearance(appearance: IconAppearance): void;
  sidebarAppearance: SidebarAppearance;
  sidebarAppearanceSaved: boolean;
  sidebarBlurSupported: boolean | undefined;
  sidebarBlurError: string;
  onSidebarAppearance(appearance: SidebarAppearance): void;
  textStyles: TextStyles;
  onTextStyles(styles: TextStyles): void;
  lines: TableLines;
  onLines(lines: TableLines): void;
  density: RowDensity;
  onDensity(density: RowDensity): void;
  fit: boolean;
  onFit(fit: boolean): void;
}) {
  const id = useId();
  const settingsPanel = (page: SettingsSectionId, children: ReactNode) => (
    <div
      role="tabpanel"
      id={`panel-settings-${page}`}
      aria-labelledby={`tab-settings-${page}`}
      hidden={section !== page}
    >
      {children}
    </div>
  );
  return (
    <main
      className="settings-page"
      aria-label={section ? settingsLabels[section] : undefined}
      hidden={section === null}
    >
      {settingsPanel("memory", memory)}
      {settingsPanel(
        "appearance",
        <section className="settings-section" aria-labelledby={`${id}-appearance`}>
          <SettingsHeader page="appearance" id={`${id}-appearance`} />
          <SidebarAppearanceSettings
            appearance={sidebarAppearance}
            saved={sidebarAppearanceSaved}
            blurSupported={sidebarBlurSupported}
            nativeError={sidebarBlurError}
            onChange={onSidebarAppearance}
          />
          <SettingsCard title="Icons">
            <label className="settings-row">
              Monochrome
              <input
                type="checkbox"
                role="switch"
                checked={iconAppearance.monochrome}
                aria-checked={iconAppearance.monochrome}
                onChange={(event) =>
                  onIconAppearance({ ...iconAppearance, monochrome: event.target.checked })
                }
              />
            </label>
            <label className="settings-row">
              Icon color
              <input
                type="color"
                value={iconAppearance.color}
                disabled={!iconAppearance.monochrome}
                onChange={(event) =>
                  onIconAppearance({ ...iconAppearance, color: event.target.value })
                }
              />
            </label>
            <div className="icon-contrast-setting">
              <div className="icon-contrast-heading">
                <span className="settings-label">
                  <label htmlFor={`${id}-icon-contrast`}>Icon contrast</label>
                  <ControlDescription id={`${id}-icon-contrast-tip`}>
                    Spreads the selected color into darker shadows and lighter highlights. Zero uses
                    one flat color; 100% keeps the standard shades; 200% reaches black and white.
                    Applies immediately while Monochrome is on.
                  </ControlDescription>
                </span>
                <output htmlFor={`${id}-icon-contrast`}>{iconAppearance.contrast}%</output>
              </div>
              <div className="transition-range">
                <input
                  id={`${id}-icon-contrast`}
                  type="range"
                  min={iconContrastBounds.min}
                  max={iconContrastBounds.max}
                  step={1}
                  value={iconAppearance.contrast}
                  disabled={!iconAppearance.monochrome}
                  aria-valuetext={`${iconAppearance.contrast}%`}
                  aria-describedby={`${id}-icon-contrast-tip`}
                  onChange={(event) =>
                    onIconAppearance({ ...iconAppearance, contrast: event.target.valueAsNumber })
                  }
                />
              </div>
            </div>
            {!iconAppearanceSaved && (
              <p className="error" role="alert">
                Icon appearance could not be saved. Changes apply for this window only.
              </p>
            )}
          </SettingsCard>
          <TransitionSettings />
          <SettingsCard title="Window">
            <label className="settings-row">
              Theme
              <select
                aria-label="Theme"
                value={theme}
                onChange={(event) => onTheme(parseTheme(event.target.value))}
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
                <option value="system">System</option>
              </select>
            </label>
          </SettingsCard>
          <SettingsCard title="Accessibility">
            <label className="settings-row">
              Focus highlight border
              <input
                type="checkbox"
                role="switch"
                checked={focusHighlight}
                aria-checked={focusHighlight}
                onChange={(event) => onFocusHighlight(event.target.checked)}
              />
            </label>
            <label className="settings-row">
              <span className="settings-label">
                <span id={`${id}-signals-label`}>Signal colors</span>
                <ControlDescription id={`${id}-signals`}>
                  Adds color to status labels, banners, and toasts. Every state keeps its icon and
                  written label, so nothing depends on color alone.
                </ControlDescription>
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={signals}
                aria-checked={signals}
                aria-labelledby={`${id}-signals-label`}
                aria-describedby={`${id}-signals`}
                onChange={(event) => onSignals(event.target.checked)}
              />
            </label>
          </SettingsCard>
        </section>,
      )}
      {settingsPanel(
        "table-defaults",
        <section className="settings-section" aria-labelledby={`${id}-table`}>
          <SettingsHeader
            page="table-defaults"
            id={`${id}-table`}
            tip="Defaults for tables without local overrides. Use each table’s Settings to customize it."
          />
          <SettingsCard title="Lines">
            {(
              [
                ["horizontal", "Row lines"],
                ["vertical", "Column lines"],
                ["heading", "Heading lines"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="settings-row">
                {label}
                <input
                  type="checkbox"
                  role="switch"
                  aria-checked={lines[key]}
                  checked={lines[key]}
                  onChange={(event) => onLines({ ...lines, [key]: event.target.checked })}
                />
              </label>
            ))}
          </SettingsCard>
          <SettingsCard title="Layout">
            <div className="settings-row">
              <span id={`${id}-density`}>Row density</span>
              <div
                className="segmented table-density-selector"
                role="radiogroup"
                aria-labelledby={`${id}-density`}
              >
                {rowDensities.map((entry) => (
                  <label key={entry.id} className="segmented-option">
                    <input
                      type="radio"
                      name="row-density"
                      value={entry.id}
                      checked={density === entry.id}
                      onChange={() => onDensity(entry.id)}
                    />
                    {entry.label}
                  </label>
                ))}
              </div>
            </div>
            <label className="settings-row">
              Fit columns to width
              <input
                type="checkbox"
                role="switch"
                aria-checked={fit}
                checked={fit}
                onChange={(event) => onFit(event.target.checked)}
              />
            </label>
            <label className="settings-row">
              <span className="settings-label">
                <span id={`${id}-charts-label`}>Inline charts</span>
                <ControlDescription id={`${id}-charts`}>
                  Shows turn time, event activity, and the last two minutes of state for each
                  session.
                </ControlDescription>
              </span>
              <input
                type="checkbox"
                role="switch"
                aria-checked={charts}
                checked={charts}
                aria-labelledby={`${id}-charts-label`}
                aria-describedby={`${id}-charts`}
                onChange={(event) => onCharts(event.target.checked)}
              />
            </label>
          </SettingsCard>
        </section>,
      )}
      {settingsPanel("text", <TextSettings textStyles={textStyles} onTextStyles={onTextStyles} />)}
      {settingsPanel("polling-settings", pollingControls)}
      {settingsPanel("updates", updates)}
      {settingsPanel("about", <AboutSection versions={versions} />)}
    </main>
  );
}
