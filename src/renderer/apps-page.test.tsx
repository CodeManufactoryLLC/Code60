import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppsPage } from "./apps-page.js";
import { pageAvailable, pageDefinitions, pagesInGroup } from "./navigation.js";

describe("Apps home", () => {
  it("uses the supplied artwork on every Apps card", () => {
    const apps = renderToStaticMarkup(<AppsPage database="/db" onOpen={() => {}} />);
    for (const [id, file, poster] of [
      ["automations", "robotic-arm", "time-management"],
      ["commands", "megaphone", "marketing-automation"],
      ["tables", "database", "database-table"],
      ["prompts", "ai", "spell-book"],
    ]) {
      const card = apps.match(
        new RegExp(`<button[^>]*data-feature="${id}"[\\s\\S]*?</button>`),
      )?.[0];
      expect(card).toContain("<img");
      expect(card).toContain(`${poster}.png`);
      expect(card).toContain(`data-icon="app-${file}"`);
      expect(card).toContain('alt="" aria-hidden="true"');
    }
  });

  it.each([null, "/database.sqlite"])(
    "shows a labelled card for every nested app with database gating (%s)",
    (database) => {
      const html = renderToStaticMarkup(<AppsPage database={database} onOpen={() => {}} />);
      expect(html).toContain('id="apps-title" class="page-title table-title">');
      expect(html).toContain('<span class="page-title-text">Apps</span></h1>');
      expect(html.match(/class="home-card"/g)).toHaveLength(pagesInGroup("apps").length + 1);
      for (const id of pagesInGroup("apps")) {
        const card = html.match(
          new RegExp(`<button[^>]*data-feature="${id}"[\\s\\S]*?</button>`),
        )?.[0];
        expect(card).toContain(`aria-label="Open ${pageDefinitions[id].label}"`);
        expect(card).not.toContain("home-card-description");
        expect(card).toContain(`data-icon="${pageDefinitions[id].icon}"`);
        expect(card?.includes('disabled=""')).toBe(!pageAvailable(id, database));
        expect(card?.includes('title="Connect to a database first"')).toBe(
          !pageAvailable(id, database),
        );
      }
      const studio = html.match(/<button[^>]*data-feature="automations"[\s\S]*?<\/button>/)?.[0];
      expect(studio).toContain('aria-label="Open Scheduled Jobs"');
      expect(studio).toContain('data-icon="app-robotic-arm"');
      expect(studio).not.toContain("disabled");
      expect(html.indexOf("Open Prompt Builder")).toBeLessThan(html.indexOf("Open Scheduled Jobs"));
      const viewer = html.match(/<button[^>]*data-feature="tables"[\s\S]*?<\/button>/)?.[0];
      expect(viewer).toContain('aria-label="Open Data Viewer"');
      expect(viewer).toContain('data-icon="app-database"');
      expect(viewer).not.toContain("disabled");
      expect(html.indexOf("Open Command Builder")).toBeLessThan(html.indexOf("Open Data Viewer"));
      expect(html.indexOf("Open Data Viewer")).toBeLessThan(html.indexOf("Open Prompt Builder"));
      const manager = html.match(
        /<button[^>]*data-feature="system-manager"[\s\S]*?<\/button>/,
      )?.[0];
      expect(manager).toContain('aria-label="Open System Manager"');
      expect(manager).toContain('data-icon="app-system-manager"');
      expect(manager).not.toContain("disabled");
      expect(html.indexOf("Open Prompt Builder")).toBeLessThan(html.indexOf("Open System Manager"));
      expect(html).not.toContain("Open Relay");
    },
  );
});
