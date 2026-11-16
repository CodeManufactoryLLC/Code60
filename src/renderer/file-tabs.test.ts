import { describe, expect, it } from "vitest";
import { emptyFileTabs, fileTabLabel, updateFileTabs } from "./file-tabs.js";

describe("Chat file tabs", () => {
  it("retains every pinned target in a grouped request preview without reusing a single-target tab", () => {
    const scope = {
      kind: "relay" as const,
      conversationId: "relay",
      generation: 1,
      targetId: "a",
      reviewId: "review-a",
    };
    const first = { scope, revisionId: "one", title: "Change files" };
    const related = [first, { ...first, scope: { ...scope, targetId: "b", reviewId: "review-b" } }];
    const action = { type: "revision" as const, reviewId: scope.reviewId, ...first };
    let state = updateFileTabs(emptyFileTabs("relay"), action);
    state = updateFileTabs(state, { ...action, related });
    expect(state.entries).toHaveLength(2);
    expect(state.entries[1]).toMatchObject({ related });
    state = updateFileTabs(state, { ...action, related });
    expect(state.entries).toHaveLength(2);
  });
  it("pins application files to their proposal and owner without replacing revision tabs", () => {
    const scope = {
      kind: "relay" as const,
      conversationId: "relay",
      generation: 2,
      targetId: "target",
      reviewId: "review",
    };
    const preview = {
      scope,
      revisionId: "revision",
      title: "same.ts",
      application: { operationId: "operation", fileId: "file", path: "same.ts" },
    };
    let state = updateFileTabs(emptyFileTabs("relay"), {
      type: "revision",
      reviewId: "review",
      revisionId: "revision",
      title: "Revision 1",
      scope,
    });
    state = updateFileTabs(state, { type: "application", preview });
    const application = state.active;
    state = updateFileTabs(state, { type: "application", preview });
    expect(state.entries).toHaveLength(2);
    expect(state.active).toBe(application);
    state = updateFileTabs(state, {
      type: "application",
      preview: { ...preview, scope: { ...scope, targetId: "other" } },
    });
    expect(state.entries).toHaveLength(3);
    const tab = state.entries[1];
    if (!tab) throw new Error("Missing application tab");
    expect(fileTabLabel(tab, state.entries)).toBe("Application · same.ts");
    expect(state.entries[0]).toMatchObject({ kind: "revision", scope });
    state = updateFileTabs(state, {
      type: "revision",
      reviewId: "review",
      revisionId: "revision",
      title: "New owner",
      scope: { ...scope, generation: 3 },
    });
    expect(state.entries).toHaveLength(4);
    expect(state.entries[0]).toMatchObject({ scope });
  });
  it("opens, reorders, closes and reopens a single Memory Recall tab without affecting other tabs", () => {
    let state = updateFileTabs(emptyFileTabs("project"), { type: "browse" });
    state = updateFileTabs(state, { type: "blank" });
    const blank = state.active;
    state = updateFileTabs(state, { type: "recall" });
    expect(state.active).toBe(blank);
    expect(state.entries.map((tab) => tab.kind)).toEqual(["explorer", "recall"]);
    const recall = state.entries[1];
    if (!recall) throw new Error("Missing recall tab");
    expect(fileTabLabel(recall, state.entries)).toBe("Memory Recall");
    state = updateFileTabs(state, { type: "blank" });
    state = updateFileTabs(state, { type: "recall" });
    expect(state.entries).toHaveLength(3);
    expect(state.active).toBe(recall.id);
    state = updateFileTabs(state, { type: "move", id: recall.id, to: 0 });
    expect(state.entries[0]).toBe(recall);
    state = updateFileTabs(state, { type: "close", id: recall.id });
    expect(state.entries.some((tab) => tab.kind === "recall")).toBe(false);
    state = updateFileTabs(state, { type: "recall" });
    expect(state.entries.filter((tab) => tab.kind === "recall")).toHaveLength(1);
    expect(state.active).not.toBe(recall.id);
  });
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

it("keeps one Changes list tab without stealing focus on new captures", () => {
  let state = updateFileTabs(emptyFileTabs("project"), {
    type: "file",
    path: "README.md",
  });
  const fileTabId = state.active;
  state = updateFileTabs(state, { type: "ensure-changes" });
  expect(state.active).toBe(fileTabId);
  expect(state.entries.filter((tab) => tab.kind === "changes")).toHaveLength(1);
  const changes = state.entries.find((tab) => tab.kind === "changes");
  if (!changes) throw new Error("Missing Changes tab");

  state = updateFileTabs(state, { type: "changes" });
  expect(state.entries.filter((tab) => tab.kind === "changes")).toHaveLength(1);
  expect(state.active).toBe(changes.id);
  expect(state.entries.find((tab) => tab.kind === "changes")).toEqual({
    id: changes.id,
    kind: "changes",
  });
  const selected = state.entries.find((tab) => tab.id === state.active);
  if (!selected) throw new Error("Missing selected tab");
  expect(fileTabLabel(selected, state.entries)).toBe("Changes");
  expect(updateFileTabs(state, { type: "ensure-changes" })).toBe(state);
});

it("opens separate pinned revision tabs, deduplicates by review and revision, and supports closing/reopening", () => {
  let state = updateFileTabs(emptyFileTabs("project"), { type: "changes" });
  const revision = {
    type: "revision" as const,
    reviewId: "task-a",
    revisionId: "one",
    title: "Revision 1 · Task A",
  };
  state = updateFileTabs(state, revision);
  const first = state.active;
  const firstTab = state.entries.find((tab) => tab.id === first);
  if (first === null || !firstTab) throw new Error("Missing revision tab");
  state = updateFileTabs(state, { ...revision, revisionId: "two", title: "Revision 2 · Task A" });
  state = updateFileTabs(state, { ...revision, reviewId: "task-b" });
  expect(state.entries).toHaveLength(4);
  state = updateFileTabs(state, revision);
  expect(state.entries).toHaveLength(4);
  expect(state.active).toBe(first);
  expect(fileTabLabel(firstTab, state.entries)).toBe(revision.title);
  state = updateFileTabs(state, { type: "changes" });
  expect(state.entries).toHaveLength(4);
  expect(state.active).toBe(1);
  state = updateFileTabs(state, { type: "close", id: first });
  state = updateFileTabs(state, revision);
  expect(state.active).not.toBe(first);
  expect(state.entries).toHaveLength(4);
});
