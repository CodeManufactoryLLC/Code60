import { expect, it } from "vitest";
import type { SequencedEvent } from "../bridge/index.js";
import { WorkerEventWindows } from "./worker-event-windows.js";

const event = (revision: number, text = "reply"): SequencedEvent => ({
  revision,
  event: { type: "message", runId: "worker", at: "", text },
});
it("keeps each target's bounded window independent of another target's traffic", () => {
  const windows = new WorkerEventWindows();
  windows.append("a", event(1, "A's original reply"));
  for (let i = 2; i <= 514; i++) windows.append("b", event(i));
  expect(windows.read("a")).toEqual([event(1, "A's original reply")]);
  expect(windows.read("b")).toHaveLength(512);
  expect(windows.read()).toHaveLength(512);
  expect(windows.incomplete("a")).toBe(false);
  expect(windows.incomplete("b")).toBe(true);
});
it("enforces the exact serialized character limit, labels overflow and resets generations", () => {
  const windows = new WorkerEventWindows();
  const overhead = JSON.stringify(event(1, "")).length;
  const exact = event(1, "x".repeat(256_000 - overhead));
  windows.append("a", exact);
  expect(JSON.stringify(windows.read("a")[0]).length).toBe(256_000);
  expect(windows.incomplete("a")).toBe(false);
  windows.append("a", event(2));
  expect(windows.read("a")).toEqual([event(2)]);
  expect(windows.incomplete("a")).toBe(true);
  windows.append("b", event(3, "😀".repeat(256_000)));
  expect(windows.read("b")).toEqual([]);
  expect(windows.incomplete("b")).toBe(true);
  windows.clear();
  expect(windows.read()).toEqual([]);
  expect(windows.read("a")).toEqual([]);
  expect(windows.incomplete("a")).toBe(false);
});
it("bounds the target registry without disturbing existing target evidence", () => {
  const windows = new WorkerEventWindows();
  for (let i = 0; i < 256; i++) windows.append(String(i), event(i));
  expect(() => windows.append("overflow", event(257))).toThrow("capacity");
  expect(windows.read("0")).toEqual([event(0)]);
  windows.append("0", event(258));
  expect(windows.read("0")).toHaveLength(2);
});
