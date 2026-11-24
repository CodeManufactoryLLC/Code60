import { describe, expect, it } from "vitest";
import {
  APPLICATION_CAPABILITIES,
  BUILTIN_COMMANDS,
  capabilityReference,
  isKnowledgeTool,
  MCP_KNOWLEDGE_TOOL_DEFINITIONS,
  MCP_TOOL_DEFINITIONS,
  mcpToolsForRole,
  PAGE_CAPABILITIES,
  pages,
  SETTINGS_CAPABILITIES,
  settingsSections,
  TOOL_CAPABILITIES,
} from "../src/contracts/index.js";

const ids = new Set(APPLICATION_CAPABILITIES.map((capability) => capability.id));

describe("browser capability catalog", () => {
  it("describes consented state-preserving uninstall without granting agent or browser authority", () => {
    const capability = APPLICATION_CAPABILITIES.find((cap) => cap.id === "uninstall");
    expect(capability).toMatchObject({
      prerequisite: "none",
      agentAccess: "human-only",
      access: expect.stringContaining("code60 uninstall [--yes]"),
    });
    expect(capability?.limitations).toContain("No data-purge option");
    expect(capability?.limitations).toContain("readable native procfs ownership evidence");
    expect(capability?.limitations).toContain(
      "unverifiable emulated process mappings refuse removal",
    );
    expect(capability?.limitations).toContain("engine cache/evidence");
    expect(capability?.limitations).toContain("absolute recovery launcher");
    expect(capability?.confirmation).toContain("--yes never approves profiles");
  });
  it("describes bounded human-only JSON editing and recovery choices without runtime authority", () => {
    const mcp = APPLICATION_CAPABILITIES.find((cap) => cap.id === "mcp-servers");
    expect(mcp).toMatchObject({ prerequisite: "none", agentAccess: "human-only" });
    expect(PAGE_CAPABILITIES["mcp-servers"]).toBe("mcp-servers");
    expect(pages.find((page) => page.id === "mcp-servers")?.database).toBe(false);
    expect(mcp?.purpose).toContain("table toolbar");
    expect(mcp?.limitations).toContain("open project and captured runtime/database identity");
    expect(mcp?.limitations).toContain("valid unpinned backup");
    expect(mcp?.limitations).toContain("Pending recovery blocks affected writes");
    expect(mcp?.limitations).toContain("User and this project");
    expect(mcp?.confirmation).toContain("Save, Discard or Cancel");
    expect(mcp?.purpose).toContain("enable, approve, test");
    expect(mcp?.limitations).toContain("idle Reconnect");
    expect(mcp?.limitations).toContain("Tests initialize/discover only");
    expect(mcp?.confirmation).toContain("stdio tests");
    expect(mcp?.purpose).toContain("safe troubleshooting report");
    expect(mcp?.limitations).toContain("newer edits or corrupt evidence block recovery");
    expect(mcp?.limitations).toContain("no force or lock deletion");
    expect(mcp?.confirmation).toContain("Complete/Roll back");
  });
  it("describes scheduler upgrade recovery without granting service authority", () => {
    const updates = APPLICATION_CAPABILITIES.find((cap) => cap.id === "updates");
    expect(updates).toMatchObject({ prerequisite: "none", agentAccess: "human-only" });
    expect(updates?.limitations).toContain("before shutdown");
    expect(updates?.limitations).toContain("No automatic downloads");
  });
  it("describes human-only sidebar/card navigation without a current-page menu", () => {
    expect(APPLICATION_CAPABILITIES.find((cap) => cap.id === "page-navigation")).toMatchObject({
      prerequisite: "none",
      agentAccess: "human-only",
      access: expect.stringContaining("Left navigation sidebar"),
      limitations: expect.stringMatching(
        /Work, Automation, Inspect and Manage.*Skip to main content/,
      ),
    });
    expect(
      APPLICATION_CAPABILITIES.find((cap) => cap.id === "page-navigation")?.limitations,
    ).toContain("Commands and Workspace");
  });
  it("describes content-title commands while keeping navigation and availability human-only", () => {
    const navigation = APPLICATION_CAPABILITIES.find((cap) => cap.id === "page-navigation");
    expect(navigation?.limitations).toContain("Projects and conversations keep their own actions");
    expect(navigation?.limitations).toContain(
      "Restoring a view never sends a request or grants approval",
    );
    expect(navigation?.prerequisite).toBe("none");
    expect(navigation?.agentAccess).toBe("human-only");
    expect(APPLICATION_CAPABILITIES.find((cap) => cap.id === "updates")?.access).toContain(
      "Update Manager",
    );
  });
  it("classifies bounded human-only navigation history without database prerequisites", () => {
    expect(APPLICATION_CAPABILITIES.find((cap) => cap.id === "navigation-history")).toMatchObject({
      access: "Workspace header → Back / Forward",
      prerequisite: "none",
      agentAccess: "human-only",
      limitations: expect.stringContaining("100 destinations"),
    });
    expect(
      APPLICATION_CAPABILITIES.find((cap) => cap.id === "navigation-history")?.limitations,
    ).toContain("Restoring a chat preserves drafts");
  });
  it("exposes conversational browser modes only through the orchestrator gateway", () => {
    expect(APPLICATION_CAPABILITIES.find((cap) => cap.id === "browser")).toMatchObject({
      prerequisite: "provider",
      purpose: expect.stringContaining("Headless, Visible or Existing Browser"),
      limitations: expect.stringContaining("unavailable to workers"),
    });
    for (const role of ["relay", "project"] as const)
      expect(mcpToolsForRole(role).find((tool) => tool.name === "code60_browser")).toMatchObject({
        kind: "browser",
        readOnly: false,
      });
  });
  it("describes all registered project Search with captured provenance and closed-source consent", () => {
    const search = APPLICATION_CAPABILITIES.find((capability) => capability.id === "search");
    expect(search).toMatchObject({ prerequisite: "database", agentAccess: "human-only" });
    expect(search?.purpose).toContain("open or closed");
    expect(search?.limitations).toContain("no selected project");
    expect(search?.limitations).toContain("pages of 100");
    expect(search?.confirmation).toContain("Open Project");
  });
  it("describes Carbon table search, bounded paging and named column controls without changing access", () => {
    const data = APPLICATION_CAPABILITIES.find((capability) => capability.id === "data");
    expect(data).toMatchObject({ prerequisite: "database", agentAccess: "read" });
    for (const detail of [
      "single-row selection",
      "backend paging scopes",
      "Earlier/Later",
      "toolbar buttons",
      "not agent-readable",
    ])
      expect(data?.limitations).toContain(detail);
  });
  it("describes Low density and line-free table defaults without replacing saved choices", () => {
    expect(
      APPLICATION_CAPABILITIES.find((capability) => capability.id === "settings"),
    ).toMatchObject({
      prerequisite: "none",
      agentAccess: "human-only",
      purpose: expect.stringContaining(
        "Table defaults start at Low density (Carbon 64px rows), with row, column and heading lines off",
      ),
    });
  });
  it("describes interface text size in human-only settings", () => {
    const settings = APPLICATION_CAPABILITIES.find((capability) => capability.id === "settings");
    expect(settings?.purpose).toContain("interface text size");
    expect(settings?.agentAccess).toBe("human-only");
    expect(SETTINGS_CAPABILITIES.text).toBe("settings");
  });
  it("names Scheduled Jobs while preserving its stable identity and availability", () => {
    expect(pages.find((page) => page.id === "automations")).toMatchObject({
      label: "Scheduled Jobs",
      database: false,
    });
    expect(
      APPLICATION_CAPABILITIES.find((capability) => capability.id === "automations"),
    ).toMatchObject({
      label: "Scheduled Jobs",
      access: "Automation → Scheduled Jobs (also Apps → Scheduled Jobs)",
      prerequisite: "none",
      agentAccess: "human-only",
      confirmation: "Human installation and schedule consent.",
    });
  });
  it("describes scheduled-job controls independently from recurring enablement", () => {
    const jobs = APPLICATION_CAPABILITIES.find((capability) => capability.id === "automations");
    expect(jobs?.purpose).toContain("Run/Stop applies to one job");
    expect(jobs?.purpose).toContain("New scheduled job and Refresh are in the schedules toolbar");
    expect(jobs?.purpose).toContain("current-page search");
    expect(jobs?.purpose).toContain("Legacy saved grid preferences stay stored");
    expect(jobs?.purpose).toContain("View history opens an explicit schedule filter");
    expect(jobs?.limitations).toContain("Delete requires browser confirmation");
  });
  it("uses the Custom Assistants name with the existing stable capability ID", () => {
    expect(APPLICATION_CAPABILITIES.find((c) => c.id === "relay")?.access).toContain(
      "Sidebar → Assistants → Relay",
    );
    expect(APPLICATION_CAPABILITIES.find((c) => c.id === "custom-agents")).toMatchObject({
      label: "Custom Assistants",
      access: expect.stringContaining("Sidebar → Assistants → Custom Assistants → New Assistant"),
      prerequisite: "none",
      agentAccess: "human-only",
    });
  });
  it("describes per-card custom assistant management", () => {
    const access = APPLICATION_CAPABILITIES.find((c) => c.id === "custom-agents")?.access;
    expect(access).toContain("assistant row → More actions → Edit or Archive");
    expect(access).toContain("title actions → Archived → row → More actions → Restore");
  });
  it("describes human-only browser appearance without native window effects", () => {
    const settings = APPLICATION_CAPABILITIES.find((cap) => cap.id === "settings");
    expect(settings).toMatchObject({ prerequisite: "none", agentAccess: "human-only" });
    expect(settings?.purpose).not.toContain("whole-window background opacity");
    expect(settings?.purpose).toContain("Browser-native window management is outside Code60");
  });
  it("describes Apps-owned preferences and Update Manager with unchanged human-only access", () => {
    expect(APPLICATION_CAPABILITIES.find((cap) => cap.id === "updates")).toMatchObject({
      label: "Update Manager",
      access: "Apps → Update Manager",
      prerequisite: "none",
      agentAccess: "human-only",
    });
    expect(APPLICATION_CAPABILITIES.find((cap) => cap.id === "memory")?.access).toContain(
      "Apps → Memory",
    );
  });
  it("exposes theme and reading controls with local storage compatibility", () => {
    expect(APPLICATION_CAPABILITIES.find((c) => c.id === "settings")).toMatchObject({
      prerequisite: "none",
      agentAccess: "human-only",
      access: expect.stringContaining("Workspace → Color theme"),
      limitations: expect.stringContaining("Legacy decorative preferences remain stored"),
    });
  });
  it("describes chooser and Explorer navigation", () => {
    expect(
      APPLICATION_CAPABILITIES.find((c) => c.id === "projects")?.confirmation.includes(
        "Back, Forward and Up",
      ),
    ).toBe(true);
    expect(APPLICATION_CAPABILITIES.find((c) => c.id === "files")?.purpose).toContain(
      "Double-click or press Enter",
    );
  });
  it("locates the file panel toggle in the main content card corner", () => {
    expect(APPLICATION_CAPABILITIES.find((c) => c.id === "files")).toMatchObject({
      access: "Chat → upper-right corner of main content card → Toggle files panel",
      purpose: expect.stringContaining("File Explorer, Changes and Memory Recall"),
      limitations: expect.stringContaining("Alt+Left/Right reorders"),
      prerequisite: "runtime",
      agentAccess: "read",
    });
  });
  it("keeps navigation disclosures human-only and independent from execution", () => {
    const settings = APPLICATION_CAPABILITIES.find((capability) => capability.id === "settings");
    expect(settings).toMatchObject({ prerequisite: "none", agentAccess: "human-only" });
    expect(settings?.limitations).toContain("Navigation groups expand or collapse independently");
    expect(settings?.limitations).toContain(
      "Project and conversation disclosures retain their own state",
    );
    expect(settings?.limitations).not.toContain("Native desktop blur is macOS-only");
  });
  it("describes browser-only distribution and retained scheduler controls", () => {
    const browser = APPLICATION_CAPABILITIES.find((cap) => cap.id === "browser-runtime");
    expect(browser?.limitations).toContain(
      "macOS Apple Silicon and Linux x64 setup requires Node >=24.22.0 <25",
    );
    expect(browser?.limitations).toContain("code60 setup [--yes] [--no-open]");
    expect(browser?.limitations).toContain("read-only code60 status");
    expect(browser?.limitations).toContain("no profiles are edited");
    expect(browser?.limitations).toContain("preserves valid custom selections");
    expect(browser?.limitations).toContain("starts at login");
    expect(browser?.limitations).toContain("Browsers connect without a code by default");
    expect(browser?.limitations).toContain("code60 pairing on/off/status");
    expect(browser?.limitations).toContain(
      "Closing or refreshing a browser preserves approved work",
    );
    const service = APPLICATION_CAPABILITIES.find((cap) => cap.id === "system-manager");
    expect(service?.limitations).toContain("local code60 service commands");
    expect(service?.agentAccess).toBe("human-only");
  });
  it("describes the scheduler update ownership and executable prerequisites without agent authority", () => {
    const updates = APPLICATION_CAPABILITIES.find((cap) => cap.id === "updates");
    expect(updates?.limitations).toContain("Node >=24.22.0 <25");
    expect(updates?.limitations).toContain("repairs service registration");
    expect(updates?.limitations).toContain("code60 update recover");
    expect(updates?.limitations).toContain("Setup never updates");
    expect(updates?.agentAccess).toBe("human-only");
  });
  it("classifies Providers navigation and human management without retaining an Agents settings route", () => {
    expect(PAGE_CAPABILITIES.providers).toBe("providers");
    expect(PAGE_CAPABILITIES.provider).toBe("providers");
    expect(SETTINGS_CAPABILITIES).not.toHaveProperty("agents");
    const providers = APPLICATION_CAPABILITIES.find((capability) => capability.id === "providers");
    expect(providers).toMatchObject({
      label: "Providers",
      access: "Providers → provider details → title actions for Disconnect or Set as Primary",
      prerequisite: "none",
    });
    expect(providers?.limitations).toContain("stopped interactive agent work");
    expect(providers?.limitations).toContain(
      "explicit installation of pinned @openai/codex@0.171.0",
    );
    expect(providers?.limitations).toContain(
      "Custom launch commands and enterprise endpoints use manual setup",
    );
  });
  it("describes all catalog installation and browser login methods without new agent authority", () => {
    const capability = APPLICATION_CAPABILITIES.find((item) => item.id === "providers");
    expect(capability?.prerequisite).toBe("none");
    for (const label of [
      "Antigravity",
      "Claude subscription",
      "Anthropic Console",
      "Copilot",
      "Kiro",
      "Droid",
      "OpenCode",
      "code paste-back",
      "API-key entry",
    ])
      expect(capability?.limitations).toContain(label);
    expect(capability?.limitations).toContain("controlling setup dialog alone");
  });
  it("classifies model switching as provider-dependent and human-only with role-scoped defaults", () => {
    expect(APPLICATION_CAPABILITIES.find((c) => c.id === "model-settings")).toMatchObject({
      prerequisite: "provider",
      agentAccess: "human-only",
      limitations: expect.stringContaining("Workers do not follow parent changes"),
      confirmation: expect.stringContaining("Main derives saved values"),
    });
    expect(APPLICATION_CAPABILITIES.find((c) => c.id === "providers")?.purpose).toContain(
      "clear saved",
    );
  });
  it("describes the database-independent Assistants navigation home", () => {
    const assistants = APPLICATION_CAPABILITIES.find((c) => c.id === "assistants");
    expect(assistants?.purpose).toContain("Relay or Custom Assistants");
    expect(assistants?.prerequisite).toBe("none");
    expect(assistants?.limitations).toContain("does not connect a provider or start work");
    expect(PAGE_CAPABILITIES.assistants).toBe("assistants");
  });
  it("has unique, fully classified descriptors", () => {
    expect(ids.size).toBe(APPLICATION_CAPABILITIES.length);
    for (const capability of APPLICATION_CAPABILITIES) {
      expect(capability.id).toMatch(/^[a-z][a-z-]*$/);
      for (const field of ["label", "purpose", "access", "confirmation", "limitations"] as const)
        expect(capability[field].trim(), `${capability.id}.${field}`).not.toBe("");
    }
  });

  it("classifies every page, settings section and agent-visible tool without dangling references", () => {
    expect(Object.keys(PAGE_CAPABILITIES).sort()).toEqual(pages.map((page) => page.id).sort());
    expect(Object.keys(SETTINGS_CAPABILITIES).sort()).toEqual(
      settingsSections.map((section) => section.id).sort(),
    );
    expect(Object.keys(TOOL_CAPABILITIES).sort()).toEqual(
      MCP_TOOL_DEFINITIONS.map((tool) => tool.name).sort(),
    );
    for (const id of [
      ...Object.values(PAGE_CAPABILITIES),
      ...Object.values(SETTINGS_CAPABILITIES),
      ...Object.values(TOOL_CAPABILITIES),
    ])
      expect(ids, id).toContain(id);
  });

  it("keeps knowledge tools read-only and exposed to both orchestrator roles", () => {
    for (const role of ["relay", "project"] as const) {
      const names = mcpToolsForRole(role).map((tool) => tool.name);
      for (const tool of MCP_KNOWLEDGE_TOOL_DEFINITIONS) expect(names).toContain(tool.name);
      for (const name of names) expect(TOOL_CAPABILITIES[name], name).toBeDefined();
    }
    for (const tool of MCP_TOOL_DEFINITIONS)
      expect(isKnowledgeTool(tool.name)).toBe(tool.kind === "knowledge");
    for (const tool of MCP_KNOWLEDGE_TOOL_DEFINITIONS) {
      expect(tool.readOnly).toBe(true);
      expect(tool.destructive).toBe(false);
    }
    expect(mcpToolsForRole("relay").map((tool) => tool.name)).not.toContain(
      "code60_create_command",
    );
  });

  it("describes human-opened live automation transcripts without database prerequisites", () => {
    expect(
      APPLICATION_CAPABILITIES.find((capability) => capability.id === "automations"),
    ).toMatchObject({
      prerequisite: "none",
      purpose: expect.stringContaining("live, assembled execution transcripts"),
      limitations: expect.stringContaining("bounded evidence with execution status"),
    });
  });

  it("describes the current creation cards, folder confirmation and dollar commands", () => {
    const projects = APPLICATION_CAPABILITIES.find((capability) => capability.id === "projects");
    expect(projects).toMatchObject({
      prerequisite: "database",
      access: expect.stringContaining("project row → + (New Session)"),
      confirmation: expect.stringContaining("Confirm the full selected path"),
      limitations: expect.stringContaining(
        "Archiving the last displayed project chat returns to its home without a replacement",
      ),
    });
    expect(projects?.access).toContain("project home → New Session");
    expect(projects?.access).toContain("red × (Close Project)");
    expect(projects?.limitations).toContain("invokes Stop Folder");
    expect(projects?.limitations).toContain("keeps the project open");
    expect(projects?.confirmation).toContain("Stop folder confirmation");
    expect(projects?.limitations).toContain("only the project chevron");
    expect(projects?.limitations).toContain("Project chat auto-names are limited to 19 characters");
    const commands = APPLICATION_CAPABILITIES.find((capability) => capability.id === "commands");
    expect(commands).toMatchObject({
      label: "Commands",
      prerequisite: "database",
      purpose: expect.stringContaining("$name"),
      access: expect.stringContaining("$ command picker"),
      limitations: expect.stringContaining("/name is plain text"),
    });
    for (const command of BUILTIN_COMMANDS)
      expect(commands?.purpose).toContain(`$${command.name}: ${command.description}`);
    expect(commands?.limitations).toContain("only in project orchestrator chats");
    expect(commands?.limitations).toContain("not Relay or worker chats");
    expect(commands?.limitations).toContain("do not grant new execution authority");
  });

  it("matches the generated bundled reference", async () => {
    await expect(capabilityReference()).toMatchFileSnapshot("../docs/capabilities.md");
  });

  it("describes session-owned file tabs without changing their runtime prerequisite", () => {
    expect(APPLICATION_CAPABILITIES.find((capability) => capability.id === "files")).toMatchObject({
      prerequisite: "runtime",
      purpose: expect.stringContaining("individual chat or worker session"),
      limitations: expect.stringContaining(
        "Tab sets, order and selection are independent per session",
      ),
    });
  });

  it("describes bounded active file subscriptions and reachable archived review evidence", () => {
    const files = APPLICATION_CAPABILITIES.find((capability) => capability.id === "files");
    expect(files?.limitations).toContain("Inactive panels release file subscriptions");
    expect(files?.limitations).toContain("exact active file subscription");
    expect(files?.limitations).toContain("Archived reviews remain read-only");
  });

  it("describes sidebar activity as runtime-dependent presentation", () => {
    expect(
      APPLICATION_CAPABILITIES.find((capability) => capability.id === "activity"),
    ).toMatchObject({
      prerequisite: "runtime",
      access: expect.stringContaining("left navigation names"),
      purpose: expect.stringContaining("custom assistants and Relay"),
      limitations: expect.stringContaining("reduced motion and forced colors"),
    });
  });
});
it("describes LAN beta as human-only and separate from local pairing policy", () => {
  expect(PAGE_CAPABILITIES["web-server"]).toBe("web-server");
  expect(APPLICATION_CAPABILITIES.find((cap) => cap.id === "web-server")).toMatchObject({
    agentAccess: "human-only",
    prerequisite: "none",
    access: "Settings → Advanced → Web Server Beta",
    limitations: expect.stringContaining("LAN always requires pairing"),
    confirmation: expect.stringContaining("123-456"),
  });
});
