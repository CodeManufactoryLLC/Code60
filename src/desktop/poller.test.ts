import { describe, expect, it, vi } from "vitest";
import type { PollKey } from "../bridge/index.js";
import { type PollClock, Poller } from "./poller.js";

function fakeClock() {
  let now = 0;
  let id = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const clock: PollClock = {
    now: () => now,
    setTimeout: (run, delay) => {
      timers.set(++id, { at: now + delay, run });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: (timer) => {
      timers.delete(timer as unknown as number);
    },
  };
  return {
    clock,
    timers,
    async advance(ms: number) {
      now += ms;
      for (const [key, timer] of [...timers]) {
        if (timer.at > now) continue;
        timers.delete(key);
        timer.run();
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

function setup(available: (key: PollKey) => boolean = () => true) {
  const time = fakeClock();
  const read = vi.fn(async (_key: PollKey, _current: () => boolean) => {});
  const poller = new Poller(read, available, () => {}, time.clock);
  const state = (key: PollKey) => {
    const source = poller.snapshot().sources.find((item) => item.key === key);
    if (!source) throw new Error("missing source");
    return source;
  };
  const reads = (key: PollKey) => read.mock.calls.filter(([k]) => k === key).length;
  return { time, read, poller, state, reads };
}

describe("poller", () => {
  it("redacts secrets before storing and clipping failed poll diagnostics", async () => {
    const { read, poller, state } = setup();
    const secret = "sensitive-value-".repeat(100);
    read.mockRejectedValueOnce(new Error(`access_token=${secret}`));
    try {
      await expect(poller.poll("history")).rejects.toThrow();
      expect(state("history").lastError).toBe("access_token=[REDACTED]");
      expect(JSON.stringify(poller.snapshot())).not.toContain("sensitive-value");
    } finally {
      poller.stop();
    }
  });

  it("schedules active and idle intervals only while visible", async () => {
    const { time, poller, state, reads } = setup();
    poller.context(false);
    expect(state("history").status).toBe("hidden");
    expect(time.timers.size).toBe(0);
    poller.context(true, { visible: true, worktrees: false });
    expect(state("history").effectiveIntervalMs).toBe(5000);
    expect(state("worktrees").status).toBe("hidden");
    expect(state("configurations").status).toBe("disabled");
    await time.advance(5000);
    expect(reads("history")).toBe(1);
    expect(state("history")).toMatchObject({ status: "healthy", failures: 0 });
    poller.context(false);
    expect(state("history").effectiveIntervalMs).toBe(30000);
    expect(state("config").status).toBe("idle");
    await time.advance(5000);
    expect(reads("history")).toBe(1);
    await time.advance(25000);
    expect(reads("history")).toBe(2);
    expect(reads("config")).toBe(0);
  });

  it("refreshes files only while Files or its inspector is visible, and honors pause", async () => {
    const { time, poller, reads } = setup();
    poller.context(false, { visible: true, worktrees: false, files: true });
    await time.advance(5000);
    expect(reads("files")).toBe(1);
    poller.pause(true);
    await time.advance(5000);
    expect(reads("files")).toBe(1);
    await poller.poll("files");
    expect(reads("files")).toBe(2);
    poller.pause(false);
    poller.context(false, { visible: true, worktrees: false, files: false });
    await time.advance(5000);
    expect(reads("files")).toBe(2);
    poller.stop();
  });

  it("shares one flight between overlapping requests", async () => {
    const { read, poller, reads } = setup();
    let release!: () => void;
    read.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)));
    const first = poller.poll("history");
    const second = poller.poll("history");
    await Promise.resolve();
    release();
    await Promise.all([first, second]);
    expect(reads("history")).toBe(1);
  });

  it("reruns once when a change arrives during a flight", async () => {
    const { read, poller, reads } = setup();
    let release!: () => void;
    read.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)));
    const first = poller.poll("history");
    void poller.poll("history", "change");
    void poller.poll("history", "change");
    await Promise.resolve();
    release();
    await first;
    await vi.waitFor(() => expect(reads("history")).toBe(2));
  });

  it("backs off after failures without polling faster than configured, and keeps 50 results", async () => {
    const { read, poller, state } = setup();
    read.mockRejectedValue(new Error("disk unavailable"));
    poller.context(true, { visible: true, worktrees: false });
    await expect(poller.poll("history")).rejects.toThrow("disk unavailable");
    expect(state("history")).toMatchObject({
      status: "failed",
      failures: 1,
      lastError: "disk unavailable",
      effectiveIntervalMs: 10000,
    });
    for (let i = 0; i < 5; i++) await poller.poll("history").catch(() => {});
    expect(state("history").effectiveIntervalMs).toBe(60000);
    poller.configure({ history: { intervalMs: 300000, idleIntervalMs: 300000 } });
    expect(state("history").effectiveIntervalMs).toBe(300000);
    for (let i = 0; i < 60; i++) await poller.poll("history").catch(() => {});
    const history = state("history").history;
    expect(history).toHaveLength(50);
    expect(new Set(history.map((result) => result.id)).size).toBe(50);
    read.mockResolvedValue(undefined);
    await poller.poll("history");
    expect(state("history")).toMatchObject({ failures: 0, lastError: null, status: "healthy" });
  });

  it("pauses automatic polling but still allows manual polls", async () => {
    const { time, poller, state, reads } = setup();
    poller.context(true, { visible: true, worktrees: false });
    poller.pause(true);
    expect(state("history").status).toBe("paused");
    await time.advance(60000);
    expect(reads("history")).toBe(0);
    await poller.poll("history");
    expect(reads("history")).toBe(1);
    poller.pause(false);
    await time.advance(5000);
    expect(reads("history")).toBe(2);
  });

  it("scans worktrees when their tab becomes visible and stops when hidden", async () => {
    const { time, poller, reads } = setup();
    poller.context(false, { visible: true, worktrees: true });
    await vi.waitFor(() => expect(reads("worktrees")).toBe(1));
    await time.advance(30000);
    expect(reads("worktrees")).toBe(2);
    poller.context(false, { visible: true, worktrees: false });
    await time.advance(60000);
    expect(reads("worktrees")).toBe(2);
    poller.context(false, { visible: true, worktrees: true });
    await vi.waitFor(() => expect(reads("worktrees")).toBe(3));
  });

  it("ignores stale results after invalidation and retries for the new generation", async () => {
    const { read, poller, state, reads } = setup();
    let release!: () => void;
    let stale!: () => boolean;
    read.mockImplementationOnce(async (_key, current) => {
      stale = current;
      await new Promise<void>((resolve) => (release = resolve));
    });
    const first = poller.poll("history");
    await vi.waitFor(() => expect(reads("history")).toBe(1));
    poller.invalidate(["history"]);
    const second = poller.poll("history");
    expect(stale()).toBe(false);
    release();
    await first;
    await second;
    expect(reads("history")).toBe(2);
    expect(state("history").history).toHaveLength(1);
  });

  it("rejects unavailable sources and stops every timer", async () => {
    const { time, poller } = setup((key) => key !== "worktrees");
    await expect(poller.poll("worktrees")).rejects.toThrow(/not available/);
    poller.context(true, { visible: true, worktrees: true });
    expect(time.timers.size).toBeGreaterThan(0);
    poller.stop();
    expect(time.timers.size).toBe(0);
    await expect(poller.poll("history")).rejects.toThrow(/stopped/);
  });
});
