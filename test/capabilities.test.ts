import { describe, expect, it } from "vitest";
import {
  BUILTIN_COMMANDS,
  capabilityReference,
  DESKTOP_CAPABILITIES,
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

const ids = new Set(DESKTOP_CAPABILITIES.map((capability) => capability.id));

describe("desktop capability catalog", () => {
  it("describes scheduler upgrade recovery without granting service authority", () => {
    expect(DESKTOP_CAPABILITIES.find((capability) => capability.id === "updates")).toMatchObject({
      prerequisite: "runtime",
      agentAccess: "human-only",
      limitations: expect.stringContaining("verifies the matching app version"),
      confirmation: "Human approval before installation and shutdown.",
    });
  });
  it("describes the human-only current-page combobox and its bounded parent path", () => {
    expect(DESKTOP_CAPABILITIES.find((cap) => cap.id === "page-navigation")).toMatchObject({
      prerequisite: "none",
      agentAccess: "human-only",
      access: expect.stringContaining("Current page combobox"),
      limitations: expect.stringContaining("only the current page and its parents"),
    });
    expect(DESKTOP_CAPABILITIES.find((cap) => cap.id === "page-navigation")?.limitations).toContain(
      "No search field",
    );
  });
  it("describes content-title commands while keeping navigation and availability human-only", () => {
    const navigation = DESKTOP_CAPABILITIES.find((cap) => cap.id === "page-navigation");
    expect(navigation?.limitations).toContain("chevron-only title actions menu");
    expect(navigation?.limitations).toContain(
      "Table tools, scope selectors, creation cards and corner panel toggles remain visible",
    );
    expect(navigation?.prerequisite).toBe("none");
    expect(navigation?.agentAccess).toBe("human-only");
    expect(DESKTOP_CAPABILITIES.find((cap) => cap.id === "updates")?.access).toContain(
      "title actions",
    );
  });
  it("classifies bounded human-only navigation history without database prerequisites", () => {
    expect(DESKTOP_CAPABILITIES.find((cap) => cap.id === "navigation-history")).toMatchObject({
      access: "Current-page header card → Back / Forward, to the left of the page selector",
      prerequisite: "none",
      agentAccess: "human-only",
      limitations: expect.stringContaining("100 destinations"),
    });
  });
  it("exposes conversational browser modes only through the orchestrator gateway", () => {
    expect(DESKTOP_CAPABILITIES.find((cap) => cap.id === "browser")).toMatchObject({
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
    const search = DESKTOP_CAPABILITIES.find((capability) => capability.id === "search");
    expect(search).toMatchObject({ prerequisite: "database", agentAccess: "human-only" });
    expect(search?.purpose).toContain("open or closed");
    expect(search?.limitations).toContain("no selected project");
    expect(search?.limitations).toContain("pages of 100");
    expect(search?.confirmation).toContain("Open Project");
  });
  it("describes Low density and line-free table defaults without replacing saved choices", () => {
    expect(DESKTOP_CAPABILITIES.find((capability) => capability.id === "settings")).toMatchObject({
      prerequisite: "none",
      agentAccess: "human-only",
      purpose: expect.stringContaining(
        "Table defaults start at Low density (44px rows), with row, column and heading lines off",
      ),
    });
  });
  it("describes Scientifica in human-only text settings", () => {
    const settings = DESKTOP_CAPABILITIES.find((capability) => capability.id === "settings");
    expect(settings?.purpose).toContain("locally bundled Scientifica");
    expect(settings?.agentAccess).toBe("human-only");
    expect(SETTINGS_CAPABILITIES.text).toBe("settings");
  });
  it("names Scheduled Jobs while preserving its stable identity and availability", () => {
    expect(pages.find((page) => page.id === "automations")).toMatchObject({
      label: "Scheduled Jobs",
      database: false,
    });
    expect(
      DESKTOP_CAPABILITIES.find((capability) => capability.id === "automations"),
    ).toMatchObject({
      label: "Scheduled Jobs",
      access: "Apps → Scheduled Jobs",
      prerequisite: "none",
      agentAccess: "human-only",
      confirmation: "Human installation and schedule consent.",
    });
  });
  it("describes scheduled-job controls independently from recurring enablement", () => {
    const jobs = DESKTOP_CAPABILITIES.find((capability) => capability.id === "automations");
    expect(jobs?.purpose).toContain("Play starts one run");
    expect(jobs?.purpose).toContain("separate schedule enable/pause");
    expect(jobs?.limitations).toContain("Delete requires native confirmation");
  });
  it("uses the Custom Assistants name with the existing stable capability ID", () => {
    expect(DESKTOP_CAPABILITIES.find((c) => c.id === "relay")?.access).toContain(
      "Sidebar → Assistants → Relay",
    );
    expect(DESKTOP_CAPABILITIES.find((c) => c.id === "custom-agents")).toMatchObject({
      label: "Custom Assistants",
      access: expect.stringContaining("Sidebar → Assistants → Custom Assistants → New Assistant"),
      prerequisite: "none",
      agentAccess: "human-only",
    });
  });
  it("describes per-card custom assistant management", () => {
    const access = DESKTOP_CAPABILITIES.find((c) => c.id === "custom-agents")?.access;
    expect(access).toContain("assistant card → More actions → Edit or Archive");
    expect(access).toContain("title actions → Archived → card → More actions → Restore");
  });
  it("describes human-only window background controls and their transparency limits", () => {
    expect(DESKTOP_CAPABILITIES.find((c) => c.id === "settings")).toMatchObject({
      prerequisite: "none",
      agentAccess: "human-only",
      access: expect.stringContaining("Appearance → Window background"),
      limitations: expect.stringContaining("dedicated top-right chevron"),
      purpose: expect.stringContaining("whole-window background opacity"),
    });
  });
  it("describes the human-only breadcrumb theme shortcut without changing availability", () => {
    expect(DESKTOP_CAPABILITIES.find((c) => c.id === "settings")).toMatchObject({
      prerequisite: "none",
      agentAccess: "human-only",
      access: expect.stringContaining("breadcrumb card → Color theme"),
      limitations: expect.stringContaining("System → Dark → Light → System"),
    });
  });
  it("describes locally saved monochrome icons without database prerequisites", () => {
    expect(DESKTOP_CAPABILITIES.find((c) => c.id === "settings")).toMatchObject({
      prerequisite: "none",
      agentAccess: "human-only",
      purpose: expect.stringContaining("Monochrome icons with a color selector"),
      access: expect.stringContaining("Icons"),
      limitations: expect.stringContaining("Icon contrast spreads its shades"),
    });
  });
  it("locates the file panel toggle in the main content card corner", () => {
    expect(DESKTOP_CAPABILITIES.find((c) => c.id === "files")).toMatchObject({
      access: "Chat → upper-right corner of main content card → Toggle files panel",
      purpose: expect.stringContaining("File Explorer, Changes and Memory Recall"),
      limitations: expect.stringContaining("Alt+Left/Right reorders"),
      prerequisite: "runtime",
      agentAccess: "read",
    });
  });
  it("keeps navigation disclosures human-only and independent from execution", () => {
    const settings = DESKTOP_CAPABILITIES.find((capability) => capability.id === "settings");
    expect(settings).toMatchObject({ prerequisite: "none", agentAccess: "human-only" });
    expect(settings?.limitations).toContain("Home/Search is also collapsible");
    expect(settings?.limitations).toContain("Header navigation never toggles expansion");
    expect(settings?.limitations).toContain("Native desktop blur is macOS-only");
  });
  it("describes desktop-only distribution and retained scheduler controls", () => {
    expect(DESKTOP_CAPABILITIES.find((c) => c.id === "updates")?.purpose).toContain(
      "macOS arm64 and Linux x64",
    );
    expect(DESKTOP_CAPABILITIES.find((c) => c.id === "system-manager")?.purpose).toContain(
      "No public Code60 CLI",
    );
    const service = DESKTOP_CAPABILITIES.find((c) => c.id === "system-manager");
    expect(service?.purpose).toContain("Scheduling Service");
    expect(service?.purpose).toContain("Not installed, Stopped and Running");
    expect(service?.purpose).toContain("Jobs paused is separate");
    expect(service?.purpose).toContain("automatically every two seconds");
    expect(service?.limitations).toContain("global Pause polling");
    expect(service?.limitations).toContain("sixty seconds");
    expect(service?.limitations).toContain("no native Stop action");
  });
  it("describes the scheduler update ownership and executable prerequisites without agent authority", () => {
    const update = DESKTOP_CAPABILITIES.find((c) => c.id === "updates");
    expect(update?.limitations).toContain("native service PID");
    expect(update?.limitations).toContain("newer or unknown version");
    expect(update?.limitations).toContain("one exclusive owner");
    expect(update?.limitations).toContain("parent locations protected");
    expect(update?.prerequisite).toBe("runtime");
    expect(update?.agentAccess).toBe("human-only");
  });
  it("classifies Providers navigation and human management without retaining an Agents settings route", () => {
    expect(PAGE_CAPABILITIES.providers).toBe("providers");
    expect(PAGE_CAPABILITIES.provider).toBe("providers");
    expect(SETTINGS_CAPABILITIES).not.toHaveProperty("agents");
    const providers = DESKTOP_CAPABILITIES.find((capability) => capability.id === "providers");
    expect(providers).toMatchObject({
      label: "Providers",
      access: "Providers → provider details → title actions for Disconnect or Set as Primary",
      prerequisite: "none",
    });
    expect(providers?.limitations).toContain("stopped desktop agent work");
    expect(providers?.limitations).toContain("No automatic installation or management MCP tools");
  });
  it("classifies model switching as provider-dependent and human-only with role-scoped defaults", () => {
    expect(DESKTOP_CAPABILITIES.find((c) => c.id === "model-settings")).toMatchObject({
      prerequisite: "provider",
      agentAccess: "human-only",
      limitations: expect.stringContaining("Workers do not follow parent changes"),
      confirmation: expect.stringContaining("Main derives saved values"),
    });
    expect(DESKTOP_CAPABILITIES.find((c) => c.id === "providers")?.purpose).toContain(
      "clear saved",
    );
  });
  it("describes the database-independent Assistants navigation home", () => {
    const assistants = DESKTOP_CAPABILITIES.find((c) => c.id === "assistants");
    expect(assistants?.purpose).toContain("Relay or Custom Assistants");
    expect(assistants?.prerequisite).toBe("none");
    expect(assistants?.limitations).toContain("does not connect a provider or start work");
    expect(PAGE_CAPABILITIES.assistants).toBe("assistants");
  });
  it("has unique, fully classified descriptors", () => {
    expect(ids.size).toBe(DESKTOP_CAPABILITIES.length);
    for (const capability of DESKTOP_CAPABILITIES) {
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
      DESKTOP_CAPABILITIES.find((capability) => capability.id === "automations"),
    ).toMatchObject({
      prerequisite: "none",
      purpose: expect.stringContaining("live, assembled execution transcripts"),
      limitations: expect.stringContaining("bounded evidence with execution status"),
    });
  });

  it("describes the current creation cards, folder confirmation and dollar commands", () => {
    const projects = DESKTOP_CAPABILITIES.find((capability) => capability.id === "projects");
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
    const commands = DESKTOP_CAPABILITIES.find((capability) => capability.id === "commands");
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
    expect(DESKTOP_CAPABILITIES.find((capability) => capability.id === "files")).toMatchObject({
      prerequisite: "runtime",
      purpose: expect.stringContaining("individual chat or worker session"),
      limitations: expect.stringContaining(
        "Tab sets, order and selection are independent per session",
      ),
    });
  });

  it("describes bounded active file subscriptions and reachable archived review evidence", () => {
    const files = DESKTOP_CAPABILITIES.find((capability) => capability.id === "files");
    expect(files?.limitations).toContain("Inactive panels release file subscriptions");
    expect(files?.limitations).toContain("exact active file subscription");
    expect(files?.limitations).toContain("Archived reviews remain read-only");
  });

  it("describes sidebar activity as runtime-dependent presentation", () => {
    expect(DESKTOP_CAPABILITIES.find((capability) => capability.id === "activity")).toMatchObject({
      prerequisite: "runtime",
      access: expect.stringContaining("left navigation names"),
      purpose: expect.stringContaining("custom assistants and Relay"),
      limitations: expect.stringContaining("reduced motion and forced colors"),
    });
  });
});
