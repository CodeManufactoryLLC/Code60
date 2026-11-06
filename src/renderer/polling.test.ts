import { describe, expect, it } from "vitest";
import type { PollResult, PollState } from "../bridge/index.js";
import { lastResultText, pollRows, statusText } from "./polling.js";

const result = (id: number, trigger: PollResult["trigger"], ok: boolean): PollResult => ({
  id,
  at: id,
  durationMs: 1,
  trigger,
  ok,
  error: ok ? null : "failed",
});
const source = (key: PollState["key"], history: PollResult[]): PollState => ({
  key,
  setting: { intervalMs: 5000, idleIntervalMs: 30000 },
  status: "healthy",
  effectiveIntervalMs: 30000,
  polledAt: 2,
  succeededAt: 2,
  durationMs: 1,
  nextAt: null,
  failures: 0,
  lastError: null,
  history,
});

describe("polling page", () => {
  it("summarizes the last result with its outcome, trigger, and duration", () => {
    expect(lastResultText(undefined)).toBe("None yet");
    expect(lastResultText({ ...result(1, "manual", true), durationMs: 23 })).toBe(
      "Success, manual, 23 ms",
    );
    expect(lastResultText(result(2, "timer", false))).toBe("Failed, timer, 1 ms");
  });

  it("nests an expanded source's results below it, newest first", () => {
    const sources = [
      source("history", [result(1, "timer", true), result(2, "manual", false)]),
      source("config", [result(3, "timer", true)]),
    ];
    expect(pollRows(sources, new Set()).map((row) => row.id)).toEqual(["history", "config"]);
    const rows = pollRows(sources, new Set(["history"]));
    expect(rows.map((row) => [row.id, row.parent])).toEqual([
      ["history", undefined],
      ["history:2", "history"],
      ["history:1", "history"],
      ["config", undefined],
    ]);
    expect(rows[0]?.lastResult).toBe("Failed, manual, 1 ms");
    expect(rows[1]?.lastResult).toBe("1 ms: failed");
    expect(rows[1]?.status).toBe("failed");
  });

  it("writes source states in sentence case", () => {
    expect(statusText("healthy")).toBe("Healthy");
    expect(statusText("unavailable")).toBe("Unavailable");
  });
});
