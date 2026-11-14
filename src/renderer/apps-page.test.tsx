import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppsPage } from "./apps-page.js";
import { pageDefinitions, pagesInGroup } from "./navigation.js";

describe("Apps home", () => {
  it.each([null, "/database.sqlite"])(
    "shows a labelled card for every nested app with database gating (%s)",
    (database) => {
      const html = renderToStaticMarkup(<AppsPage database={database} onOpen={() => {}} />);
      expect(html).toContain('id="apps-title">Apps</h1>');
      expect(html.match(/class="home-card"/g)).toHaveLength(pagesInGroup("apps").length + 1);
      for (const id of pagesInGroup("apps")) {
        const card = html.match(
          new RegExp(`<button[^>]*data-feature="${id}"[\\s\\S]*?</button>`),
        )?.[0];
        expect(card).toContain(`aria-label="Open ${pageDefinitions[id].label}"`);
        expect(card).not.toContain("home-card-description");
        expect(card).toContain(`data-icon="${pageDefinitions[id].icon}"`);
        expect(card?.includes('disabled=""')).toBe(database === null);
        expect(card?.includes('title="Connect to a database first"')).toBe(database === null);
      }
      const viewer = html.match(/<button[^>]*data-feature="tables"[\s\S]*?<\/button>/)?.[0];
      expect(viewer).toContain('aria-label="Open Data Viewer"');
      expect(viewer).toContain('data-icon="database"');
      expect(viewer).not.toContain("disabled");
      expect(html.indexOf("Open Command Builder")).toBeLessThan(html.indexOf("Open Data Viewer"));
      expect(html.indexOf("Open Data Viewer")).toBeLessThan(html.indexOf("Open Prompt Builder"));
      expect(html).not.toContain("Open Relay");
    },
  );
});
