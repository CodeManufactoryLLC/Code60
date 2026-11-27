import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AppsPage } from "./apps-page.js";
import { pageAvailable, pageDefinitions, pagesInGroup } from "./navigation.js";

describe("Apps home", () => {
  it("lists destinations as named actions without decorative artwork", () => {
    const html = renderToStaticMarkup(<AppsPage database="/db" onOpen={() => {}} />);
    expect(html).toContain('aria-label="Open Scheduled Jobs"');
    expect(html).not.toContain('class="navigation-icon"');
  });
  it("opens the relocated preferences from their database-independent Apps cards", () => {
    const onOpen = vi.fn();
    const home = AppsPage({ database: null, onOpen });
    const labels = home.props.cards.map((card: { label: string }) => card.label);
    expect(labels).toEqual([
      "Appearance",
      "Commands",
      "Data Viewer",
      "Health Check",
      "Heartbeat",
      "Internal Prompts",
      "MCP Servers",
      "Memory",
      "Polling",
      "Scheduled Jobs",
      "System Manager",
      "Updates",
      "Usage",
      "Vector Search",
      "Workflows",
    ]);
    for (const card of home.props.cards.filter((card: { id: string }) =>
      ["appearance", "memory", "polling-settings", "updates"].includes(card.id),
    )) {
      expect(card.available).toBe(true);
      home.props.onOpen(card);
    }
    expect(onOpen.mock.calls.map(([id]) => id)).toEqual([
      "appearance",
      "memory",
      "polling-settings",
      "updates",
    ]);
  });

  it.each([null, "/database.sqlite"])(
    "shows a labelled card for every nested app with database gating (%s)",
    (database) => {
      const html = renderToStaticMarkup(<AppsPage database={database} onOpen={() => {}} />);
      expect(html).toContain('id="apps-title" class="content-page-title"');
      expect(html).toContain('<span class="page-title-text">Apps</span>');
      expect(html.match(/class="navigation-list-row"/g)).toHaveLength(
        pagesInGroup("apps").length + 5,
      );
      for (const id of pagesInGroup("apps")) {
        const card = html.match(
          new RegExp(`<button[^>]*data-feature="${id}"[\\s\\S]*?</button>`),
        )?.[0];
        expect(card).toContain(`aria-label="Open ${pageDefinitions[id].label}"`);
        expect(card).not.toContain("home-card-description");
        expect(card).not.toContain(`data-icon="${pageDefinitions[id].icon}"`);
        expect(card?.includes('disabled=""')).toBe(!pageAvailable(id, database));
        expect(card?.includes('title="Connect to a database first"')).toBe(
          !pageAvailable(id, database),
        );
      }
      const studio = html.match(/<button[^>]*data-feature="automations"[\s\S]*?<\/button>/)?.[0];
      expect(studio).toContain('aria-label="Open Scheduled Jobs"');
      expect(studio).not.toContain('data-icon="app-robotic-arm"');
      expect(studio).not.toContain("disabled");
      expect(html.indexOf("Open Internal Prompts")).toBeLessThan(
        html.indexOf("Open Scheduled Jobs"),
      );
      const viewer = html.match(/<button[^>]*data-feature="tables"[\s\S]*?<\/button>/)?.[0];
      expect(viewer).toContain('aria-label="Open Data Viewer"');
      expect(viewer).not.toContain('data-icon="app-database"');
      expect(viewer).not.toContain("disabled");
      expect(html.indexOf("Open Commands")).toBeLessThan(html.indexOf("Open Data Viewer"));
      expect(html.indexOf("Open Data Viewer")).toBeLessThan(html.indexOf("Open Internal Prompts"));
      const manager = html.match(
        /<button[^>]*data-feature="system-manager"[\s\S]*?<\/button>/,
      )?.[0];
      expect(manager).toContain('aria-label="Open System Manager"');
      expect(manager).not.toContain('data-icon="app-system-manager"');
      expect(manager).not.toContain("disabled");
      expect(html.indexOf("Open Internal Prompts")).toBeLessThan(
        html.indexOf("Open System Manager"),
      );
      expect(html).not.toContain("Open Relay");
    },
  );
});
