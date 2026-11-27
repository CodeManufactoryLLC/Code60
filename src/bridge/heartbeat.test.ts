import { describe, expect, it } from "vitest";
import { DEFAULT_HEARTBEAT_POLICY, parseHeartbeatRequest } from "./heartbeat.js";

describe("heartbeat bridge validation", () => {
  it("accepts valid snapshot, run, cancel, and updatePolicy requests", () => {
    expect(parseHeartbeatRequest({ action: "snapshot" })).toEqual({ action: "snapshot" });
    expect(parseHeartbeatRequest({ action: "run" })).toEqual({
      action: "run",
      mode: "maintain",
    });
    expect(parseHeartbeatRequest({ action: "run", mode: "inspect" })).toEqual({
      action: "run",
      mode: "inspect",
    });
    expect(parseHeartbeatRequest({ action: "cancel" })).toEqual({ action: "cancel" });
    expect(
      parseHeartbeatRequest({
        action: "updatePolicy",
        policy: { ...DEFAULT_HEARTBEAT_POLICY, intervalMinutes: 5, cleanWorktreeMinAgeHours: 48 },
      }),
    ).toEqual({
      action: "updatePolicy",
      policy: { ...DEFAULT_HEARTBEAT_POLICY, intervalMinutes: 5, cleanWorktreeMinAgeHours: 48 },
    });
  });

  it("rejects unknown fields, invalid intervals, and out-of-range age thresholds", () => {
    expect(() => parseHeartbeatRequest({ action: "snapshot", extra: true })).toThrow();
    expect(() => parseHeartbeatRequest({ action: "run", mode: "force" })).toThrow();
    expect(() =>
      parseHeartbeatRequest({
        action: "updatePolicy",
        policy: { ...DEFAULT_HEARTBEAT_POLICY, intervalMinutes: 7 },
      }),
    ).toThrow();
    expect(() =>
      parseHeartbeatRequest({
        action: "updatePolicy",
        policy: { ...DEFAULT_HEARTBEAT_POLICY, cleanWorktreeMinAgeHours: 0 },
      }),
    ).toThrow();
  });
});
