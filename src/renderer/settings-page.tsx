import { type ReactNode, useId } from "react";
import type { Versions } from "../bridge/index.js";
import { AboutSection } from "./about-section.js";
import { parseTheme, type Theme } from "./appearance.js";
import { RadioButton as CarbonRadioButton } from "./carbon/choices.js";
import { Select as CarbonSelect } from "./carbon/fields.js";
import { Switch as CarbonSwitch } from "./carbon/switch.js";
import { type SettingsSectionId, settingsLabels } from "./navigation.js";
import { ControlDescription } from "./overlays.js";
import { SettingsCard, SettingsHeader } from "./settings-layout.js";
import { type RowDensity, rowDensities, type TableLines } from "./table-preferences.js";
import { TextSettings } from "./text-settings.js";
import type { TextStyles } from "./typography.js";
export function SettingsPage({
  section,
  updates,
  versions,
  memory,
  pollingControls,
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
      aria-label={settingsLabels[page]}
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
          <SettingsCard title="Color theme">
            <div className="settings-row">
              <CarbonSelect
                labelText={<>Theme</>}
                aria-label="Theme"
                value={theme}
                onChange={(event) => onTheme(parseTheme(event.target.value))}
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
                <option value="system">System</option>
              </CarbonSelect>
            </div>
          </SettingsCard>
          <SettingsCard title="Accessibility">
            <div className="settings-row">
              <CarbonSwitch
                labelText={<>Focus highlight border</>}
                checked={focusHighlight}
                onChange={(checked) => onFocusHighlight(checked)}
              />
            </div>
            <div className="settings-row">
              <CarbonSwitch
                labelText={
                  <>
                    <span className="settings-label">
                      <span id={`${id}-signals-label`}>Signal colors</span>
                      <ControlDescription id={`${id}-signals`}>
                        Adds color to status labels, banners, and toasts. Every state keeps its icon
                        and written label, so nothing depends on color alone.
                      </ControlDescription>
                    </span>
                  </>
                }
                checked={signals}
                aria-labelledby={`${id}-signals-label`}
                aria-describedby={`${id}-signals`}
                onChange={(checked) => onSignals(checked)}
              />
            </div>
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
              <div key={key} className="settings-row">
                <CarbonSwitch
                  labelText={<>{label}</>}
                  checked={lines[key]}
                  onChange={(checked) => onLines({ ...lines, [key]: checked })}
                />
              </div>
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
                  <div key={entry.id} className="segmented-option">
                    <CarbonRadioButton
                      labelText={<>{entry.label}</>}
                      name="row-density"
                      value={entry.id}
                      checked={density === entry.id}
                      onChange={() => onDensity(entry.id)}
                    />
                  </div>
                ))}
              </div>
            </div>
            <div className="settings-row">
              <CarbonSwitch
                labelText={<>Fit columns to width</>}
                checked={fit}
                onChange={(checked) => onFit(checked)}
              />
            </div>
            <div className="settings-row">
              <CarbonSwitch
                labelText={
                  <>
                    <span className="settings-label">
                      <span id={`${id}-charts-label`}>Inline charts</span>
                      <ControlDescription id={`${id}-charts`}>
                        Shows turn time, event activity, and the last two minutes of state for each
                        session.
                      </ControlDescription>
                    </span>
                  </>
                }
                checked={charts}
                aria-labelledby={`${id}-charts-label`}
                aria-describedby={`${id}-charts`}
                onChange={(checked) => onCharts(checked)}
              />
            </div>
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
