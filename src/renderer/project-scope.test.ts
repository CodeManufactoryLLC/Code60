import { describe, expect, it, vi } from "vitest";
import { ProjectScope } from "./project-scope.js";

describe("project scope ownership", () => {
  it("keeps UI state when a view is hidden; only disposal invalidates its work", () => {
    const scope = new ProjectScope("/db", "/a");
    const current = scope.capture();
    scope.set("selected", "worker");
    const state = scope.snapshot();
    // Navigation/visibility is not an input to the scope and cannot dispose it.
    expect(scope.snapshot()).toBe(state);
    expect(current()).toBe(true);
    scope.dispose();
    scope.set("selected", "late worker");
    expect(current()).toBe(false);
    expect(scope.snapshot().selected).toBe("worker");
  });
  it("creates independent owners for A → B → A, including the same path in another database", () => {
    const firstA = new ProjectScope("/db", "/a");
    firstA.set("setup", true);
    firstA.set("visitedWorkers", { workspace: firstA.workspace, ids: ["old"] });
    const current = firstA.capture();
    firstA.dispose();
    const b = new ProjectScope("/db", "/b");
    const secondA = new ProjectScope("/db", "/a");
    const otherDb = new ProjectScope("/other-db", "/a");
    expect(secondA.identity).toBe(firstA.identity);
    expect(secondA).not.toBe(firstA);
    expect(current()).toBe(false);
    expect(secondA.snapshot().setup).toBe(false);
    expect(secondA.snapshot().visitedWorkers.ids).toEqual([]);
    expect(b.workspace).not.toBe(secondA.workspace);
    expect(otherDb.identity).not.toBe(secondA.identity);
  });
  it("notifies only changed live state and never revives earlier operations", () => {
    const scope = new ProjectScope("/db", "/a");
    const changed = vi.fn();
    const off = scope.subscribe(changed);
    scope.set("setup", false);
    expect(changed).not.toHaveBeenCalled();
    scope.set("setup", (previous) => !previous);
    expect(changed).toHaveBeenCalledTimes(1);
    const old = scope.capture();
    scope.dispose();
    scope.activate();
    expect(old()).toBe(false);
    expect(scope.capture()()).toBe(true);
    off();
    scope.set("setup", false);
    expect(changed).toHaveBeenCalledTimes(1);
  });
});
