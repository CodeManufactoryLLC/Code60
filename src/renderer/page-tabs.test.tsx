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
      onSettingsSectionSelect={() => {}}
      onOpenProject={() => {}}
      onConnectDatabase={() => {}}
      projectDisabled={false}
      navigation={{
        open: async () => true,
        chatAction: async () => true,
        projectAction: async () => true,
        invalidate: () => {},
        pending: false,
        busy,
        projectPending: false,
        conversationPending: false,
        error: "",
      }}
      chats={[]}
      runs={[]}
      selectedId={undefined}
      navigationSerial={undefined}
      eventsByRun={{}}
    />,
  );
}

describe("database connection navigation", () => {
  it("shows the nine navigation groups and their destinations in order", () => {
    const html = navigation(null);
    const groups = html.split('id="nav-group-').slice(1);
    expect(groups.map((group) => group.split('"')[0])).toEqual([
      "Chat",
      "Develop",
      "Automate",
      "Connect",
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
      ["relay", "custom-agents"],
      ["projects", "workflows"],
      ["automations"],
      ["mcp-servers", "providers"],
      ["prompts", "commands", "customize-mcp-servers"],
      ["appearance", "table-defaults", "text"],
      ["about", "health-check", "polling-settings", "system-manager", "updates"],
      ["episodic-memory", "rag"],
      ["web-server"],
    ]);
    for (const label of [
      "Relay",
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
  it("keeps responsive navigation, Commands and Workspace in the header", () => {
    const html = navigation(null);
    expect(html).toContain('aria-label="Open product navigation"');
    expect(html).toContain('aria-controls="navigation-sidebar"');
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

  it("replaces project identity with database connection and disables workspace destinations", () => {
    const html = navigation(null, "/old-project");
    const card = html.match(
      /<button[^>]*class="icon-button project-sidebar-open[^"]*"[\s\S]*?<\/button>/,
    )?.[0];
    expect(card).toContain("Connect to database to add a project");
    expect(card).toContain("Add Project");
    expect(card).not.toContain("old-project");
    expect(card).not.toContain("disabled");
    for (const id of ["prompts", "commands", "episodic-memory", "rag"]) {
      expect(html.match(new RegExp(`<button[^>]*id="tab-${id}"[^>]*>`))?.[0]).toContain("disabled");
    }
    for (const id of ["chat", "mcp-servers", "settings-polling-settings", "settings-updates"]) {
      const tab = html.match(new RegExp(`<button[^>]*id="tab-${id}"[^>]*>`))?.[0];
      expect(tab).toBeDefined();
      expect(tab).not.toContain("disabled");
    }
  });
  it("keeps the Add Project action and workspace controls independent of the selected folder", () => {
    for (const directory of [undefined, "/project"]) {
      const html = navigation("/database.sqlite", directory);
      expect(html).toContain('aria-label="Add Project"');
      expect(html).not.toContain("sidebar-header");
      expect(html).toContain('title="Add Project"');
      const action = html.indexOf('class="icon-button project-sidebar-open[^"]*"');
      expect(html).not.toContain('id="projects-card-toggle"');
      expect(action).toBeLessThan(html.indexOf('id="chat-pages"'));
      expect(html).not.toContain('class="page-tab-label">Add Project</span>');
      expect(html).not.toContain(">project</span>");
      expect(html).not.toContain("Connect to database");
      expect(html.match(/<button[^>]*id="tab-prompts"[^>]*>/)?.[0]).not.toContain("disabled");
    }
  });
  it.each([
    ["appearance", "Personalize"],
    ["about", "Manage"],
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
