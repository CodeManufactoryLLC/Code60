import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi } from "../bridge/index.js";
import { PageTabBar } from "./page-tabs.js";
import { initialTabs, type SettingsSectionId } from "./tabs.js";

afterEach(() => vi.unstubAllGlobals());

function navigation(
  database: string | null,
  directory?: string,
  settingsSection: SettingsSectionId = "agents",
  active = initialTabs.active,
  expanded = true,
) {
  vi.stubGlobal("localStorage", { getItem: () => String(expanded), setItem: () => {} });
  return renderToStaticMarkup(
    <PageTabBar
      tabs={{ ...initialTabs, active }}
      settingsSection={settingsSection}
      directory={directory}
      database={database}
      onSelect={() => {}}
      onSettingsSectionSelect={() => {}}
      onOpenProject={() => {}}
      onConnectDatabase={() => {}}
      projectDisabled={false}
      api={{} as DesktopApi}
      chats={[]}
      runs={[]}
      onWorkerSelect={() => {}}
      selectedId={undefined}
      navigationSerial={undefined}
      eventsByRun={{}}
    />,
  );
}

describe("database connection navigation", () => {
  it("leaves the separate database action to the application footer", () => {
    for (const database of [null, "/database.sqlite"]) {
      const html = navigation(database);
      expect(html).not.toContain('aria-label="Select or create database"');
      expect(html).not.toContain("sidebar-actions");
    }
  });

  it("replaces project identity with database connection and disables workspace destinations", () => {
    const html = navigation(null, "/old-project");
    const card = html.match(
      /<button[^>]*class="sidebar-header project-card"[\s\S]*?<\/button>/,
    )?.[0];
    expect(card).toContain("Connect to database");
    expect(card).not.toContain("old-project");
    expect(card).not.toContain("disabled");
    for (const id of ["prompts", "search", "sessions", "episodic-memory"]) {
      expect(html.match(new RegExp(`<button[^>]*id="tab-${id}"[^>]*>`))?.[0]).toContain("disabled");
    }
    expect(html.match(/<button[^>]*id="tables-toggle"[^>]*>/)?.[0]).not.toContain("disabled");
    expect(html.match(/<button[^>]*id="tab-logs"[^>]*>/)?.[0]).not.toContain("disabled");
    expect(html.indexOf('id="tab-events"')).toBeLessThan(html.indexOf('id="tab-logs"'));
    expect(html.indexOf('id="tab-logs"')).toBeLessThan(html.indexOf('id="tab-messages"'));
    expect(html.match(/<button[^>]*id="tab-settings"[^>]*>/)?.[0]).not.toContain("disabled");
    for (const section of [
      "agents",
      "appearance",
      "table-defaults",
      "text",
      "polling-settings",
      "updates",
      "about",
    ]) {
      expect(
        html.match(new RegExp(`<button[^>]*id="tab-settings-${section}"[^>]*>`))?.[0],
      ).not.toContain("disabled");
    }
    expect(html.match(/<button[^>]*id="tab-chat"[^>]*>/)?.[0]).not.toContain("disabled");
  });
  it("restores the project selector and workspace controls with a database", () => {
    for (const directory of [undefined, "/project"]) {
      const html = navigation("/database.sqlite", directory);
      expect(html).toContain(directory ? ">project</span>" : "Open a project");
      expect(html).not.toContain("Connect to database");
      expect(html.match(/<button[^>]*id="tab-prompts"[^>]*>/)?.[0]).not.toContain("disabled");
      expect(html.match(/<button[^>]*id="tables-toggle"[^>]*>/)?.[0]).not.toContain("disabled");
    }
  });
  it("nests each settings section as its own page before Advanced", () => {
    const html = navigation("/database.sqlite", undefined, "appearance", "settings");
    const sections = [
      ["agents", "Agents"],
      ["appearance", "Appearance"],
      ["table-defaults", "Table defaults"],
      ["text", "Text"],
      ["polling-settings", "Polling"],
      ["updates", "Updates"],
      ["about", "About"],
    ] as const;
    for (const [section, label] of sections) {
      const tab = html.match(
        new RegExp(`<button[^>]*id="tab-settings-${section}"[\\s\\S]*?</button>`),
      )?.[0];
      expect(tab).toContain(`aria-controls="panel-settings-${section}"`);
      expect(tab).toContain(label);
    }
    expect(html.match(/<button[^>]*id="tab-settings-appearance"[^>]*>/)?.[0]).toContain(
      'aria-selected="true"',
    );
    expect(html.indexOf('id="settings-pages"')).toBeLessThan(
      html.indexOf('id="tab-settings-agents"'),
    );
    expect(html.indexOf('id="tab-settings-about"')).toBeLessThan(
      html.indexOf('id="advanced-toggle"'),
    );
  });
});

