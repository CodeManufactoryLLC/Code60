import { describe, expect, it, vi } from "vitest";
import type { DesktopApi, Snapshot } from "../bridge/index.js";
import { SnapshotStore } from "./desktop-snapshot.js";

const frame = (revision: number, directory = "/a"): Snapshot =>
  ({
    revision,
    directory,
    database: "/db",
    events: [],
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
  const api = {
    subscribe: (listener: (snapshot: Snapshot) => void) => {
      receive = listener;
      return off;
    },
    snapshot: () => initial.promise,
  } as Pick<DesktopApi, "subscribe" | "snapshot">;
  return { initial, api, off, push: (snapshot: Snapshot) => receive(snapshot) };
}
describe("snapshot startup lifecycle", () => {
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
});
