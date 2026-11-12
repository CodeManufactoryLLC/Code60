import { afterEach, expect, it, vi } from "vitest";
import { type PollKey, pollKeys } from "../bridge/index.js";
import { type PollOwner, ScopedPoller } from "./scoped-poller.js";

afterEach(() => vi.useRealTimers());

function setup() {
  let selected = "a";
  let database = "1";
  const closed = new Set<string>();
  const reads = vi.fn(async (_owner: string, _key: PollKey, _current: () => boolean) => {});
  const resolve = (key: PollKey): PollOwner => {
    const kind =
      key === "config" ? "application" : key === "configurations" ? "database" : "target";
    const id = kind === "application" ? "config" : kind === "database" ? database : selected;
    return {
      scope: { kind, id },
      keys:
        kind === "application"
          ? ["config"]
          : kind === "database"
            ? ["configurations"]
            : ["history", "files", "worktrees"],
      alive: () => !closed.has(id) && (kind !== "database" || database === id),
      active: () => true,
      visible: () => kind !== "target" || selected === id,
      available: () => true,
      read: (source, current) => reads(id, source, current),
    };
  };
  const poller = new ScopedPoller(resolve, () => {});
  return {
    poller,
    reads,
    closed,
    select: (id: string) => {
      selected = id;
    },
    replace: (id: string) => {
      database = id;
    },
    state: (key: PollKey) => poller.snapshot().sources.find((source) => source.key === key),
  };
}

it("captures the target before deferred reads and deduplicates shared app/database sources", async () => {
  const { poller, reads, select, state } = setup();
  try {
    const a = poller.poll("history");
    const config = poller.poll("config");
    const tables = poller.poll("configurations");
    select("b");
    const b = poller.poll("history");
    await Promise.all([a, b, config, tables, poller.poll("config"), poller.poll("configurations")]);
    expect(reads.mock.calls.map(([id, key]) => [id, key])).toEqual([
      ["a", "history"],
      ["config", "config"],
      ["1", "configurations"],
      ["b", "history"],
    ]);
    expect(state("history")?.scope).toEqual({ kind: "target", id: "b" });
    expect(state("configurations")?.scope).toEqual({ kind: "database", id: "1" });
    select("a");
    expect(state("history")?.history).toHaveLength(1);
  } finally {
    poller.stop();
  }
});

it("does not serialize independent targets behind an old flight or revive a closed scope", async () => {
  const { poller, reads, select, closed, state } = setup();
  let release = () => {};
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const published: string[] = [];
  reads.mockImplementation(async (id, _key, current) => {
    if (id === "a") await blocked;
    if (current()) published.push(id);
  });
  try {
    const a = poller.poll("worktrees");
    await Promise.resolve();
    select("b");
    await poller.poll("worktrees");
    expect(published).toEqual(["b"]);
    closed.add("a");
    poller.context(true);
    select("reopened-a");
    await poller.poll("worktrees");
    release();
    await a;
    expect(published).toEqual(["b", "reopened-a"]);
    expect(state("worktrees")?.history).toHaveLength(1);
    select("a");
    await expect(poller.poll("history")).rejects.toThrow("no longer open");
    select("b");
  } finally {
    release();
    poller.stop();
  }
});

it("discards replaced database results without disturbing the app source", async () => {
  const { poller, reads, replace, state } = setup();
  let release = () => {};
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const published: string[] = [];
  reads.mockImplementation(async (id, _key, current) => {
    if (id === "1") await blocked;
    if (current()) published.push(id);
  });
  try {
    const old = poller.poll("configurations");
    await Promise.resolve();
    await poller.poll("config");
    replace("2");
    await poller.poll("configurations");
    release();
    await old;
    expect(published).toEqual(["config", "2"]);
    expect(state("config")?.history).toHaveLength(1);
    expect(state("configurations")?.scope).toEqual({ kind: "database", id: "2" });
  } finally {
    release();
    poller.stop();
  }
});

it("scans only the visible target, retains scoped failures and applies global pause/settings", async () => {
  vi.useFakeTimers();
  const { poller, reads, select, state } = setup();
  try {
    poller.context(true, { visible: true, worktrees: false, files: true });
    await vi.advanceTimersByTimeAsync(5000);
    expect(reads.mock.calls.filter(([id, key]) => id === "a" && key === "files")).toHaveLength(1);
    select("b");
    poller.context(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(reads.mock.calls.filter(([id, key]) => id === "a" && key === "files")).toHaveLength(1);
    expect(reads.mock.calls.filter(([id, key]) => id === "b" && key === "files")).toHaveLength(1);
    expect(reads.mock.calls.some(([, key]) => key === "worktrees")).toBe(false);
    reads.mockRejectedValueOnce(new Error("unavailable"));
    await expect(poller.poll("history")).rejects.toThrow("unavailable");
    expect(state("history")?.failures).toBe(1);
    select("a");
    expect(state("history")?.failures).toBe(0);
    poller.configure({ history: { intervalMs: 6000, idleIntervalMs: 30000 } });
    poller.pause(true);
    expect(state("history")).toMatchObject({ status: "paused", setting: { intervalMs: 6000 } });
    const before = reads.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60000);
    expect(reads).toHaveBeenCalledTimes(before);
    await poller.poll("history");
    poller.pause(false);
    select("b");
    expect(state("history")).toMatchObject({ failures: 1, setting: { intervalMs: 6000 } });
  } finally {
    poller.stop();
  }
});

it("keeps shutdown snapshots readable without restarting timers or accepting new reads", async () => {
  const { poller, state } = setup();
  poller.stop();
  poller.stop();
  poller.context(true, { visible: true, worktrees: true, files: true });
  poller.invalidate(pollKeys);
  expect(state("history")?.nextAt).toBe(null);
  await expect(poller.poll("history")).rejects.toThrow("stopped");
});

it("bounds retained scopes and reclaims only closed scopes", async () => {
  const { poller, select, closed } = setup();
  try {
    for (let index = 0; index < 512; index++) {
      select(`scope-${index}`);
      await poller.poll("history");
    }
    select("overflow");
    await expect(poller.poll("history")).rejects.toThrow("Too many polling scopes");
    closed.add("scope-0");
    await poller.poll("history");
    select("another");
    await expect(poller.poll("history")).rejects.toThrow("Too many polling scopes");
  } finally {
    poller.stop();
  }
});