describe("sidebar labels and disclosure icons", () => {
  it.each([true, false])(
    "keeps disclosure contents mounted and immediately inaccessible when closed (expanded: %s)",
    (expanded) => {
      const html = navigation(
        "/database.sqlite",
        undefined,
        "agents",
        initialTabs.active,
        expanded,
      );
      for (const id of [
        "chat-pages",
        "table-pages",
        "settings-pages",
        "advanced-pages",
        "experiment-pages",
      ]) {
        const group = html.match(new RegExp(`<div[^>]*id="${id}"[^>]*>`))?.[0];
        expect(group).toContain(`aria-hidden="${!expanded}"`);
        if (expanded) {
          expect(group).not.toContain('hidden=""');
          expect(group).not.toContain('inert=""');
        } else {
          expect(group).toContain('hidden=""');
          expect(group).toContain('inert=""');
        }
      }
      expect(html).toContain('id="tab-configurations"');
      expect(html).toContain('id="tab-settings-text"');
      expect(html).toContain('id="tab-episodic-memory"');
    },
  );

  it.each([true, false])("keeps navigation icons decorative (expanded: %s)", (expanded) => {
    for (const database of [null, "/database.sqlite"]) {
      const html = navigation(database, undefined, "agents", initialTabs.active, expanded);
      const promptTab = html.match(/<button[^>]*id="tab-prompts"[\s\S]*?<\/button>/)?.[0];
      const project = html.match(
        /<button[^>]*class="sidebar-header project-card"[\s\S]*?<\/button>/,
      )?.[0];
      expect(promptTab).toContain("Prompt Editor");
      expect(promptTab).toContain('data-icon="pencil-line"');
      expect(project).not.toContain("<svg");
      expect(html).not.toContain("<img");
      expect(html.match(/<svg/g)).toHaveLength(12);
      expect(html.match(/class="navigation-icon"/g)).toHaveLength(6);
      for (const [id, icon, label] of [
        ["tab-chat", "chats", "Chat"],
        ["tab-prompts", "pencil-line", "Prompt Editor"],
        ["tab-commands", "megaphone", "Commands"],
        ["tab-settings", "gear", "Settings"],
        ["tab-search", "magnifying-glass", "Search"],
        ["tables-toggle", "database", "Tables"],
      ]) {
        const tab = html.match(new RegExp(`<button[^>]*id="${id}"[\\s\\S]*?</button>`))?.[0];
        expect(tab).toContain(`data-icon="${icon}"`);
        expect(tab).toContain(`class="page-tab-label">${label}</span>`);
        expect(tab).toMatch(/class="navigation-icon"[^>]*aria-hidden="true"[^>]*focusable="false"/);
        expect(tab).toContain('opacity="0.2"');
      }
      for (const id of ["tab-settings-agents", "tab-configurations", "tab-logs"]) {
        const tab = html.match(new RegExp(`<button[^>]*id="${id}"[\\s\\S]*?</button>`))?.[0];
        expect(tab).not.toContain("navigation-icon");
      }
      const newChat = html.match(/<button[^>]*aria-label="New chat"[\s\S]*?<\/button>/)?.[0];
      expect(newChat).toContain('class="icon-button chat-sidebar-new"');
      expect(newChat?.match(/<svg/g)).toHaveLength(1);
      expect(newChat).not.toContain(">New<");
      const settingsToggle = html.match(
        /<button[^>]*aria-label="Settings pages"[\s\S]*?<\/button>/,
      )?.[0];
      expect(settingsToggle).toContain("<svg");
      expect(settingsToggle).toContain(`aria-expanded="${expanded}"`);
      for (const id of ["tab-chat", "tables-toggle", "advanced-toggle", "experiments-toggle"]) {
        const toggle = html.match(new RegExp(`<button[^>]*id="${id}"[\\s\\S]*?</button>`))?.[0];
        expect(toggle).toContain(`aria-expanded="${expanded}"`);
        expect(toggle?.match(/class="carbon-icon"/g)).toHaveLength(1);
      }
    }
  });
});
