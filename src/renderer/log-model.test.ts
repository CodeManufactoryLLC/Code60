import { describe, expect, it, vi } from "vitest";
import type { LogPage, LogRecord } from "../bridge/index.js";
import { LogViewer } from "./log-model.js";

const page = (records: LogRecord[] = [], cursor: string | null = null): LogPage => ({
  records,
  cursor,
  state: "ready",
  appLaunchId: crypto.randomUUID(),
  status: { unavailable: false, malformed: 0, dropped: 0, persistenceFailures: 0 },
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
describe("diagnostic viewer request lifetime", () => {
  it("ignores stale responses after filters change or the page is hidden", async () => {
    const old = deferred<LogPage>();
    const current = deferred<LogPage>();
    const queryLogs = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const model = new LogViewer({ queryLogs });
    model.activate(true);
    model.configure({ search: "new query" });
    const expected = page();
    current.resolve(expected);
    await vi.waitFor(() => expect(model.snapshot().page).toBe(expected));
    old.resolve(page());
    await Promise.resolve();
    expect(model.snapshot().page).toBe(expected);
    model.activate(false);
    model.notice();
    model.setFollowing(true);
    expect(queryLogs).toHaveBeenCalledTimes(2);
  });
  it("does not move a paused, selected, paged or scrolled reader on live notices", async () => {
    const queryLogs = vi.fn().mockResolvedValue(page([], crypto.randomUUID()));
    const model = new LogViewer({ queryLogs });
    model.activate(true);
    await vi.waitFor(() => expect(model.snapshot().pending).toBe(false));
    model.pause(true);
    model.notice();
    model.setFollowing(true);
    expect(queryLogs).toHaveBeenCalledTimes(1);
    expect(model.snapshot().newRecords).toBe(true);
    model.setFollowing(false);
    model.pause(false);
    expect(queryLogs).toHaveBeenCalledTimes(1);
    model.select({ id: "selected" } as LogRecord);
    model.setFollowing(true);
    model.notice();
    expect(queryLogs).toHaveBeenCalledTimes(1);
    model.select(undefined);
    await model.next();
    expect(model.snapshot().newRecords).toBe(true);
    model.setFollowing(true);
    model.notice();
    expect(queryLogs).toHaveBeenCalledTimes(2);
    expect(model.snapshot().pageNumber).toBe(2);
    await model.previous();
    expect(model.snapshot().pageNumber).toBe(1);
    model.notice();
    await vi.waitFor(() => expect(queryLogs).toHaveBeenCalledTimes(4));
  });
  it("catches up notices received during an explicit latest read before scrolling finishes", async () => {
    const latest = deferred<LogPage>();
    const queryLogs = vi.fn().mockResolvedValue(page());
    const model = new LogViewer({ queryLogs });
    model.activate(true);
    await vi.waitFor(() => expect(model.snapshot().pending).toBe(false));
    model.setFollowing(false);
    model.pause(true);
    model.notice();
    model.pause(false);
    queryLogs.mockReturnValueOnce(latest.promise);
    const refresh = model.refresh();
    model.notice();
    model.notice();
    latest.resolve(page());
    await refresh;
    expect(queryLogs).toHaveBeenCalledTimes(2);
    expect(model.snapshot().newRecords).toBe(true);
    model.setFollowing(true);
    model.setFollowing(true);
    await vi.waitFor(() => expect(queryLogs).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(model.snapshot().pending).toBe(false));
    expect(model.snapshot().newRecords).toBe(false);
  });
  it("coalesces notices during a read and retries explicit failures", async () => {
    const first = deferred<LogPage>();
    const queryLogs = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(page());
    const model = new LogViewer({ queryLogs });
    model.activate(true);
    model.notice();
    model.notice();
    model.notice();
    first.resolve(page());
    await vi.waitFor(() => expect(queryLogs).toHaveBeenCalledTimes(2));
    queryLogs.mockRejectedValueOnce(new Error("private backend detail"));
    await model.refresh();
    expect(model.snapshot().page).toBeUndefined();
    expect(model.snapshot().error).toContain("Could not read");
    expect(model.snapshot().error).not.toContain("private backend detail");
    await model.retry();
    expect(model.snapshot().error).toBe("");
  });
  it("invalidates project responses and preserves launch scope when filters change", async () => {
    const stale = deferred<LogPage>();
    const current = page();
    const queryLogs = vi.fn().mockReturnValueOnce(stale.promise).mockResolvedValue(current);
    const model = new LogViewer({ queryLogs });
    const subscriber = vi.fn();
    const unsubscribe = model.subscribe(subscriber);
    model.setContext("first-project");
    model.activate(true);
    model.activate(false);
    model.setContext("second-project");
    const launch = crypto.randomUUID();
    model.configure({ appLaunchId: launch });
    model.configure({ search: "retained" });
    model.activate(true);
    await vi.waitFor(() => expect(model.snapshot().page).toBe(current));
    stale.resolve(page());
    await Promise.resolve();
    expect(model.snapshot().page).toBe(current);
    expect(queryLogs.mock.lastCall?.[0]).toMatchObject({ appLaunchId: launch, search: "retained" });
    model.configure({ search: "retained" });
    expect(queryLogs).toHaveBeenCalledTimes(2);
    expect(subscriber).toHaveBeenCalled();
    unsubscribe();
    subscriber.mockClear();
    model.pause(true);
    expect(subscriber).not.toHaveBeenCalled();
  });
  it("can read beyond 128 pages while retaining only a bounded back stack", async () => {
    const model = new LogViewer({
      queryLogs: vi.fn().mockResolvedValue(page([], crypto.randomUUID())),
    });
    await model.refresh();
    for (let index = 0; index < 140; index++) await model.next();
    expect(model.snapshot().pageNumber).toBe(141);
    for (let index = 0; index < 140; index++) await model.previous();
    expect(model.snapshot().pageNumber).toBe(14);
    expect(model.snapshot().hasPrevious).toBe(false);
    await model.refresh();
    expect(model.snapshot().pageNumber).toBe(1);
  });
});
