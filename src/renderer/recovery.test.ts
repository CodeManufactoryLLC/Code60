import { describe, expect, it } from "vitest";
import type { DesktopRun } from "../bridge/index.js";
import type { RunRecord } from "../core/index.js";
import { canRecoverRun, continueBlocker } from "./recovery.js";

const run = (patch: Partial<RunRecord> = {}, agentAlive = false): DesktopRun =>
  ({
    record: {
      id: "run-1",
      agent: "claude",
      status: "finished",
      firstPrompt: "",
      turns: 1,
      base: "abc",
      branch: "code60/run-1",
      worktree: "/w",
      ownerPid: 1,
      startedAt: "2026-01-01T00:00:00.000Z",
      ...patch,
    },
    agentAlive,
  }) as DesktopRun;

describe("recoverable run statuses", () => {
  it.each(["finished", "failed", "cancelled", "timed_out", "interrupted"] as const)(
    "allows recovery for %s runs",
    (status) => {
      expect(canRecoverRun(status)).toBe(true);
      expect(continueBlocker(run({ status }))).toBeUndefined();
    },
  );

  it.each(["queued", "running", "waiting", "idle"] as const)(
    "does not offer recovery for %s runs",
    (status) => {
      expect(canRecoverRun(status)).toBe(false);
      expect(continueBlocker(run({ status }))).toBe("This run cannot be resumed");
    },
  );
});

describe("continuing a chat by sending a message", () => {
  it("prefers the live view's status over the record", () => {
    const live = { ...run(), view: { status: "idle" } } as unknown as DesktopRun;
    expect(continueBlocker(live)).toBe("This run cannot be resumed");
  });

  it("is unavailable after the worktree is deleted", () => {
    expect(continueBlocker(run({ discardedAt: "2026-01-02T00:00:00.000Z" }))).toBe(
      "This run's worktree was deleted",
    );
  });

  it("asks to stop a leftover agent first", () => {
    expect(continueBlocker(run({}, true))).toBe("Stop the leftover agent to continue this chat");
  });
});

it("never resumes a legacy run without a baseline", () => {
  expect(continueBlocker(run({ base: null }))).toContain("No baseline");
});
