import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DesktopRun, OpenProject, OrchestrationChat } from "../bridge/index.js";
import type { NavigationActions } from "./navigation-actions.js";
import { NavigationHomePage } from "./navigation-home-page.js";
import {
  conversationNodes,
  conversationProject,
  inNavigationBranch,
  isNavigationHome,
  navigationParent,
  parentActivation,
  projectConversations,
  projectNodes,
  sidebarPageElementId,
  staticChildren,
} from "./navigation-tree.js";
import { ProjectHomePages, ProjectsHomePage } from "./project-home-pages.js";

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
const navigation: NavigationActions = {
  open: vi.fn(async () => true),
  chatAction: vi.fn(async () => true),
  projectAction: vi.fn(async () => true),
  invalidate: vi.fn(),
  pending: false,
  busy: false,
  projectPending: false,
  conversationPending: false,
  error: "",
};

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
  it("resolves only immediate children in sidebar order with real destinations", () => {
    expect(staticChildren("apps", null).map(({ id }) => id)).toEqual([
      "appearance",
      "commands",
      "tables",
      "mcp-servers",
      "memory",
      "polling-settings",
      "prompts",
      "automations",
      "system-manager",
      "updates",
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
    expect(staticChildren("projects", null)).toEqual([]);
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
    expect(inNavigationBranch("rag", "settings")).toBe(true);
    expect(inNavigationBranch("memories", "apps")).toBe(true);
    expect(inNavigationBranch("logs", "settings")).toBe(false);
    expect(navigationParent("home")).toBeUndefined();
    for (const id of [
      "assistants",
      "projects",
      "project",
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
  it("shares parent activation without toggling children on first navigation", () => {
    for (const expanded of [true, false])
      expect(parentActivation(false, expanded)).toEqual({ navigate: true, expanded: true });
    expect(parentActivation(true, true)).toEqual({ navigate: false, expanded: false });
    expect(parentActivation(true, false)).toEqual({ navigate: false, expanded: true });
    expect(sidebarPageElementId("projects")).toBe("tab-chat");
    expect(sidebarPageElementId("project", "a")).toBe("project-a");
    expect(sidebarPageElementId("project")).toBe("tab-chat");
    expect(sidebarPageElementId("advanced")).toBe("advanced-toggle");
    expect(sidebarPageElementId("logs")).toBe("tab-logs");
  });
  it("uses only open projects and direct conversations, retaining owned workers as nested children", () => {
    expect(projectNodes([project])).toEqual([
      {
        id: "a",
        label: "A",
        title: "/projects/A",
        icon: "app-folder",
        available: true,
        target: { kind: "project", id: "a" },
      },
    ]);
    const entries = projectConversations(project, chats, runs);
    expect(entries.map(({ id }) => id)).toEqual(["one", "owned", "orphan"]);
    expect(entries.find(({ id }) => id === "owned")?.parentId).toBe("one");
    expect(conversationNodes(entries).map(({ id }) => id)).toEqual(["one", "orphan"]);
    expect(conversationNodes(entries)[0]?.label).toBe("First chat");
    expect(
      conversationNodes(projectConversations(project, chats, runs, "finished")).map(({ id }) => id),
    ).toContain("finished");
    expect(projectNodes([])).toEqual([]);
  });
  it("renders concise empty/error states and retains separate project home identities", () => {
    const empty = renderToStaticMarkup(
      <ProjectsHomePage
        projects={[]}
        database={null}
        navigation={navigation}
        onOpenProject={() => {}}
      />,
    );
    expect(empty).toContain("No open projects");
    expect(empty).toContain('aria-label="New Project"');
    expect(empty).toContain('title="Connect to database"');
    const home = renderToStaticMarkup(
      <NavigationHomePage page="tables" cards={[]} onOpen={() => {}} error="Read failed" hidden />,
    );
    expect(home).toContain("No items");
    expect(home).toContain('role="alert">Read failed');
    expect(home).toContain('hidden=""');
    const dynamic = ProjectHomePages({
      projects: [project],
      chats: [],
      runs: [],
      activeId: "a",
      selectedId: undefined,
      navigation,
    });
    const html = renderToStaticMarkup(dynamic);
    expect(html).toContain("No conversations");
    expect(html).toContain('aria-label="New Session in A"');
    expect(html).toContain('id="project-a-title"');
    expect(dynamic[0]?.props.hidden).toBe(false);
    dynamic[0]?.props.create?.onClick();
    expect(navigation.chatAction).toHaveBeenCalledWith({ type: "new", projectId: "a" });
  });

  it.each([null, "/db"])(
    "uses a first-position New Project card without a header plus for %s",
    (database) => {
      const onOpenProject = vi.fn();
      const page = ProjectsHomePage({ projects: [project], database, navigation, onOpenProject });
      const html = renderToStaticMarkup(page);
      const header = html.slice(0, html.indexOf('class="home-content"'));
      expect(header).not.toContain('class="icon-button"');
      expect(html.indexOf('aria-label="New Project"')).toBeLessThan(
        html.indexOf('aria-label="Open A"'),
      );
      page.props.create?.onClick();
      expect(onOpenProject).toHaveBeenCalledExactlyOnceWith();
      const pending = renderToStaticMarkup(
        <ProjectsHomePage
          projects={[]}
          database={database}
          navigation={{ ...navigation, pending: true }}
          onOpenProject={onOpenProject}
        />,
      );
      expect(pending).toContain('aria-label="New Project" disabled=""');
    },
  );

  it("keeps New Session first and bound to each retained project, without a header plus", () => {
    const chatAction = vi.fn(async () => true);
    const pages = ProjectHomePages({
      projects: [project, { ...project, id: "b", path: "/projects/B", chatIds: [] }],
      chats,
      runs,
      selectedId: "one",
      activeId: "b",
      navigation: { ...navigation, chatAction },
    });
    for (const [index, id] of ["a", "b"].entries()) {
      const page = pages[index];
      if (!page) throw new Error("Missing retained project home");
      const html = renderToStaticMarkup(page);
      const header = html.slice(0, html.indexOf('class="home-content"'));
      expect(header).not.toContain('class="icon-button"');
      expect(html).toContain("New Session");
      if (id === "a")
        expect(html.indexOf("home-card-create")).toBeLessThan(html.indexOf('data-feature="one"'));
      expect(page.props.hidden).toBe(id !== "b");
      page.props.create?.onClick();
      expect(chatAction).toHaveBeenLastCalledWith({ type: "new", projectId: id });
    }
    expect(chatAction).toHaveBeenCalledTimes(2);
  });
});
