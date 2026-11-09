import { describe, expect, it } from "vitest";
import { emptyFileTabs, fileTabLabel, updateFileTabs } from "./file-tabs.js";

describe("Chat file tabs", () => {
  it("starts empty, converts blanks in place, and allows multiple Explorers", () => {
    const empty = emptyFileTabs("db:project");
    expect(empty.entries).toEqual([]);
    let state = updateFileTabs(empty, { type: "blank" });
    const id = state.active;
    state = updateFileTabs(state, { type: "explorer" });
    expect(state.entries).toEqual([{ id, kind: "explorer" }]);
    state = updateFileTabs(state, { type: "blank" });
    state = updateFileTabs(state, { type: "explorer" });
    expect(state.entries.map((tab) => tab.kind)).toEqual(["explorer", "explorer"]);
    expect(new Set(state.entries.map((tab) => tab.id)).size).toBe(2);
    expect(updateFileTabs(empty, { type: "explorer" }).entries).toHaveLength(1);
  });

  it("deduplicates files by path and routes Browse to an existing Explorer", () => {
    let state = updateFileTabs(emptyFileTabs("project"), { type: "browse" });
    state = updateFileTabs(state, { type: "file", path: "src/main.ts" });
    state = updateFileTabs(state, { type: "file", path: "test/main.ts" });
    const ids = state.entries.map((tab) => tab.id);
    state = updateFileTabs(state, { type: "file", path: "src/main.ts" });
    expect(state.entries.map((tab) => tab.id)).toEqual(ids);
    expect(state.active).toBe(ids[1]);
    state = updateFileTabs(state, { type: "browse" });
    expect(state.active).toBe(ids[0]);
    expect(state.entries).toHaveLength(3);
    expect(state.entries.map((tab) => fileTabLabel(tab, state.entries))).toEqual([
      "File Explorer",
      "src/main.ts",
      "test/main.ts",
    ]);
  });

  it("closes active tabs toward the right, then left, and finally returns to empty", () => {
    let state = emptyFileTabs("project");
    for (let i = 0; i < 3; i++) state = updateFileTabs(state, { type: "blank" });
    state = updateFileTabs(state, { type: "select", id: 2 });
    state = updateFileTabs(state, { type: "close", id: 2 });
    expect(state.active).toBe(3);
    state = updateFileTabs(state, { type: "close", id: 3 });
    expect(state.active).toBe(1);
    state = updateFileTabs(state, { type: "close", id: 1 });
    expect(state.entries).toEqual([]);
    expect(state.active).toBeNull();
    expect(updateFileTabs(state, { type: "blank" }).active).toBe(4);
  });

  it("preserves selection when closing background tabs and moving either kind of tab", () => {
    let state = emptyFileTabs("project");
    for (let i = 0; i < 4; i++) state = updateFileTabs(state, { type: "blank" });
    state = updateFileTabs(state, { type: "move", id: 4, to: -1 });
    expect(state.entries.map((tab) => tab.id)).toEqual([4, 1, 2, 3]);
    expect(state.active).toBe(4);
    state = updateFileTabs(state, { type: "move", id: 1, to: 100 });
    expect(state.entries.map((tab) => tab.id)).toEqual([4, 2, 3, 1]);
    expect(state.active).toBe(4);
    state = updateFileTabs(state, { type: "close", id: 2 });
    expect(state.active).toBe(4);
    expect(updateFileTabs(state, { type: "select", id: 99 })).toBe(state);
    expect(updateFileTabs(state, { type: "close", id: 99 })).toBe(state);
    expect(updateFileTabs(state, { type: "move", id: 99, to: 0 })).toBe(state);
  });

  it("keeps the same workspace state and clears all tabs when project or database changes", () => {
    const state = updateFileTabs(emptyFileTabs("db:project"), { type: "file", path: "a.txt" });
    expect(updateFileTabs(state, { type: "reset", workspace: "db:project" })).toBe(state);
    for (const workspace of ["db:other-project", "other-db:project"])
      expect(updateFileTabs(state, { type: "reset", workspace })).toEqual(emptyFileTabs(workspace));
    const tab = state.entries[0];
    if (!tab) throw new Error("Missing tab");
    expect(fileTabLabel(tab, state.entries)).toBe("a.txt");
  });
});

it("keeps project and immutable worker versions distinct even with the same relative path", () => {
  let state = updateFileTabs(emptyFileTabs("project"), { type: "file", path: "same.ts" });
  for (const worker of ["a", "b"])
    state = updateFileTabs(state, {
      type: "file",
      path: "same.ts",
      source: {
        reviewId: "review",
        revisionId: "one",
        fileKey: `${worker}:same.ts`,
        label: worker,
      },
    });
  state = updateFileTabs(state, {
    type: "file",
    path: "same.ts",
    source: { reviewId: "review", revisionId: "two", fileKey: "a:same.ts", label: "a" },
  });
  expect(state.entries).toHaveLength(4);
  state = updateFileTabs(state, {
    type: "file",
    path: "same.ts",
    source: { reviewId: "review", revisionId: "one", fileKey: "a:same.ts", label: "a" },
  });
  expect(state.entries).toHaveLength(4);
  expect(state.active).toBe(2);
});

it("deduplicates plan tabs by identity and keeps their revised titles", () => {
  let state = updateFileTabs(emptyFileTabs("project"), {
    type: "plan",
    planId: "plan",
    title: "First",
  });
  state = updateFileTabs(state, { type: "file", path: "README.md" });
  state = updateFileTabs(state, { type: "plan", planId: "plan", title: "Revised" });
  expect(state.entries).toHaveLength(2);
  expect(state.entries[0]).toMatchObject({ kind: "plan", title: "Revised" });
  expect(state.active).toBe(state.entries[0]?.id);
});
