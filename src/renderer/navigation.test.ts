import { describe, expect, it, vi } from "vitest";
import {
  groups,
  pageAvailable,
  pageCommands,
  pageDefinitions,
  pageGroup,
  pages,
  pagesInGroup,
  renderedPages,
  resolvePage,
  settingsIcons,
  settingsParents,
  settingsSectionIds,
} from "./navigation.js";
import { staticChildren } from "./navigation-tree.js";

describe("navigation registry", () => {
  it("uses the supplied artwork for Memory, Providers and Experiments", () => {
    expect(settingsIcons.memory).toBe("app-bookshelf");
    expect(pageDefinitions.providers.icon).toBe("app-helmet");
    expect(groups.experiments.icon).toBe("app-chemical");
    expect(pageDefinitions["episodic-memory"].icon).toBe("brain");
    expect(pageDefinitions.rag.icon).toBe("flask");
  });
  it("uses the supplied artwork for Search, tables, Table defaults and Contributor Tools", () => {
    expect(pageDefinitions.search.icon).toBe("app-search");
    for (const id of pagesInGroup("tables")) expect(pageDefinitions[id].icon).toBe("app-table");
    expect(settingsIcons["table-defaults"]).toBe("app-table");
    expect(pageDefinitions["contributor-tools"].icon).toBe("app-under-construction");
  });
  it("alphabetizes Settings destinations, including the Advanced group", () => {
    expect(staticChildren("settings", "/db").map(({ target }) => target.id)).toEqual([
      "about",
      "advanced",
      "table-defaults",
      "text",
    ]);
  });
  it("defines every static destination once and routes aliases to rendered pages", () => {
    expect(new Set(pages.map((page) => page.id)).size).toBe(pages.length);
    expect(renderedPages.map((page) => page.id)).toEqual(
      pages.filter((page) => page.id !== "files").map((page) => page.id),
    );
    expect(resolvePage("files")).toBe("chat");
    for (const section of settingsSectionIds)
      expect(pageGroup(section)).toBe(settingsParents[section]);
    expect(pageGroup("episodic-memory")).toBe("advanced");
    expect(pageGroup("rag")).toBe("advanced");
    expect(pagesInGroup("experiments")).toEqual(["episodic-memory", "rag"]);
  });
  it("keeps tables alphabetical and primary navigation in its documented order", () => {
    const labels = pagesInGroup("tables").map((id) => pageDefinitions[id].label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
    expect(pagesInGroup("apps")).toEqual(["automations", "commands", "prompts", "system-manager"]);
    expect(pagesInGroup("primary")).toEqual([
      "home",
      "assistants",
      "custom-agents",
      "providers",
      "apps",
      "search",
    ]);
    expect(pageGroup("automations")).toBe("apps");
    expect(pageDefinitions.automations.label).toBe("Scheduled Jobs");
    expect(pageGroup("system-manager")).toBe("apps");
    expect(pageDefinitions["system-manager"].label).toBe("System Manager");
  });
  it("uses the same availability for palette and sidebar, including database-free Logs", () => {
    for (const database of [null, "/db"]) {
      const navigate = vi.fn();
      const commands = pageCommands("chat", database, navigate, "Ctrl+,");
      expect(commands.find((command) => command.id === "automations")?.label).toBe(
        "Scheduled Jobs",
      );
      for (const command of commands) {
        const id = command.id as keyof typeof pageDefinitions;
        expect(command.disabled).toBe(!pageAvailable(id, database));
        command.run();
        if (command.disabled) expect(navigate).not.toHaveBeenCalledWith(id);
        else expect(navigate).toHaveBeenCalledWith(id);
      }
    }
    expect(pageAvailable("logs", null)).toBe(true);
    expect(pageAvailable("automations", null)).toBe(true);
    expect(pageAvailable("system-manager", null)).toBe(true);
    expect(pageAvailable("memories", null)).toBe(true);
    expect(pageAvailable("settings", null)).toBe(true);
    expect(pageAvailable("apps", null)).toBe(true);
    expect(pageAvailable("sessions", null)).toBe(false);
  });
});
