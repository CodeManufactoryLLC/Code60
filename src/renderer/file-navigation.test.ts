import { describe, expect, it, vi } from "vitest";
import { type FileContext, parseFileContext, type Snapshot } from "../bridge/index.js";
import { prepareFileNavigation, sameFileContext, showsProjectFiles } from "./file-navigation.js";

const scope = { database: "/db", directory: "/project" };
const snapshot = () => ({ ...scope, worktrees: null }) as Snapshot;
describe("project-root file navigation", () => {
  it("matches validated file snapshots independently of object property order", () => {
    const context: FileContext = {
      project: "/project",
      projectId: "03c57371-50ca-4072-83f0-5d8892d5addf",
      databaseEpoch: 2,
      root: "/project",
      directories: [""],
      preview: "source.ts",
    };
    const validated = parseFileContext(context);
    expect(JSON.stringify(validated)).not.toBe(JSON.stringify(context));
    expect(sameFileContext(validated, context)).toBe(true);
    for (const change of [
      { projectId: "1c201ec4-45fc-4a59-8182-6e5ed25906aa" },
      { databaseEpoch: 3 },
      { project: "/other" },
      { root: "/other" },
      { preview: "other.ts" },
      { directories: ["", "src"] },
      { active: false },
    ])
      expect(sameFileContext({ ...context, ...change }, context)).toBe(false);
    expect(sameFileContext(null, context)).toBe(false);
    expect(sameFileContext(context, undefined)).toBe(false);
  });
  it("uses the worker owner, never ambient project selection, for file-panel availability", () => {
    const state = {
      chat: { kind: "relay" },
      runs: [
        { record: { id: "project-worker" } },
        { record: { id: "relay-worker" }, relay: { targetId: "elsewhere" } },
      ],
    } as Snapshot;
    expect(showsProjectFiles(undefined, undefined)).toBe(false);
    expect(showsProjectFiles(state, undefined)).toBe(false);
    expect(showsProjectFiles(state, "relay-worker")).toBe(false);
    expect(showsProjectFiles(state, "missing")).toBe(false);
    expect(showsProjectFiles(state, "project-worker")).toBe(true);
    expect(
      showsProjectFiles({ ...state, chat: { ...state.chat, kind: "project" } }, undefined),
    ).toBe(true);
  });
  it("ignores legacy worktree roots without polling inventory", async () => {
    const latest = snapshot();
    const api = { poll: vi.fn(async () => {}), snapshot: vi.fn(async () => latest) };
    expect(await prepareFileNavigation(api, scope, "/worker")).toBe(latest);
    expect(api.poll).not.toHaveBeenCalled();
  });
  it("discards late navigation across project and database changes", async () => {
    for (const changed of [{ directory: "/other" }, { database: "/other-db" }]) {
      const api = { poll: vi.fn(), snapshot: vi.fn(async () => ({ ...snapshot(), ...changed })) };
      expect(await prepareFileNavigation(api, scope, "/private-chat")).toBeNull();
    }
  });
  it("requires a project and propagates snapshot failures", async () => {
    const api = {
      poll: vi.fn(),
      snapshot: vi.fn(async (): Promise<Snapshot> => {
        throw Error("Unavailable");
      }),
    };
    await expect(prepareFileNavigation(api, { ...scope, directory: null })).rejects.toThrow(
      "Open a project",
    );
    await expect(prepareFileNavigation(api, scope)).rejects.toThrow("Unavailable");
  });
  it("rejects a reopened project instance or database even when their paths are unchanged", async () => {
    const captured = { ...scope, projectInstanceId: "instance-a", databaseEpoch: 2 };
    for (const changed of [{ projectInstanceId: "instance-b" }, { databaseEpoch: 3 }]) {
      const api = { snapshot: vi.fn(async () => ({ ...snapshot(), ...captured, ...changed })) };
      expect(await prepareFileNavigation(api, captured)).toBeNull();
    }
    const latest = { ...snapshot(), ...captured };
    expect(await prepareFileNavigation({ snapshot: async () => latest }, captured)).toBe(latest);
  });
});
