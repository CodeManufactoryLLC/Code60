import { describe, expect, it } from "vitest";
import { initialTabs, updateTabs } from "./tabs.js";

describe("page tabs", () => {
  it("starts on Chat with permanent tabs including app-wide Logs and Commands", () => {
    expect(initialTabs).toEqual({
      open: [
        "home",
        "rag",
        "logs",
        "contributor-tools",
        "chat",
        "episodic-memory",
        "sessions",
        "messages",
        "events",
        "search",
        "configurations",
        "worktrees",
        "polling",
        "prompts",
        "commands",
        "settings",
        "apps",
        "memories",
        "automations",
        "system-manager",
        "projects",
        "project",
        "tables",
        "advanced",
        "experiments",
        "custom-agents",
        "assistants",
        "providers",
        "provider",
        "mcp-servers",
        "workflows",
        "web-server",
      ],
      active: "chat",
    });
    for (const id of initialTabs.open) {
      expect(updateTabs(initialTabs, { type: "close", id })).toBe(initialTabs);
    }
  });
  it("routes project homes separately from conversations and clears their identity on exit", () => {
    const project = updateTabs(initialTabs, { type: "project", projectId: "one" });
    expect(project).toEqual({ ...initialTabs, active: "project", projectId: "one" });
    expect(updateTabs(project, { type: "select", id: "projects" })).toEqual({
      ...initialTabs,
      active: "projects",
    });
  });
  it("routes provider details separately and clears their identity on exit", () => {
    const provider = updateTabs(initialTabs, { type: "provider", providerId: "codex" });
    expect(provider).toEqual({ ...initialTabs, active: "provider", providerId: "codex" });
    expect(updateTabs(provider, { type: "select", id: "providers" })).toEqual({
      ...initialTabs,
      active: "providers",
    });
  });
  it("selects the existing Settings tab without duplicating it", () => {
    const settings = updateTabs(initialTabs, { type: "open", id: "settings" });
    expect(settings.open).toBe(initialTabs.open);
    expect(settings.active).toBe("settings");
    expect(updateTabs(settings, { type: "open", id: "settings" })).toEqual(settings);
    expect(updateTabs(settings, { type: "close", id: "settings" })).toBe(settings);
    expect(updateTabs(settings, { type: "select", id: "chat" })).toEqual(initialTabs);
  });
  it("routes legacy Files actions to Chat without recreating a Files page", () => {
    const settings = updateTabs(initialTabs, { type: "select", id: "settings" });
    for (const type of ["open", "select"] as const) {
      const result = updateTabs(settings, { type, id: "files" });
      expect(result.active).toBe("chat");
      expect(result.open).not.toContain("files");
    }
  });
});
