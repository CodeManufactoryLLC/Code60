import { describe, expect, it, vi } from "vitest";
import { DEFAULT_MEMORY_SETTINGS, type MemoryPage, type MemorySnapshot } from "../bridge/index.js";
import { MemoriesModel } from "./memories-model.js";

const metadata: MemorySnapshot = {
  settings: DEFAULT_MEMORY_SETTINGS,
  provider: null,
  warning: null,
  busy: false,
  count: 0,
  bytes: 0,
  dailyCalls: 0,
  indexPending: 0,
  projects: [],
  conversations: [],
};
const page = (next: string | null = null): MemoryPage => ({ records: [], next });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture() {
  const api = {
    memorySnapshot: vi.fn().mockResolvedValue(metadata),
    browseMemories: vi.fn().mockResolvedValue(page()),
  };
  return { api, model: new MemoriesModel(api) };
}
const settled = async (model: MemoriesModel) => {
  await vi.waitFor(() => expect(model.snapshot().pending).toBe(false));
};

describe("Memories table paging and lifetime", () => {
  it("reads only when active, refreshes on notices, and unsubscribes listeners", async () => {
    const { api, model } = fixture();
    const changed = vi.fn();
    const off = model.subscribe(changed);
    model.refresh();
    expect(api.browseMemories).not.toHaveBeenCalled();
    model.activate(true);
    model.activate(true);
    await settled(model);
    expect(model.snapshot().metadata).toBe(metadata);
    expect(api.browseMemories).toHaveBeenCalledTimes(1);
    model.refresh();
    await settled(model);
    expect(api.browseMemories).toHaveBeenCalledTimes(2);
    expect(changed).toHaveBeenCalled();
    off();
    changed.mockClear();
    model.activate(false);
    model.refresh();
    expect(changed).not.toHaveBeenCalled();
    expect(api.browseMemories).toHaveBeenCalledTimes(2);
  });
  it("uses opaque page cursors without accumulating records and resets paging on filters", async () => {
    const { api, model } = fixture();
    model.previous();
    model.next();
    api.browseMemories
      .mockResolvedValueOnce(page("cursor-one"))
      .mockResolvedValueOnce(page("cursor-two"))
      .mockResolvedValueOnce(page());
    model.activate(true);
    await settled(model);
    model.next();
    model.next();
    await settled(model);
    expect(api.browseMemories).toHaveBeenLastCalledWith({ cursor: "cursor-one" });
    expect(model.snapshot().pageNumber).toBe(2);
    model.next();
    await settled(model);
    expect(api.browseMemories).toHaveBeenLastCalledWith({ cursor: "cursor-two" });
    expect(model.snapshot().pageNumber).toBe(3);
    model.previous();
    await settled(model);
    expect(api.browseMemories).toHaveBeenLastCalledWith({ cursor: "cursor-one" });
    model.configure({ projectId: "project", type: "lesson", state: "disputed" });
    expect(model.snapshot().page.records).toEqual([]);
    await settled(model);
    expect(model.snapshot().pageNumber).toBe(1);
    expect(api.browseMemories).toHaveBeenLastCalledWith({
      projectId: "project",
      type: "lesson",
      state: "disputed",
      cursor: undefined,
    });
    model.previous();
    expect(model.snapshot().pageNumber).toBe(1);
  });
  it("serializes and coalesces reads while rejecting replies for old filters", async () => {
    const { api, model } = fixture();
    const old = deferred<MemoryPage>();
    const current = deferred<MemoryPage>();
    api.browseMemories.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    model.activate(true);
    model.configure({ type: "semantic" });
    for (let i = 0; i < 20; i++) model.refresh();
    expect(api.browseMemories).toHaveBeenCalledTimes(1);
    old.resolve(page("old"));
    await vi.waitFor(() => expect(api.browseMemories).toHaveBeenCalledTimes(2));
    expect(model.snapshot().page.next).toBeNull();
    current.resolve(page("current"));
    await settled(model);
    expect(model.snapshot().page.next).toBe("current");
  });
  it("discards late replies after hiding and handles activation during an old read", async () => {
    const { api, model } = fixture();
    const old = deferred<MemoryPage>();
    api.browseMemories.mockReturnValueOnce(old.promise);
    model.activate(true);
    model.activate(false);
    old.resolve(page("hidden"));
    await Promise.resolve();
    await Promise.resolve();
    expect(model.snapshot().page.next).toBeNull();
    const next = deferred<MemoryPage>();
    api.browseMemories.mockReturnValueOnce(next.promise);
    model.activate(true);
    expect(model.snapshot().pending).toBe(true);
    next.resolve(page("visible"));
    await settled(model);
    expect(model.snapshot().page.next).toBe("visible");
  });
  it("waits for both reads to finish after a failure and allows an explicit retry", async () => {
    const { api, model } = fixture();
    const remaining = deferred<MemoryPage>();
    api.memorySnapshot.mockRejectedValueOnce(new Error("private storage error"));
    api.browseMemories.mockReturnValueOnce(remaining.promise);
    model.activate(true);
    await Promise.resolve();
    expect(model.snapshot().pending).toBe(true);
    remaining.resolve(page());
    await settled(model);
    expect(model.snapshot().error).toContain("Refresh memories");
    expect(model.snapshot().error).not.toContain("private storage error");
    model.refresh();
    await settled(model);
    expect(model.snapshot().error).toBe("");
  });
});
