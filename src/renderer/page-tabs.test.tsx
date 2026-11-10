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
) {
  vi.stubGlobal("localStorage", { getItem: () => "true", setItem: () => {} });
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

describe("page navigation icons", () => {
  it("uses Carbon's Prompt Template UI icon for Prompt Editor", () => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
    const html = renderToStaticMarkup(
      <PageTabBar
        tabs={{ open: ["prompts"], active: "prompts" }}
        settingsSection="agents"
        onSelect={() => {}}
        onSettingsSectionSelect={() => {}}
        onOpenProject={() => {}}
        projectDisabled={false}
        api={{} as DesktopApi}
        chats={[]}
        runs={[]}
        onWorkerSelect={() => {}}
        selectedId={undefined}
        navigationSerial={undefined}
        database={null}
        eventsByRun={{}}
      />,
    );
    const promptTab = html.match(/<button[^>]*id="tab-prompts"[\s\S]*?<\/button>/)?.[0];

    expect(promptTab).toContain('viewBox="0 0 32 32"');
    expect(promptTab).toContain("m31.5,23");
  });
});
