import { describe, expect, it, vi } from "vitest";
import type { Snapshot } from "../bridge/index.js";
import { prepareFileNavigation } from "./file-navigation.js";

const scope = { database: "/db", directory: "/project" };
const snapshot = (paths = ["/worker"]) =>
  ({
    ...scope,
    worktrees: { repository: "project", worktrees: paths.map((path) => ({ path })) },
  }) as Snapshot;

function setup(latest = snapshot()) {
  return { poll: vi.fn(async () => {}), snapshot: vi.fn(async () => latest) };
}

describe("Browse files navigation", () => {
  it("refreshes worktrees before resolving a session's root", async () => {
    const api = setup();
    api.poll.mockImplementation(async () => {
      expect(api.snapshot).not.toHaveBeenCalled();
    });
    expect(await prepareFileNavigation(api, scope, "/worker")).toEqual(snapshot());
    expect(api.poll).toHaveBeenCalledWith(["worktrees"]);
  });
  it("opens a project's directory without requiring Git inventory", async () => {
    const latest = { ...snapshot(), worktrees: null };
    const api = setup(latest);
    expect(await prepareFileNavigation(api, scope, scope.directory)).toBe(latest);
    expect(api.poll).not.toHaveBeenCalled();
  });
  it("rejects missing worktrees and propagates refresh failures", async () => {
    await expect(prepareFileNavigation(setup(snapshot([])), scope, "/worker")).rejects.toThrow(
      /no longer available/,
    );
    const api = setup();
    api.poll.mockRejectedValue(new Error("Inventory unavailable"));
    await expect(prepareFileNavigation(api, scope, "/worker")).rejects.toThrow(
      "Inventory unavailable",
    );
    expect(api.snapshot).not.toHaveBeenCalled();
  });
  it("discards navigation if the project or database changed during refresh", async () => {
    for (const changed of [{ directory: "/other" }, { database: "/other-db" }]) {
      const api = setup();
      api.poll.mockImplementation(async () => {
        api.snapshot.mockResolvedValue({ ...snapshot(), ...changed });
      });
      expect(await prepareFileNavigation(api, scope, "/worker")).toBeNull();
    }
  });
});
