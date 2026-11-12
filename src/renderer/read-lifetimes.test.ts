import { describe, expect, it, vi } from "vitest";
import type { RunEvent } from "../core/index.js";
import { FileBrowserState } from "./file-browser-state.js";
import { TranscriptCache } from "./transcripts.js";

describe("project read disposal", () => {
  it("does not publish or start queued transcript reads from a disposed generation", async () => {
    let resolve!: (events: RunEvent[]) => void;
    const action = vi.fn(
      () =>
        new Promise<RunEvent[]>((done) => {
          resolve = done;
        }),
    );
    const cache = new TranscriptCache({ action });
    const first = cache.load([{ id: "old-a", version: "1" }]);
    await Promise.resolve();
    const queued = cache.load([{ id: "old-b", version: "1" }]);
    cache.dispose();
    cache.activate();
    resolve([]);
    await Promise.all([first, queued]);
    expect(action).toHaveBeenCalledTimes(1);
    expect(cache.snapshot()).toEqual({ events: {}, errors: {}, pending: 0 });
  });
  it("can read the same run again after replay, without reviving the earlier read", async () => {
    let resolve!: (events: RunEvent[]) => void;
    const action = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<RunEvent[]>((done) => {
            resolve = done;
          }),
      )
      .mockResolvedValue([]);
    const cache = new TranscriptCache({ action });
    const old = cache.load([{ id: "run", version: "1" }]);
    await Promise.resolve();
    cache.dispose();
    cache.activate();
    const fresh = cache.load([{ id: "run", version: "1" }]);
    resolve([{ runId: "run", type: "message", text: "Stale", at: "2026-11-12T00:00:00Z" }]);
    await Promise.all([old, fresh]);
    expect(action).toHaveBeenCalledTimes(2);
    expect(cache.snapshot()).toEqual({ events: { run: [] }, errors: {}, pending: 0 });
  });
  it("owns Explorer selections and expansion state without a project-path cache", () => {
    const old = new FileBrowserState("db/project-a");
    old.selectFile("a.ts");
    old.setExpanded(["src"]);
    const current = old.capture();
    old.dispose();
    const fresh = new FileBrowserState("db/project-a");
    old.selectFile("stale.ts");
    old.setError("Old request failed");
    expect(current()).toBe(false);
    expect(old.snapshot().selected).toBe("a.ts");
    expect(fresh.snapshot()).toEqual({ selected: null, expanded: [], error: "" });
    fresh.setExpanded(Array.from({ length: 64 }, (_, i) => String(i)));
    expect(fresh.snapshot().expanded).toEqual([]);
    expect(fresh.snapshot().error).toContain("Folder limit");
    fresh.setExpanded(() => ["new"]);
    expect(fresh.snapshot()).toEqual({ selected: null, expanded: ["new"], error: "" });
  });
});
