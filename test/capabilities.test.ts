import { describe, expect, it } from "vitest";
import {
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

  it("describes the current creation cards, folder confirmation and dollar commands", () => {
    const projects = DESKTOP_CAPABILITIES.find((capability) => capability.id === "projects");
    expect(projects).toMatchObject({
      prerequisite: "database",
      access: expect.stringContaining("Projects → New Project; project home → New Chat"),
      confirmation: expect.stringContaining("Confirm the full selected path"),
      limitations: expect.stringContaining("never initializes Git"),
    });
    const commands = DESKTOP_CAPABILITIES.find((capability) => capability.id === "commands");
    expect(commands).toMatchObject({
      label: "Commands",
      prerequisite: "database",
      purpose: expect.stringContaining("$name"),
      access: expect.stringContaining("$ command picker"),
      limitations: expect.stringContaining("/name is plain text"),
    });
  });

  it("matches the generated bundled reference", async () => {
    await expect(capabilityReference()).toMatchFileSnapshot("../docs/capabilities.md");
  });
});
