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
  it("groups Relay and Custom Assistants beneath a navigable Assistants heading", () => {
    const html = navigation(null);
    expect(html).toMatch(/class="[^"]*sidebar-navigation-card\b/);
    expect(html).toContain("cds--side-nav");
    expect(html).toContain("cds--header");
    expect(html).not.toContain("nb:group/card");
    expect(html.match(/class="[^"]*sidebar-section[^"]*"/g)).toHaveLength(6);
    expect(html).not.toContain('id="assistants-toggle"');
    expect(html).toContain('id="assistants-pages"');
    expect(html).toContain('aria-label="Automation"');
    expect(html.indexOf('id="assistants-pages"')).toBeLessThan(
      html.indexOf('id="tab-custom-agents"'),
    );
    expect(html.indexOf('id="tab-custom-agents"')).toBeLessThan(html.indexOf('id="tab-chat"'));
    expect(html).toContain('id="tab-assistants"');
    expect(html).toContain('aria-controls="panel-assistants"');
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
    expect(html).toContain(">Commands</button>");
    expect(html).toContain(">Workspace</button>");
  });
  it.each([true, false])(
    "selects Settings itself on its home page without selecting a child (expanded %s)",
    (expanded) => {
      const html = navigation(null, undefined, null, "settings", expanded);
      const tab = html.match(/<button[^>]*id="tab-settings"[^>]*>/)?.[0];
      expect(tab).toContain('aria-selected="true"');
      expect(tab).not.toContain("aria-expanded");
      expect(html.match(/data-nav-active="true"/g)).toHaveLength(1);
      for (const child of html.matchAll(/<button[^>]*id="tab-settings-[^"]+"[^>]*>/g))
        expect(child[0]).toContain('aria-selected="false"');
    },
  );

  it("shows Search as a labelled selected page tab before Projects, without a utility row", () => {
    const html = navigation("/database.sqlite", undefined, "appearance", "search");
    const search = html.match(/<button[^>]*id="tab-search"[\s\S]*?<\/button>/)?.[0];
    expect(search).toContain('class="page-tab-label">Search</span>');
    expect(search).toContain('aria-selected="true"');
    expect(search).toContain('aria-controls="panel-search"');
    expect(search).not.toContain("<img");
    expect(search).toContain('role="tab"');
    expect(search).toContain('tabindex="0"');
    expect(search).not.toContain("icon-button");
    expect(search).not.toContain("disabled");
    expect(html.match(/id="tab-search"/g)).toHaveLength(1);
    expect(html.indexOf('id="tab-search"')).toBeGreaterThan(html.indexOf('class="page-tabs"'));
    expect(html.indexOf('id="tab-home"')).toBeLessThan(html.indexOf('id="tab-search"'));
    expect(html.indexOf('id="tab-search"')).toBeLessThan(html.indexOf('id="tab-chat"'));
    expect(html).not.toContain("sidebar-toolbar");
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
    for (const id of ["prompts", "search", "sessions", "episodic-memory", "rag"]) {
      expect(html.match(new RegExp(`<button[^>]*id="tab-${id}"[^>]*>`))?.[0]).toContain("disabled");
    }
    expect(html.match(/<button[^>]*id="tables-toggle"[^>]*>/)?.[0]).not.toContain("disabled");
    expect(html.match(/<button[^>]*id="tab-logs"[^>]*>/)?.[0]).not.toContain("disabled");
    expect(html.match(/<button[^>]*id="tab-memories"[^>]*>/)?.[0]).not.toContain("disabled");
    expect(html.indexOf('id="tab-events"')).toBeLessThan(html.indexOf('id="tab-logs"'));
    expect(html.indexOf('id="tab-logs"')).toBeLessThan(html.indexOf('id="tab-messages"'));
    expect(html.match(/<button[^>]*id="tab-settings"[^>]*>/)?.[0]).not.toContain("disabled");
    for (const section of [
      "memory",
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
      expect(html.match(/<button[^>]*id="tables-toggle"[^>]*>/)?.[0]).not.toContain("disabled");
    }
  });
  it("nests Settings sub-pages alphabetically, including Advanced and its children", () => {
    const html = navigation("/database.sqlite", undefined, "appearance", "settings");
    const sections = [
      ["memory", "Memory"],
      ["appearance", "Appearance"],
      ["table-defaults", "Table defaults"],
      ["text", "Text"],
      ["polling-settings", "Polling"],
      ["updates", "Update Manager"],
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
    expect(html.indexOf('id="app-pages"')).toBeLessThan(
      html.indexOf('id="tab-settings-appearance"'),
    );
    expect(html.indexOf('id="tab-settings-about"')).toBeLessThan(
      html.indexOf('id="advanced-toggle"'),
    );
    const order = [
      "tab-settings-about",
      "advanced-toggle",
      "tab-contributor-tools",
      "experiments-toggle",
      "tab-episodic-memory",
      "tab-rag",
      "tab-settings-table-defaults",
      "tab-settings-text",
    ];
    for (let index = 1; index < order.length; index++) {
      expect(html.indexOf(`id="${order[index - 1]}"`)).toBeLessThan(
        html.indexOf(`id="${order[index]}"`),
      );
    }
  });
});

describe("sidebar labels and disclosure icons", () => {
  it.each(["appearance", "memory", "polling-settings", "updates"] as const)(
    "keeps the selected Apps preference %s in its always-open card",
    (section) => {
      const html = navigation(null, undefined, section, "settings", false);
      expect(html.match(/<button[^>]*id="tab-settings"[^>]*>/)?.[0]).toContain(
        'aria-selected="false"',
      );
      expect(html.match(/<button[^>]*id="tab-apps"[^>]*>/)?.[0]).toContain('data-active="false"');
      expect(html.indexOf(`id="tab-settings-${section}"`)).toBeLessThan(
        html.indexOf('id="settings-pages"'),
      );
    },
  );

  it.each([null, "/db"])(
    "places automation and inspection routes in task order (%s)",
    (database) => {
      const html = navigation(database, undefined, null, "automations");
      const ids = [
        "tab-chat",
        "tab-automations",
        "tab-workflows",
        "tables-toggle",
        "tab-logs",
        "tab-providers",
        "tab-settings",
      ];
      for (const [index, id] of ids.entries()) {
        expect(html).toContain(`id="${id}"`);
        if (index)
          expect(html.indexOf(`id="${id}"`)).toBeGreaterThan(
            html.indexOf(`id="${ids[index - 1]}"`),
          );
      }
      expect(html.match(/<button[^>]*id="tab-automations"[^>]*>/)?.[0]).toContain(
        'aria-selected="true"',
      );
    },
  );
  it.each([true, false])("selects Apps independently of its expansion (%s)", (expanded) => {
    const html = navigation(null, undefined, "appearance", "apps", expanded);
    const tab = html.match(/<button[^>]*id="tab-apps"[\s\S]*?<\/button>/)?.[0];
    expect(tab).toContain('role="tab"');
    expect(tab).toContain('aria-selected="true"');
    expect(tab).toContain('aria-controls="panel-apps"');
    expect(tab).not.toContain("aria-expanded");
    expect(tab).not.toContain('disabled=""');
  });

  it.each([true, false])(
    "keeps disclosure contents mounted and immediately inaccessible when closed (expanded: %s)",
    (expanded) => {
      const html = navigation(
        "/database.sqlite",
        undefined,
        "appearance",
        initialTabs.active,
        expanded,
      );
      for (const id of [
        "chat-pages",
        "app-pages",
        "table-pages",
        "settings-pages",
        "advanced-pages",
        "experiment-pages",
      ]) {
        const group = html.match(new RegExp(`<div[^>]*id="${id}"[^>]*>`))?.[0];
        const closed = !expanded && !["chat-pages", "app-pages", "settings-pages"].includes(id);
        expect(group).toContain(`aria-hidden="${closed}"`);
        if (!closed) {
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
      expect(html).toContain('id="tab-rag"');
    },
  );
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
