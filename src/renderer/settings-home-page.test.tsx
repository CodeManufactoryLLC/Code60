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
      expect(html).not.toContain('data-icon="app-cogwheel"');
      expect([...html.matchAll(/aria-label="Open ([^"]+)"/g)].map((match) => match[1])).toEqual([
        "About",
        "Advanced",
        "Table defaults",
        "Text",
      ]);
      expect(html.match(/class="navigation-list-row"/g)).toHaveLength(4);
      expect(html).not.toContain("disabled");
      expect(html).not.toContain("home-card-description");
      expect(html).not.toContain('data-feature="rag"');
      for (const id of settingsSectionIds.filter(
        (id) => !["appearance", "memory", "polling-settings", "updates"].includes(id),
      )) {
        const card = html.match(
          new RegExp(`<button[^>]*data-feature="${id}"[\\s\\S]*?</button>`),
        )?.[0];
        expect(card).toContain(`aria-label="Open ${settingsLabels[id]}"`);
        expect(card).not.toContain(`data-icon="${settingsIcons[id]}"`);
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
      "table-defaults",
      "text",
    ]);
  });
});
