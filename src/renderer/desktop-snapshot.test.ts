import { describe, expect, it, vi } from "vitest";
import type { DesktopApi, Snapshot } from "../bridge/index.js";
import { SnapshotStore } from "./desktop-snapshot.js";

const frame = (revision: number, directory = "/a"): Snapshot =>
  ({
    revision,
    directory,
    database: "/db",
    events: [],
    runs: [],
    chats: [],
    chat: { run: null, events: [] },
  }) as unknown as Snapshot;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function source() {
  const initial = deferred<Snapshot>();
  let receive!: (snapshot: Snapshot) => void;
  const off = vi.fn();
  const read = vi.fn(() => initial.promise);
  const api = {
    subscribe: (listener: (snapshot: Snapshot) => void) => {
      receive = listener;
      return off;
    },
    snapshot: read,
  } as Pick<DesktopApi, "subscribe" | "snapshot">;
  return { initial, api, off, read, push: (snapshot: Snapshot) => receive(snapshot) };
}
const delta = (revision: number, previousRevision: number): Snapshot => ({
  ...frame(revision),
  previousRevision,
});
const withEvents = (snapshot: Snapshot, revisions: number[]): Snapshot => ({
  ...snapshot,
  events: revisions.map((revision) => ({
    revision,
    event: {
      type: "message",
      runId: "worker",
      text: `Message ${revision}`,
      at: "2026-11-02T12:00:00.000Z",
    },
  })),
});
describe("snapshot startup lifecycle", () => {
  it("uses summary reads for initial load and gap recovery without legacy snapshot reads", async () => {
    const sourceApi = source();
    const summary = vi.fn(async () => ({ ...frame(1), summaryOnly: true as const }));
    const store = new SnapshotStore();
    const stop = store.start({ ...sourceApi.api, appSummary: summary }, vi.fn());
    await vi.waitFor(() => expect(store.snapshot()?.snapshot.revision).toBe(1));
    summary.mockResolvedValueOnce({ ...frame(5), summaryOnly: true });
    sourceApi.push(delta(5, 4));
    await vi.waitFor(() => expect(store.snapshot()?.snapshot.revision).toBe(5));
    expect(summary).toHaveBeenCalledTimes(2);
    expect(sourceApi.read).not.toHaveBeenCalled();
    stop();
  });
  it("accepts the maximum 32 buffered frames without an unnecessary recovery read", async () => {
    const sourceApi = source();
    const store = new SnapshotStore();
    const stop = store.start(sourceApi.api, vi.fn());
    for (let revision = 2; revision <= 33; revision++)
      sourceApi.push(withEvents(delta(revision, revision - 1), [revision]));
    sourceApi.initial.resolve(withEvents(frame(1), [1]));
    await sourceApi.initial.promise;
    expect(store.snapshot()?.events.worker).toHaveLength(33);
    expect(sourceApi.read).toHaveBeenCalledTimes(1);
    stop();
  });

  it("resynchronizes an overflowing startup buffer before publishing incomplete history", async () => {
    const sourceApi = source();
    const fresh = deferred<Snapshot>();
    sourceApi.read.mockReturnValueOnce(sourceApi.initial.promise).mockReturnValue(fresh.promise);
    const store = new SnapshotStore();
    const published = vi.fn();
    store.subscribe(published);
    const stop = store.start(sourceApi.api, vi.fn());
    for (let revision = 2; revision <= 10_002; revision++)
      sourceApi.push(withEvents(delta(revision, revision - 1), [revision]));
    sourceApi.initial.resolve(withEvents(frame(1), [1]));
    await vi.waitFor(() => expect(sourceApi.read).toHaveBeenCalledTimes(2));
    expect(store.snapshot()).toBeUndefined();
    expect(published).not.toHaveBeenCalled();
    sourceApi.push(withEvents(delta(10_003, 10_002), [10_003]));
    fresh.resolve(withEvents(frame(10_002), [1, 5_000, 10_002]));
    await fresh.promise;
    expect(store.snapshot()?.events.worker?.map((event) => "text" in event && event.text)).toEqual([
      "Message 1",
      "Message 5000",
      "Message 10002",
      "Message 10003",
    ]);
    expect(published).toHaveBeenCalledTimes(1);
    stop();
  });

  it("recovers a live broadcast gap with one read while buffering later deltas", async () => {
    const sourceApi = source();
    const fresh = deferred<Snapshot>();
    sourceApi.read.mockReturnValueOnce(sourceApi.initial.promise).mockReturnValue(fresh.promise);
    const store = new SnapshotStore();
    const stop = store.start(sourceApi.api, vi.fn());
    sourceApi.initial.resolve(withEvents(frame(1), [1]));
    await sourceApi.initial.promise;
    sourceApi.push(withEvents(delta(5, 4), [5]));
    sourceApi.push(withEvents(delta(6, 5), [6]));
    expect(sourceApi.read).toHaveBeenCalledTimes(2);
    expect(store.snapshot()?.snapshot.revision).toBe(1);
    fresh.resolve(withEvents(frame(5), [1, 3, 5]));
    await fresh.promise;
    expect(store.snapshot()?.events.worker).toHaveLength(4);
    expect(store.snapshot()?.snapshot.revision).toBe(6);
    sourceApi.push(delta(4, 3));
    expect(sourceApi.read).toHaveBeenCalledTimes(2);
    stop();
  });

  it("resynchronizes a gap in updates buffered during startup", async () => {
    const sourceApi = source();
    const fresh = deferred<Snapshot>();
    sourceApi.read.mockReturnValueOnce(sourceApi.initial.promise).mockReturnValue(fresh.promise);
    const store = new SnapshotStore();
    const stop = store.start(sourceApi.api, vi.fn());
    sourceApi.push(delta(5, 4));
    sourceApi.initial.resolve(frame(1));
    await vi.waitFor(() => expect(sourceApi.read).toHaveBeenCalledTimes(2));
    expect(store.snapshot()).toBeUndefined();
    fresh.resolve(frame(5));
    await fresh.promise;
    expect(store.snapshot()?.snapshot.revision).toBe(5);
    stop();
  });

  it("bounds repeated recovery and reports an actionable failure instead of silently dropping events", async () => {
    const sourceApi = source();
    const store = new SnapshotStore();
    const fail = vi.fn();
    sourceApi.read.mockImplementation(async () => {
      for (let revision = 2; revision <= 34; revision++)
        sourceApi.push(delta(revision, revision - 1));
      return frame(1);
    });
    const stop = store.start(sourceApi.api, fail);
    await vi.waitFor(() => expect(fail).toHaveBeenCalledTimes(1));
    expect(fail).toHaveBeenCalledWith(expect.stringMatching(/reload.*resynchroniz/i));
    expect(sourceApi.read).toHaveBeenCalledTimes(3);
    expect(sourceApi.off).toHaveBeenCalledTimes(1);
    expect(store.snapshot()).toBeUndefined();
    stop();
    expect(sourceApi.off).toHaveBeenCalledTimes(1);
  });

  it("disposes an in-flight gap recovery without publishing into a replacement subscription", async () => {
    const oldSource = source();
    const fresh = deferred<Snapshot>();
    oldSource.read.mockReturnValueOnce(oldSource.initial.promise).mockReturnValue(fresh.promise);
    const store = new SnapshotStore();
    const fail = vi.fn();
    const stop = store.start(oldSource.api, fail);
    oldSource.initial.resolve(frame(1));
    await oldSource.initial.promise;
    oldSource.push(delta(5, 4));
    stop();
    const newSource = source();
    const stopNew = store.start(newSource.api, fail);
    newSource.initial.resolve(frame(7));
    await newSource.initial.promise;
    fresh.resolve(frame(10));
    await fresh.promise;
    expect(store.snapshot()?.snapshot.revision).toBe(7);
    expect(oldSource.off).toHaveBeenCalledTimes(1);
    expect(fail).not.toHaveBeenCalled();
    stopNew();
  });

  it("retains replacement epochs for A to B to A even without an intermediate render", () => {
    const store = new SnapshotStore();
    store.accept(frame(1));
    const first = store.snapshot();
    store.accept(frame(2, "/b"));
    store.accept(frame(3, "/a"));
    expect(store.snapshot()?.snapshot.directory).toBe(first?.snapshot.directory);
    expect(store.snapshot()?.projectGeneration).toBe((first?.projectGeneration ?? 0) + 2);
    expect(store.snapshot()?.databaseGeneration).toBe(first?.databaseGeneration);
    store.accept({ ...frame(4), database: "/other-db" });
    store.accept(frame(5));
    expect(store.snapshot()?.databaseGeneration).toBe((first?.databaseGeneration ?? 0) + 2);
    const latest = store.snapshot();
    store.accept(frame(2, "/stale"));
    expect(store.snapshot()).toBe(latest);
  });
  it("subscribes first and publishes the buffered revision merge atomically", async () => {
    const sourceApi = source();
    const store = new SnapshotStore();
    const published = vi.fn();
    const unlisten = store.subscribe(published);
    const fail = vi.fn();
    const stop = store.start(sourceApi.api, fail);
    sourceApi.push(frame(3));
    sourceApi.push(frame(2));
    expect(store.snapshot()).toBeUndefined();
    sourceApi.initial.resolve(frame(1));
    await sourceApi.initial.promise;
    expect(store.snapshot()?.snapshot.revision).toBe(3);
    expect(published).toHaveBeenCalledTimes(1);
    sourceApi.push(frame(4));
    expect(store.snapshot()?.snapshot.revision).toBe(4);
    store.accept(frame(6));
    sourceApi.push(frame(5));
    expect(store.snapshot()?.snapshot.revision).toBe(6);
    expect(fail).not.toHaveBeenCalled();
    unlisten();
    stop();
    expect(sourceApi.off).toHaveBeenCalledTimes(1);
  });
  it("disposes startup and live callbacks without publishing late results", async () => {
    const sourceApi = source();
    const store = new SnapshotStore();
    const stop = store.start(sourceApi.api, vi.fn());
    stop();
    sourceApi.push(frame(2));
    sourceApi.initial.resolve(frame(1));
    await sourceApi.initial.promise;
    expect(store.snapshot()).toBeUndefined();
    stop();
    expect(sourceApi.off).toHaveBeenCalledTimes(1);
  });
  it("reports startup failure once and releases the subscription and buffer", async () => {
    const sourceApi = source();
    const store = new SnapshotStore();
    const fail = vi.fn();
    const stop = store.start(sourceApi.api, fail);
    sourceApi.push(frame(2));
    sourceApi.initial.reject(new Error("Unavailable"));
    await sourceApi.initial.promise.catch(() => {});
    await Promise.resolve();
    expect(fail).toHaveBeenCalledExactlyOnceWith("Unavailable");
    expect(sourceApi.off).toHaveBeenCalledTimes(1);
    sourceApi.push(frame(3));
    expect(store.snapshot()).toBeUndefined();
    stop();
    expect(sourceApi.off).toHaveBeenCalledTimes(1);
  });
  it("ignores failure from a disposed startup during effect replay", async () => {
    const oldSource = source();
    const newSource = source();
    const store = new SnapshotStore();
    const fail = vi.fn();
    store.start(oldSource.api, fail)();
    const stop = store.start(newSource.api, fail);
    oldSource.initial.reject("old failure");
    newSource.initial.resolve(frame(7));
    await Promise.allSettled([oldSource.initial.promise, newSource.initial.promise]);
    expect(fail).not.toHaveBeenCalled();
    expect(store.snapshot()?.snapshot.revision).toBe(7);
    stop();
  });
  it("replaces bounded Relay worker windows independently of project and event revisions", () => {
    const store = new SnapshotStore();
    const relayFrame = (revision: number, texts: string[], directory = "/a"): Snapshot => ({
      ...frame(revision, directory),
      runs: [
        {
          record: { id: "relay-worker" } as Snapshot["runs"][number]["record"],
          agentAlive: false,
          relay: {
            conversationId: "conversation",
            generation: 1,
            taskId: "task",
            targetId: "target",
            cwd: "/unopened-target",
            workspaceMode: "direct",
          },
        },
      ],
      events: texts.map((text, index) => ({
        revision: index + 1,
        event: { type: "message", runId: "relay-worker", at: "2026-11-02T12:00:00.000Z", text },
      })),
    });
    store.accept(relayFrame(100, ["old", "recent"]));
    store.accept(relayFrame(101, ["recent"]));
    expect(store.snapshot()?.events["relay-worker"]).toHaveLength(1);
    store.accept(relayFrame(102, ["recent", "new"], "/b"));
    expect(store.snapshot()?.events["relay-worker"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: "recent" }),
        expect.objectContaining({ text: "new" }),
      ]),
    );
    expect(store.snapshot()?.events["relay-worker"]).toHaveLength(2);
  });
});
