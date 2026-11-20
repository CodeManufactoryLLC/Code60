import { expect, it } from "vitest";
import type { SchedulerStatus, ServiceStatus } from "../bridge/index.js";
import { schedulingServiceState } from "./scheduling-service.js";

const live = { pausedAll: false } as ServiceStatus;
it.each([
  [false, "stopped", null, "not-installed"],
  [true, "stopped", null, "stopped"],
  [true, "running", live, "running"],
  [true, "running", { ...live, pausedAll: true }, "running"],
  [false, "stopped", live, "running"],
  [false, "unavailable", live, "running"],
  [true, "unavailable", null, "unavailable"],
  [false, "unavailable", null, "unavailable"],
  [true, "running", null, "unavailable"],
  [true, "stopped", live, "unavailable"],
] as const)(
  "distinguishes registration=%s, native=%s and live health",
  (installed, nativeState, service, expected) => {
    expect(
      schedulingServiceState({ installed, nativeState, service } as SchedulerStatus, false),
    ).toBe(expected);
  },
);
it("does not guess installation while loading or after a failed read", () => {
  expect(schedulingServiceState(undefined, false)).toBe("checking");
  expect(schedulingServiceState(undefined, true)).toBe("unavailable");
});
