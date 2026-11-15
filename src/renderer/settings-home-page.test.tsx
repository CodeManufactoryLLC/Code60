import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { settingsIcons, settingsLabels, settingsSectionIds } from "./navigation.js";
import { SettingsHomePage } from "./settings-home-page.js";

describe("Settings home", () => {
  it.each([null, "/database.sqlite"])(
    "shows direct children with matching icons without a database gate (%s)",
    (database) => {
      const html = renderToStaticMarkup(<SettingsHomePage database={database} onOpen={() => {}} />);
      expect(html).toContain('aria-labelledby="settings-home-title"');
      expect(html).toContain('data-icon="app-cogwheel"');
      expect([...html.matchAll(/aria-label="Open ([^"]+)"/g)].map((match) => match[1])).toEqual([
        "About",
        "Advanced",
        "Agents",
        "Appearance",
        "Memory",
        "Polling",
        "Table defaults",
        "Text",
        "Updates",
      ]);
      expect(html.match(/class="home-card"/g)).toHaveLength(9);
      expect(html).not.toContain("disabled");
      expect(html).not.toContain("home-card-description");
      expect(html).not.toContain('data-feature="rag"');
      for (const id of settingsSectionIds) {
        const card = html.match(
          new RegExp(`<button[^>]*data-feature="${id}"[\\s\\S]*?</button>`),
        )?.[0];
        expect(card).toContain(`aria-label="Open ${settingsLabels[id]}"`);
        expect(card).toContain(`data-icon="${settingsIcons[id]}"`);
      }
    },
  );
  it("forwards direct sections and the Advanced parent destination", () => {
    const onOpen = vi.fn();
    const home = SettingsHomePage({ database: null, onOpen });
    for (const card of home.props.cards) home.props.onOpen(card);
    expect(onOpen.mock.calls.map(([id]) => id)).toEqual([
      "about",
      "advanced",
      "agents",
      "appearance",
      "memory",
      "polling-settings",
      "table-defaults",
      "text",
      "updates",
    ]);
  });
});
