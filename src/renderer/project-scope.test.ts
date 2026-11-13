import { describe, expect, it, vi } from "vitest";
import { ProjectScope } from "./project-scope.js";

describe("project scope ownership", () => {
  it("retains explorer and transcript owners until the project is actually closed", () => {
    const scope = new ProjectScope("/db", "/a", "instance-a");
    const other = new ProjectScope("/db", "/b", "instance-b");
    const api = { action: vi.fn(async () => []) };
    const files = scope.files();
    const transcripts = scope.transcripts(api);
    files.selectFile("src/a.ts");
    files.setExpanded(["src"]);
    other.files().selectFile("b.ts");
    expect(scope.files()).toBe(files);
    expect(scope.transcripts(api)).toBe(transcripts);
    expect(files.snapshot()).toMatchObject({ selected: "src/a.ts", expanded: ["src"] });
    const fileLifetime = files.capture();
    const transcriptLifetime = transcripts.capture();
    scope.dispose();
    expect(fileLifetime()).toBe(false);
    expect(transcriptLifetime()).toBe(false);
    files.selectFile("late.ts");
    expect(files.snapshot().selected).toBe("src/a.ts");
    expect(other.files().snapshot().selected).toBe("b.ts");
  });
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
