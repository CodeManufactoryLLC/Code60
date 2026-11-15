import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { settingsLabels, settingsSectionIds } from "./navigation.js";
import { SettingsHeader } from "./settings-layout.js";
import { SettingsPage } from "./settings-page.js";
import { parseTableLines } from "./table-preferences.js";
import { defaultTextStyles } from "./typography.js";

const unchanged = () => {};
const props: ComponentProps<typeof SettingsPage> = {
  section: "about",
  updates: <SettingsHeader page="updates" title="Updates" />,
  versions: undefined,
  orchestration: <SettingsHeader page="agents" title="Agents" />,
  memory: <SettingsHeader page="memory" title="Memory" />,
  pollingControls: <SettingsHeader page="polling-settings" title="Polling" />,
  transparent: false,
  savingAppearance: false,
  onTransparent: unchanged,
  theme: "dark",
  onTheme: unchanged,
  textStyles: defaultTextStyles,
  onTextStyles: unchanged,
  lines: parseTableLines(null),
  onLines: unchanged,
  density: "high",
  onDensity: unchanged,
  fit: false,
  onFit: unchanged,
  focusHighlight: false,
  onFocusHighlight: unchanged,
  signals: false,
  onSignals: unchanged,
  charts: true,
  onCharts: unchanged,
};

describe("Settings page titles", () => {
  it.each(settingsSectionIds)(
    "uses the specific %s page name instead of a Settings heading",
    (section) => {
      const html = renderToStaticMarkup(<SettingsPage {...props} section={section} />);
      expect(html).toContain(
        `<main class="settings-page" aria-label="${settingsLabels[section]}">`,
      );
      expect(html).not.toContain("settings-page-heading");
      expect(html).not.toContain('<span class="page-title-text">Settings</span>');
      const panels = [...html.matchAll(/<div role="tabpanel" id="panel-settings-([^"]+)"[^>]*>/g)];
      const index = panels.findIndex((panel) => panel[1] === section);
      const selected = panels[index];
      if (!selected) throw new Error(`Missing Settings panel for ${section}`);
      const active = html.slice(selected.index, panels[index + 1]?.index);
      expect(selected[0]).not.toContain("hidden");
      expect(active.match(/<h1\b/g)).toHaveLength(1);
      expect(active).toContain(`<span class="page-title-text">${settingsLabels[section]}</span>`);
      for (const panel of panels.filter((panel) => panel[1] !== section))
        expect(panel[0]).toContain('hidden=""');
    },
  );

  it("keeps the shared page hidden on the Settings overview", () => {
    const html = renderToStaticMarkup(<SettingsPage {...props} section={null} />);
    expect(html).toContain('<main class="settings-page" hidden="">');
    for (const panel of html.matchAll(/<div role="tabpanel"[^>]*>/g))
      expect(panel[0]).toContain('hidden=""');
    expect(html).not.toContain("settings-page-heading");
  });
});
