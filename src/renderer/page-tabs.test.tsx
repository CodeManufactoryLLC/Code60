import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PageTabBar } from "./page-tabs.js";
import { initialTabs, type SettingsSectionId } from "./tabs.js";

afterEach(() => vi.unstubAllGlobals());

function navigation(
  database: string | null,
  _directory?: string,
  settingsSection: SettingsSectionId | null = "appearance",
  active = initialTabs.active,
  expanded = true,
  sidebarOpen = true,
  busy = false,
  history = { canGoBack: false, canGoForward: false },
) {
  vi.stubGlobal("localStorage", {
    getItem: (key: string) =>
      key === "code60.sidebarOpen" ? String(sidebarOpen) : String(expanded),
    setItem: () => {},
  });
  return renderToStaticMarkup(
    <PageTabBar
      showRelayDot={false}
      onShowRelayDotChange={() => {}}
      theme="system"
      onThemeChange={() => {}}
      {...history}
      tabs={{ ...initialTabs, active }}
      settingsSection={settingsSection}
      database={database}
      onSelect={() => {}}
      onOpenChat={() => {}}
      onSettingsSectionSelect={() => {}}
      navigation={{ busy }}
      chats={[]}
    />,
  );
}

describe("database connection navigation", () => {
  it("shows the top-level Chat button followed by the eight navigation groups in order", () => {
    const html = navigation(null);
    expect(html).toContain('data-sidebar-item="chat"');
    expect(html).toContain('id="tab-chat"');
    expect(html).toContain(">Chat</span>");
    expect(html).not.toContain('id="nav-group-Chat"');
    expect(html).not.toContain('id="nav-group-Develop"');
    expect(html).not.toContain('data-sidebar-item="projects"');

    const groups = html.split('id="nav-group-').slice(1);
    expect(groups.map((group) => group.split('"')[0])).toEqual([
      "Automate",
      "Connect",
      "Context",
      "Customize",
      "Personalize",
      "Manage",
      "Contributor-Tools",
      "Experiments",
    ]);
    expect(
      groups.map((group) =>
        [...group.matchAll(/data-sidebar-item="([^"]+)"/g)].map((match) => match[1]),
      ),
    ).toEqual([
      ["automations", "workflows"],
      ["mcp-servers", "providers"],
      ["vector-search", "memory", "commands", "prompts"],
      ["custom-agents", "customize-mcp-servers"],
      ["appearance", "table-defaults", "text"],
      ["about", "health-check", "polling-settings", "system-manager", "updates", "usage"],
      ["episodic-memory", "rag"],
      ["web-server"],
    ]);
    for (const label of [
      "Chat",
      "Workflows",
      "Vector Search",
      "Memory",
      "Custom Assistants",
      "Internal Prompts",
      "Table Defaults",
      "Updates",
      "Memory Tester",
      "Retrieval Tests",
      "Web Server (Beta)",
    ])
      expect(html).toContain(`>${label}<`);
    expect(html.match(/aria-controls="panel-mcp-servers"/g)).toHaveLength(2);
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it.each([true, false])(
    "marks the sidebar busy only while navigation is in flight (%s)",
    (busy) => {
      const html = navigation(null, undefined, null, "home", true, true, busy);
      const sidebar = html.match(/<nav[^>]*id="navigation-sidebar"[^>]*>/)?.[0];
      expect(sidebar?.includes('aria-busy="true"')).toBe(busy);
    },
  );
  it("keeps responsive navigation, centered auto-approve checkbox, Commands and Workspace in the header", () => {
    const html = navigation(null);
    expect(html).toContain('aria-label="Open product navigation"');
    expect(html).toContain('aria-controls="navigation-sidebar"');
    expect(html).toContain('class="product-header-center"');
    expect(html).toContain(">auto-approve<");
    expect(html).toContain('aria-label="Commands"');
    expect(html).toContain(">Workspace</button>");
  });
  it("leaves the separate database action to the application footer", () => {
    for (const database of [null, "/database.sqlite"]) {
      const html = navigation(database);
      expect(html).not.toContain('aria-label="Select or create database"');
      expect(html).not.toContain("sidebar-actions");
    }
  });

  it("keeps Chat enabled and disables database-dependent destinations without a database", () => {
    const html = navigation(null, "/old-project");
    expect(html).not.toContain("project-sidebar-open");
    expect(html).not.toContain('aria-label="Add Project"');
    expect(html).not.toContain("old-project");
    for (const id of ["prompts", "commands", "episodic-memory", "rag"]) {
      expect(html.match(new RegExp(`<button[^>]*id="tab-${id}"[^>]*>`))?.[0]).toContain("disabled");
    }
    for (const id of [
      "chat",
      "workflows",
      "vector-search",
      "settings-memory",
      "custom-agents",
      "mcp-servers",
      "settings-polling-settings",
      "settings-updates",
    ]) {
      const tab = html.match(new RegExp(`<button[^>]*id="tab-${id}"[^>]*>`))?.[0];
      expect(tab).toBeDefined();
      expect(tab).not.toContain("disabled");
    }
  });
  it("enables database-dependent workspace controls once connected", () => {
    for (const directory of [undefined, "/project"]) {
      const html = navigation("/database.sqlite", directory);
      expect(html).not.toContain("project-sidebar-open");
      expect(html).not.toContain("sidebar-header");
      expect(html).not.toContain("Connect to database");
      expect(html.match(/<button[^>]*id="tab-prompts"[^>]*>/)?.[0]).not.toContain("disabled");
    }
  });
  it.each([
    ["appearance", "Personalize"],
    ["about", "Manage"],
    ["memory", "Context"],
    ["text", "Personalize"],
    ["polling-settings", "Manage"],
    ["updates", "Manage"],
  ] as const)("reveals the group for the selected %s setting", (section, group) => {
    const html = navigation(null, undefined, section, "settings");
    expect(html.split(`id="nav-group-${group}"`)[1]?.match(/<button[^>]*>/)?.[0]).toContain(
      'aria-expanded="true"',
    );
    expect(html.match(new RegExp(`<button[^>]*id="tab-settings-${section}"[^>]*>`))?.[0]).toContain(
      'aria-selected="true"',
    );
  });
});
describe("header history", () => {
  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])("preserves Back and Forward availability %s/%s", (canGoBack, canGoForward) => {
    const html = navigation(null, undefined, null, "home", false, false, false, {
      canGoBack,
      canGoForward,
    });
    for (const [label, enabled] of [
      ["Back", canGoBack],
      ["Forward", canGoForward],
    ] as const) {
      const button = html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0];
      expect(button).toBeDefined();
      expect(button?.includes("disabled")).toBe(!enabled);
    }
  });
});
