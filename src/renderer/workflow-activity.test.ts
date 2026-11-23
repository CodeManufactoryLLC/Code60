import { expect, it } from "vitest";
import {
  advanceWorkflowClock,
  emptyWorkflowClock,
  retainWorkflowActivity,
  workflowTime,
} from "./workflow-activity.js";

const event = (sequence: number, text = "ok") => ({
  sequence,
  time: "2026-11-22",
  kind: "tool",
  detail: { text },
});
it("deduplicates overlapping pages without losing sequence gaps", () => {
  expect(retainWorkflowActivity([event(1), event(5)], [event(5), event(9)])).toEqual({
    events: [event(1), event(5), event(9)],
    trimmed: false,
  });
});
it("bounds large activity windows independently of event count and marks omissions", () => {
  const retained = retainWorkflowActivity(
    [],
    Array.from({ length: 50 }, (_, index) => event(index + 1, "x".repeat(32_768))),
  );
  expect(retained.trimmed).toBe(true);
  expect(JSON.stringify(retained.events).length).toBeLessThan(1_000_100);
  expect(retained.events.at(-1)?.sequence).toBe(50);
  expect(
    retainWorkflowActivity(
      [],
      Array.from({ length: 1001 }, (_, index) => event(index + 1)),
    ).events,
  ).toHaveLength(1000);
});

it("replays active time across pages, scope questions, paused answers and terminal acceptance", () => {
  const entry = (seconds: number, kind: string, detail: Record<string, unknown> = {}) => ({
    sequence: seconds + 2,
    time: new Date(seconds * 1000).toISOString(),
    kind,
    detail,
  });
  let clock = advanceWorkflowClock(
    emptyWorkflowClock,
    [
      entry(0, "started"),
      entry(5, "needs_input"),
      entry(10, "pause_requested"),
      entry(15, "paused"),
    ],
    2,
  );
  clock = advanceWorkflowClock(
    clock,
    [
      entry(20, "resumed"),
      entry(26, "answered"),
      entry(30, "task_accepted"),
      entry(36, "paused"),
      entry(40, "message"),
    ],
    2,
  );
  expect(workflowTime(clock, 42, 100_000)).toBe("0:15");
  clock = advanceWorkflowClock(clock, [entry(41, "resumed"), entry(51, "task_accepted")], 2);
  expect(workflowTime(clock, 53, 200_000)).toBe("0:25");
  expect(workflowTime(clock, 60, 200_000)).toBe("Unavailable");
  expect(
    workflowTime(advanceWorkflowClock(emptyWorkflowClock, [entry(40, "message")], 1), 42, 50_000),
  ).toBe("Unavailable");
});

it("keeps paused answers stopped and does not resurrect withdrawn permission questions", () => {
  const events = [
    "started",
    "needs_input",
    "pause_requested",
    "paused",
    "answered",
    "resumed",
    "attempt_ended",
  ].map((kind, index) => ({
    sequence: index + 1,
    time: new Date(index * 1000).toISOString(),
    kind,
    detail: { options: [], next: "failed" },
  }));
  const clock = advanceWorkflowClock(emptyWorkflowClock, events, 1);
  expect(workflowTime(clock, 7, 90_000)).toBe("0:03");
  expect(workflowTime({ ...emptyWorkflowClock, cursor: 1, since: 0 }, 1, 3665000)).toBe("1:01:05");
});
