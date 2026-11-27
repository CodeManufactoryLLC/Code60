import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DesktopRun, OpenProject, OrchestrationChat } from "../bridge/index.js";
import { NavigationHomePage } from "./navigation-home-page.js";
import {
  conversationProject,
  isNavigationHome,
  navigationParent,
  projectConversations,
  sidebarPageElementId,
  staticChildren,
} from "./navigation-tree.js";

const project: OpenProject = {
  id: "a",
  path: "/projects/A",
  active: true,
  chatIds: ["one", "archived"],
  workerIds: ["owned", "orphan", "finished"],
};
const chats = [
  {
    run: { id: "one" },
    kind: "project",
    projectId: "a",
    title: "First chat",
    workers: ["owned"],
  },
  { run: { id: "archived" }, kind: "project", projectId: "a", archived: true, workers: [] },
  { run: { id: "other" }, kind: "project", projectId: "b", workers: [] },
] as unknown as OrchestrationChat[];
const runs = ["owned", "orphan", "finished", "foreign", "relay"].map((id) => ({
  record: { id, agent: id, status: id === "finished" ? "finished" : "running" },
  ...(id === "relay" ? { relay: { target: "relay-target" } } : {}),
})) as unknown as DesktopRun[];

describe("navigation tree", () => {
  it("reveals only the owning project's ancestors, never Relay or an absent selection", () => {
    const projects = [{ ...project, workerIds: [...project.workerIds, "relay"] }];
    expect(conversationProject("one", projects, chats, runs)).toBe("a");
    expect(conversationProject("owned", projects, chats, runs)).toBe("a");
    expect(conversationProject("relay", projects, chats, runs)).toBeUndefined();
    expect(conversationProject("foreign", projects, chats, runs)).toBeUndefined();
    expect(
      conversationProject(
        undefined,
        projects,
        [{ ...chats[0], run: null } as OrchestrationChat],
        runs,
      ),
    ).toBeUndefined();
  });
  it("resolves only immediate children in alphabetical order with real destinations", () => {
    expect(staticChildren("apps", null).map(({ id }) => id)).toEqual([
      "appearance",
      "commands",
      "tables",
      "health-check",
      "heartbeat",
      "prompts",
      "mcp-servers",
      "memory",
      "polling-settings",
      "automations",
      "system-manager",
      "updates",
      "usage",
      "workflows",
    ]);
    expect(staticChildren("tables", null).map(({ id }) => id)).toEqual([
      "configurations",
      "events",
      "logs",
      "memories",
      "messages",
      "polling",
      "sessions",
      "worktrees",
    ]);
    expect(staticChildren("advanced", null).map(({ id }) => id)).toEqual([
      "contributor-tools",
      "experiments",
      "web-server",
    ]);
    expect(staticChildren("experiments", null).map(({ id }) => id)).toEqual([
      "episodic-memory",
      "rag",
    ]);
    expect(staticChildren("apps", null).find(({ id }) => id === "appearance")?.target).toEqual({
      kind: "settings",
      id: "appearance",
    });
    expect(staticChildren("apps", null).find(({ id }) => id === "tables")?.target).toEqual({
      kind: "page",
      id: "tables",
    });
  });
  it("keeps parent homes and independent leaves available, gating only dependent leaves", () => {
    expect(
      staticChildren("tables", null)
        .filter(({ available }) => available)
        .map(({ id }) => id),
    ).toEqual(["logs", "memories"]);
    expect(staticChildren("advanced", null).every(({ available }) => available)).toBe(true);
    expect(
      staticChildren("experiments", null).every(
        ({ available, reason }) => !available && reason === "Connect to a database first",
      ),
    ).toBe(true);
    expect(staticChildren("experiments", "/db").every(({ available }) => available)).toBe(true);
    expect(navigationParent("home")).toBeUndefined();
    for (const id of [
      "assistants",
      "tables",
      "advanced",
      "experiments",
      "home",
      "apps",
      "settings",
    ] as const)
      expect(isNavigationHome(id)).toBe(true);
    expect(isNavigationHome("chat")).toBe(false);
  });
  it("locates sidebar destinations", () => {
    expect(sidebarPageElementId("chat")).toBe("tab-chat");
    expect(sidebarPageElementId("advanced")).toBe("advanced-toggle");
    expect(sidebarPageElementId("logs")).toBe("tab-logs");
  });
  it("retains direct project conversations and owned workers", () => {
    const entries = projectConversations(project, chats, runs);
    expect(entries.map(({ id }) => id)).toEqual(["one", "owned", "orphan"]);
    expect(entries.find(({ id }) => id === "owned")?.parentId).toBe("one");
    expect(projectConversations(project, chats, runs, "finished").map(({ id }) => id)).toContain(
      "finished",
    );
  });
  it("renders concise empty/error states on navigation home pages", () => {
    const home = renderToStaticMarkup(
      <NavigationHomePage page="tables" cards={[]} onOpen={() => {}} error="Read failed" hidden />,
    );
    expect(home).toContain("No items");
    expect(home).toContain('role="alert">Read failed');
    expect(home).toContain('hidden=""');
  });
});
