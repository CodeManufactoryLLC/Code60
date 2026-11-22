import { expect, it } from "vitest";
import { retainWorkflowActivity } from "./workflow-activity.js";

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
