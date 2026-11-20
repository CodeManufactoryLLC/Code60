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
) {
  vi.stubGlobal("localStorage", {
    getItem: (key: string) =>
      key === "code60.sidebarOpen" ? String(sidebarOpen) : String(expanded),
    setItem: () => {},
  });
  return renderToStaticMarkup(
    <PageTabBar
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
    expect(html).toMatch(/class="[^"]*sidebar-navigation-card"/);
    expect(html.match(/data-slot="card"/g)).toHaveLength(7);
    expect(html).toContain('id="assistants-toggle"');
    expect(html).toContain('aria-controls="assistants-pages"');
    expect(html).toContain('data-icon="app-assistants"');
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
  it.each([true, false])(
    "keeps a reachable external toggle and mounted navigation (open %s)",
    (open) => {
      const html = navigation(null, undefined, null, "home", true, open);
      const sidebar = html.match(/<nav[^>]*id="navigation-sidebar"[^>]*>/)?.[0];
      expect(sidebar).toContain(`data-open="${open}"`);
      expect(sidebar).toContain(`aria-hidden="${!open}"`);
      expect(sidebar?.includes('inert=""')).toBe(!open);
      expect(html).toContain('id="tab-home"');
      expect(html).toContain('id="tab-search"');
      const toggle = html.match(/<button[^>]*class="icon-button sidebar-toggle"[^>]*>/)?.[0];
      expect(toggle).toContain(`aria-label="${open ? "Close" : "Open"} navigation sidebar"`);
      expect(toggle).toContain(`aria-expanded="${open}"`);
      expect(toggle).toContain('aria-controls="navigation-sidebar"');
      expect(html.indexOf('class="icon-button sidebar-toggle"')).toBeGreaterThan(
        html.lastIndexOf("</nav>"),
      );
      expect(html).toContain('<header class="workspace-header">');
      expect(html.indexOf('class="icon-button sidebar-toggle"')).toBeGreaterThan(
        html.indexOf('<header class="workspace-header"'),
      );
      expect(html.indexOf('class="icon-button sidebar-toggle"')).toBeLessThan(
        html.indexOf("</header>"),
      );
    },
  );
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
    expect(search).toContain('data-icon="app-search"');
    expect(search).toContain('alt="" aria-hidden="true" draggable="false"');
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
      /<button[^>]*class="icon-button project-sidebar-open"[\s\S]*?<\/button>/,
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
      const action = html.indexOf('class="icon-button project-sidebar-open"');
      expect(action).toBeLessThan(html.indexOf('id="projects-card-toggle"'));
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
      "tab-settings-appearance",
      "tab-settings-memory",
      "tab-settings-polling-settings",
      "tab-settings-table-defaults",
      "tab-settings-text",
      "tab-settings-updates",
    ];
    for (let index = 1; index < order.length; index++) {
      expect(html.indexOf(`id="${order[index - 1]}"`)).toBeLessThan(
        html.indexOf(`id="${order[index]}"`),
      );
    }
  });
});

