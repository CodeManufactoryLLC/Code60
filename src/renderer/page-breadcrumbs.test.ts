import { describe, expect, it } from "vitest";
import type { DesktopRun, OpenProject, OrchestrationChat } from "../bridge/index.js";
import { pages, settingsSectionIds } from "./navigation.js";
import {
  type BreadcrumbSource,
  breadcrumbAncestors,
  type PageTitleId,
} from "./page-breadcrumbs.js";

const empty: BreadcrumbSource = { projects: [], chats: [], runs: [] };
const source: BreadcrumbSource = {
  projects: [
    { id: "a", path: "/projects/Alpha", workerIds: ["worker-a", "manual-a"] },
    { id: "b", path: "/projects/Beta", workerIds: ["worker-b"] },
  ] as OpenProject[],
  chats: [
    {
      kind: "project",
      projectId: "a",
      run: { id: "chat-a" },
      title: "Plan A",
      workers: ["worker-a"],
    },
    {
      kind: "project",
      projectId: "b",
      run: { id: "chat-b" },
      title: "Plan B",
      workers: ["worker-b"],
    },
    { kind: "relay", conversationId: "relay", title: "Relay", workers: ["relay-worker"] },
  ] as unknown as OrchestrationChat[],
  runs: [
    { record: { id: "worker-a", agent: "test", status: "running" } },
    { record: { id: "worker-b", agent: "test", status: "running" } },
    { record: { id: "manual-a", agent: "test", status: "running" } },
    { record: { id: "relay-worker", agent: "test", status: "running" }, relay: {} },
  ] as DesktopRun[],
};

describe("page breadcrumb hierarchy", () => {
  it.each([
    ["home", []],
    ["settings", []],
    ["apps", []],
    ["project", ["Projects"]],
    ["commands", ["Apps"]],
    ["logs", ["Apps", "Data Viewer"]],
    ["polling", ["Apps", "Data Viewer"]],
    ["polling-settings", ["Apps"]],
    ["appearance", ["Apps"]],
    ["memory", ["Apps"]],
    ["updates", ["Apps"]],
    ["contributor-tools", ["Settings", "Advanced"]],
    ["rag", ["Settings", "Advanced", "Experiments"]],
    ["episodic-memory", ["Settings", "Advanced", "Experiments"]],
    ["relay", ["Assistants"]],
  ] as const)("resolves %s from the actual navigation tree", (page, labels) => {
    expect(breadcrumbAncestors(page, empty).map(({ label }) => label)).toEqual(
      page === "home" ? labels : ["Home", ...labels],
    );
  });

  it("adds exactly one Home root to all non-Home pages without changing their own ancestry", () => {
    for (const page of [...pages.map(({ id }) => id), ...settingsSectionIds]) {
      const ancestors = breadcrumbAncestors(page, empty);
      expect(ancestors.every(({ target }) => target.kind === "page")).toBe(true);
      expect(ancestors.every(({ icon }) => Boolean(icon))).toBe(true);
      expect(ancestors.filter(({ label }) => label === "Home")).toHaveLength(
        page === "home" ? 0 : 1,
      );
      if (page !== "home") expect(ancestors[0]?.target).toEqual({ kind: "page", id: "home" });
    }
    for (const page of settingsSectionIds)
      expect(breadcrumbAncestors(page, empty)).toEqual([
        { label: "Home", icon: "app-home2", target: { kind: "page", id: "home" } },
        ["appearance", "memory", "polling-settings", "updates"].includes(page)
          ? { label: "Apps", icon: "app-apps", target: { kind: "page", id: "apps" } }
          : { label: "Settings", icon: "app-cogwheel", target: { kind: "page", id: "settings" } },
      ]);
  });

  it.each([
    ["orchestrator", "chat-a", ["Projects", "Alpha"], ["projects", "a"]],
    ["worker", "worker-a", ["Projects", "Alpha", "Agent"], ["projects", "a", "chat-a"]],
    ["worker", "worker-b", ["Projects", "Beta", "Agent"], ["projects", "b", "chat-b"]],
    ["worker", "manual-a", ["Projects", "Alpha"], ["projects", "a"]],
    ["worker", "relay-worker", ["Assistants", "Relay"], ["assistants", "relay"]],
  ] as const)("keeps %s %s bound to its own project and conversation", (page, id, labels, ids) => {
    const ancestors = breadcrumbAncestors(page, source, { kind: "conversation", id });
    expect(ancestors.map(({ label }) => label)).toEqual(["Home", ...labels]);
    expect(ancestors.map(({ target }) => target.id)).toEqual(["home", ...ids]);
  });

  it("does not link archived owners or guess a selected project for missing identities", () => {
    const archived = {
      ...source,
      chats: source.chats.map((chat) => ({ ...chat, archived: true })),
    };
    expect(
      breadcrumbAncestors("worker", archived, { kind: "conversation", id: "worker-a" }).map(
        ({ label }) => label,
      ),
    ).toEqual(["Home", "Projects", "Alpha"]);
    for (const page of ["worker", "orchestrator"] satisfies PageTitleId[]) {
      for (const ancestors of [
        breadcrumbAncestors(page, source),
        breadcrumbAncestors(page, source, { kind: "page", id: "home" }),
        breadcrumbAncestors(page, empty, { kind: "conversation", id: "missing" }),
      ])
        expect(ancestors).toEqual([
          { label: "Home", icon: "app-home2", target: { kind: "page", id: "home" } },
        ]);
    }
  });

  it.each([
    ["worker-a", ["app-backlog", "app-folder", "app-communication"]],
    ["relay-worker", ["app-assistants", "app-steering-wheel"]],
  ] as const)("retains the icons for each dynamic %s ancestor", (id, icons) => {
    expect(
      breadcrumbAncestors("worker", source, {
        kind: "conversation",
        id,
      }).map(({ icon }) => icon),
    ).toEqual(["app-home2", ...icons]);
  });

  it("uses the registered chat owner rather than array order or an unidentified chat", () => {
    const reordered = {
      ...source,
      projects: source.projects
        .map((project) => ({
          ...project,
          workerIds: [...project.workerIds, "worker-a"],
        }))
        .toReversed(),
    };
    expect(
      breadcrumbAncestors("worker", reordered, {
        kind: "conversation",
        id: "worker-a",
      }).map(({ label }) => label),
    ).toEqual(["Home", "Projects", "Alpha", "Agent"]);
    const unidentified = {
      ...source,
      chats: [{ kind: "project", projectId: "b" }] as unknown as OrchestrationChat[],
    };
    expect(
      breadcrumbAncestors("worker", unidentified, {
        kind: "conversation",
        id: "missing",
      }),
    ).toEqual([{ label: "Home", icon: "app-home2", target: { kind: "page", id: "home" } }]);
  });
});
