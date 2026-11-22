import { expect, it, vi } from "vitest";
import { ProjectScope } from "./project-scope.js";
import { sessionPanelId } from "./session-panel.js";

it("isolates tabs, selection, ordering and file reads between sessions in one project", () => {
  const project = new ProjectScope("/db", "/project", "instance");
  const a = project.panel(sessionPanelId(undefined, "chat-a", "/session/a"));
  const b = project.panel(sessionPanelId(undefined, "chat-b"));
  const worker = project.panel(sessionPanelId("chat-a", undefined));
  const changed = vi.fn();
  const off = a.subscribe(changed);
  a.act({ type: "browse" });
  a.act({ type: "file", path: "a.ts" });
  a.files.selectFile("a.ts");
  a.files.setExpanded(["src"]);
  const savedA = a.snapshot();
  b.act({ type: "recall" });
  b.act({ type: "file", path: "b.ts" });
  b.act({ type: "move", id: 2, to: 0 });
  b.act({ type: "select", id: 1 });
  b.act({ type: "close", id: 2 });
  expect(project.panel(sessionPanelId(undefined, "reconnected-a", "/session/a"))).toBe(a);
  expect(a.snapshot()).toBe(savedA);
  expect(a.snapshot()).toMatchObject({
    active: 2,
    entries: [{ kind: "explorer" }, { path: "a.ts" }],
  });
  expect(b.snapshot()).toMatchObject({ active: 1, entries: [{ kind: "recall" }] });
  expect(worker.snapshot().entries).toEqual([]);
  expect(b.files.snapshot()).toMatchObject({ selected: null, expanded: [] });
  expect(a.files.snapshot()).toMatchObject({ selected: "a.ts", expanded: ["src"] });
  expect(changed).toHaveBeenCalledTimes(2);
  off();
  a.act({ type: "close", id: 999 });
  expect(changed).toHaveBeenCalledTimes(2);
  const current = a.capture();
  project.dispose();
  a.act({ type: "blank" });
  a.files.selectFile("late.ts");
  expect(current()).toBe(false);
  expect(a.snapshot()).toBe(savedA);
  expect(a.files.snapshot().selected).toBe("a.ts");
  const reopened = new ProjectScope("/db", "/project", "new-instance");
  expect(reopened.panel(sessionPanelId(undefined, "chat-a")).snapshot().entries).toEqual([]);
});

it("reactivates retained panels after effect replay without reviving stale operations", () => {
  const project = new ProjectScope("/db", "/project", "instance");
  const panel = project.panel(sessionPanelId(undefined, undefined));
  const oldRead = panel.capture();
  project.dispose();
  project.activate();
  expect(oldRead()).toBe(false);
  panel.act({ type: "file", path: "README.md" });
  expect(panel.snapshot().entries).toEqual([{ id: 1, kind: "file", path: "README.md" }]);
});