describe("sidebar labels and disclosure icons", () => {
  it("nests Data Viewer alphabetically under Apps and gives every child the grid icon", () => {
    const html = navigation("/database.sqlite");
    const order = [
      "app-pages",
      "tab-commands",
      "tables-toggle",
      "table-pages",
      "tab-configurations",
      "tab-events",
      "tab-logs",
      "tab-memories",
      "tab-messages",
      "tab-polling",
      "tab-sessions",
      "tab-worktrees",
      "tab-prompts",
      "tab-automations",
      "tab-system-manager",
      "tab-settings",
    ];
    for (let index = 1; index < order.length; index++) {
      expect(html.indexOf(`id="${order[index - 1]}"`)).toBeLessThan(
        html.indexOf(`id="${order[index]}"`),
      );
    }
    for (const id of [
      "configurations",
      "events",
      "logs",
      "memories",
      "messages",
      "polling",
      "sessions",
      "worktrees",
    ]) {
      const tab = html.match(new RegExp(`<button[^>]*id="tab-${id}"[\\s\\S]*?</button>`))?.[0];
      expect(tab).toContain('data-icon="app-table"');
    }
    expect(html).toContain('aria-label="Data Viewer"');
    expect(html).not.toContain('title="Tables"');
  });

  it.each([null, "/database.sqlite"])(
    "nests the database-independent Scheduled Jobs destination under Apps (%s)",
    (database) => {
      const html = navigation(database, undefined, "appearance", "automations");
      const studio = html.match(/<button[^>]*id="tab-automations"[\s\S]*?<\/button>/)?.[0];
      expect(studio).toContain('aria-selected="true"');
      expect(studio).toContain("Scheduled Jobs");
      expect(studio).not.toContain("disabled");
      expect(html.match(/id="tab-automations"/g)).toHaveLength(1);
      expect(html.indexOf('id="app-pages"')).toBeLessThan(html.indexOf('id="tab-automations"'));
      expect(html.indexOf('id="tables-toggle"')).toBeLessThan(html.indexOf('id="tab-automations"'));
      expect(html).not.toContain('aria-label="Automations page"');
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
      expect(html).toContain('id="tab-rag"');
    },
  );

  it.each([true, false])("keeps navigation icons decorative (expanded: %s)", (expanded) => {
    for (const database of [null, "/database.sqlite"]) {
      const html = navigation(database, undefined, "appearance", initialTabs.active, expanded);
      const promptTab = html.match(/<button[^>]*id="tab-prompts"[\s\S]*?<\/button>/)?.[0];
      const project = html.match(
        /<button[^>]*class="icon-button project-sidebar-open"[\s\S]*?<\/button>/,
      )?.[0];
      expect(promptTab).toContain("Prompt Builder");
      expect(promptTab).toContain('data-icon="app-ai"');
      expect(project).toContain("<svg");
      expect(html.match(/<img/g)).toHaveLength(31);
      expect(html.match(/class="carbon-icon"/g)).toHaveLength(9);
      expect(html.match(/class="navigation-icon"/g)).toHaveLength(33);
      for (const [id, icon, label] of [
        ["tab-home", "app-home2", "Home"],
        ["tab-search", "app-search", "Search"],
        ["tab-automations", "app-robotic-arm", "Scheduled Jobs"],
        ["tab-system-manager", "app-system-manager", "System Manager"],
        ["tab-chat", "app-backlog", "Projects"],
        ["tab-prompts", "app-ai", "Prompt Builder"],
        ["tab-commands", "app-megaphone", "Command Builder"],
        ["tab-settings", "app-cogwheel", "Settings"],
        ["tab-apps", "app-apps", "Apps"],
        ["tables-toggle", "app-database", "Data Viewer"],
        ["tab-configurations", "app-table", "Configurations"],
        ["tab-logs", "app-table", "Logs"],
        ["tab-settings-table-defaults", "app-table", "Table defaults"],
        ["tab-settings-memory", "app-bookshelf", "Memory"],
        ["tab-settings-appearance", "app-color-palette", "Appearance"],
        ["tab-settings-text", "app-text-size", "Text"],
        ["tab-settings-polling-settings", "app-heart-rate", "Polling"],
        ["tab-settings-updates", "app-cloud-computing", "Updates"],
        ["tab-settings-about", "app-info", "About"],
        ["advanced-toggle", "app-analyze", "Advanced"],
        ["experiments-toggle", "app-chemical", "Experiments"],
        ["tab-episodic-memory", "brain", "Episodic Memory"],
        ["tab-contributor-tools", "app-under-construction", "Contributor Tools"],
      ] as const) {
        const tab = html.match(new RegExp(`<button[^>]*id="${id}"[\\s\\S]*?</button>`))?.[0];
        expect(tab).toContain(`data-icon="${icon}"`);
        expect(tab).toContain(`class="page-tab-label">${label}</span>`);
        expect(tab).toMatch(/class="navigation-icon"[^>]*aria-hidden="true"/);
        if (icon.startsWith("app-")) {
          expect(tab).toContain('alt=""');
          expect(tab).toContain('draggable="false"');
        } else {
          expect(tab).toContain('focusable="false"');
          expect(tab).toContain('opacity="0.2"');
        }
      }
      expect(project).toContain('class="icon-button project-sidebar-open"');
      expect(project?.match(/<svg/g)).toHaveLength(1);
      expect(project).toContain('aria-haspopup="dialog"');
      expect(html).not.toContain('aria-label="New chat"');
      const settingsToggle = html.match(/<button[^>]*id="tab-settings"[\s\S]*?<\/button>/)?.[0];
      expect(settingsToggle).toContain("<img");
      expect(settingsToggle).not.toContain("aria-expanded");
      for (const id of [
        "home-card-toggle",
        "assistants-toggle",
        "projects-card-toggle",
        "apps-card-toggle",
        "settings-card-toggle",
      ]) {
        const toggle = html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`))?.[0];
        expect(toggle).toContain(`aria-expanded="${expanded}"`);
        expect(toggle).toContain('class="icon-button sidebar-card-toggle"');
        expect(toggle).toContain('data-tooltip=""');
        expect(toggle).not.toContain("title=");
      }
      for (const id of ["tables-toggle", "advanced-toggle", "experiments-toggle"]) {
        const toggle = html.match(new RegExp(`<button[^>]*id="${id}"[\\s\\S]*?</button>`))?.[0];
        expect(toggle).toContain(`aria-expanded="${expanded}"`);
        expect(toggle).not.toContain('class="carbon-icon"');
      }
    }
  });
});
