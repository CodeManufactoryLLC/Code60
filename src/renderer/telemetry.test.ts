import { describe, expect, it } from "vitest";
import type { RunEvent, RunEventBody } from "../core/index.js";
import {
  describeBuckets,
  describeHistory,
  describeTurns,
  eventTotal,
  latestTurn,
  telemetry,
} from "./telemetry.js";

const now = Date.parse("2026-11-04T12:10:00Z");
const at = (secondsAgo: number) => new Date(now - secondsAgo * 1000).toISOString();
const event = (secondsAgo: number, body: RunEventBody): RunEvent =>
  ({ runId: "r", at: at(secondsAgo), ...body }) as RunEvent;
const status = (secondsAgo: number, value: Extract<RunEvent, { type: "status" }>["status"]) =>
  event(secondsAgo, { type: "status", status: value });

describe("telemetry", () => {
  it("reports Unavailable without samples instead of zero", () => {
    const data = telemetry([], now);
    expect(data).toEqual({ turns: null, buckets: null, history: null });
    expect(latestTurn(data)).toBe("Unavailable");
    expect(eventTotal(data)).toBe("Unavailable");
    expect(describeHistory(data)).toBe("Unavailable");
  });

  it("measures completed turns from prompt to the end of the turn, keeping the last six", () => {
    const events: RunEvent[] = [];
    for (let turn = 0; turn < 8; turn++) {
      const start = 1000 - turn * 100;
      events.push(event(start, { type: "prompt", turn, text: "go" }), status(start, "running"));
      events.push(status(start - turn - 1, "idle"));
    }
    events.push(event(10, { type: "prompt", turn: 9, text: "still going" }), status(10, "running"));
    const data = telemetry(events, now);
    expect(data.turns).toEqual([3, 4, 5, 6, 7, 8]);
    expect(latestTurn(data)).toBe("8 s");
    expect(describeTurns(data)).toBe("Last 6 completed turns in seconds: 3, 4, 5, 6, 7, 8");
  });

  it("counts non-status events in ten 30-second buckets over five minutes", () => {
    const data = telemetry(
      [
        event(400, { type: "message", text: "old" }),
        event(299, { type: "message", text: "a" }),
        event(15, { type: "message", text: "b" }),
        event(5, { type: "thought", text: "c" }),
        event(5, { type: "acp", update: "plan", payload: "{}", size: 2 }),
        event(5, { type: "turnEnd", turn: 1, stopReason: "end_turn" }),
        status(5, "running"),
      ],
      now,
    );
    expect(data.buckets).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 2]);
    expect(eventTotal(data)).toBe("3");
    expect(describeBuckets(data)).toBe(
      "Events in ten 30-second buckets, oldest first: 1, 0, 0, 0, 0, 0, 0, 0, 0, 2",
    );
  });

  it("records state spans in the last two minutes", () => {
    const data = telemetry(
      [status(300, "running"), status(45, "waiting"), status(30, "waiting"), status(10, "running")],
      now,
    );
    expect(data.history).toEqual([
      { status: "running", start: 0, seconds: 75 },
      { status: "waiting", start: 75, seconds: 35 },
      { status: "running", start: 110, seconds: 10 },
    ]);
    expect(describeHistory(data)).toBe("Working 75s, needs approval 35s, working 10s");
  });
});
