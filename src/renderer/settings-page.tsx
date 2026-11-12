import { type ReactNode, useId } from "react";
import type { Versions } from "../bridge/index.js";
import { AboutSection } from "./about-section.js";
import { parseTheme, type Theme } from "./appearance.js";
import { InfoTip } from "./overlays.js";
import { SettingsCard, SettingsHeader } from "./settings-layout.js";
import { type RowDensity, rowDensities, type TableLines } from "./table-preferences.js";
import type { SettingsSectionId } from "./tabs.js";
import { TextSettings } from "./text-settings.js";
import { TransitionSettings } from "./transition-settings.js";
import type { TextStyles } from "./typography.js";
export function SettingsPage({
  section,
  updates,
  versions,
  orchestration,
  pollingControls,
  transparent,
  savingAppearance,
  onTransparent,
  theme,
  onTheme,
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
  section: SettingsSectionId;
  updates: ReactNode;
  versions: Versions | undefined;
  orchestration: ReactNode;
  pollingControls: ReactNode;
  focusHighlight: boolean;
  onFocusHighlight(on: boolean): void;
  signals: boolean;
  onSignals(on: boolean): void;
  charts: boolean;
  onCharts(on: boolean): void;
  transparent: boolean | undefined;
  savingAppearance: boolean;
  onTransparent(enabled: boolean): void;
  theme: Theme;
  onTheme(theme: Theme): void;
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
    <main className="settings-page" aria-labelledby={id}>
      <div className="settings-page-heading">
        <h1 id={id}>Settings</h1>
      </div>
      {settingsPanel("agents", orchestration)}
      {settingsPanel(
        "appearance",
        <section className="settings-section" aria-labelledby={`${id}-appearance`}>
          <SettingsHeader id={`${id}-appearance`} title="Appearance" />
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
            <label className="settings-row">
              <span className="settings-label">
                <span id={`${id}-transparent-label`}>Transparent background</span>
                <InfoTip label="Transparent background" id={`${id}-transparent`}>
                  Applies after restart. Makes the area outside the content frame and tabs fully
                  transparent. On macOS, clicks in that area pass through to the desktop; on Linux,
                  the window stays clickable.
                </InfoTip>
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={transparent ?? false}
                aria-checked={transparent ?? false}
                aria-labelledby={`${id}-transparent-label`}
                aria-describedby={`${id}-transparent`}
                disabled={transparent === undefined || savingAppearance}
                onChange={(event) => onTransparent(event.target.checked)}
              />
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
                <InfoTip label="Signal colors" id={`${id}-signals`}>
                  Adds color to status labels, banners, and toasts. Every state keeps its icon and
                  written label, so nothing depends on color alone.
                </InfoTip>
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
            id={`${id}-table`}
            title="Table defaults"
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
              <div className="segmented" role="radiogroup" aria-labelledby={`${id}-density`}>
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
                <InfoTip label="Inline charts" id={`${id}-charts`}>
                  Shows turn time, event activity, and the last two minutes of state for each
                  session.
                </InfoTip>
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
