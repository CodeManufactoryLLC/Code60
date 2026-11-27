import { describe, expect, it } from "vitest";
import type { AlertSnapshot } from "../bridge/index.js";
import { acceptAlertSnapshot, formatAlertTime } from "./alerts.js";

describe("alerts renderer helpers", () => {
  it("formats recent and older alert timestamps concisely", () => {
    const now = Date.parse("2026-11-27T12:00:00.000Z");
    expect(formatAlertTime("2026-11-27T11:59:40.000Z", now)).toBe("Just now");
    expect(formatAlertTime("2026-11-27T11:45:00.000Z", now)).toBe("15m ago");
    expect(formatAlertTime("2026-11-27T09:00:00.000Z", now)).toBe("3h ago");
    expect(formatAlertTime("2026-11-25T12:00:00.000Z", now)).toBe("2d ago");
    expect(formatAlertTime("invalid-date", now)).toBe("");
  });

  it("ignores stale alert snapshot revisions", () => {
    const first: AlertSnapshot = { revision: 5, unreadCount: 2, alerts: [] };
    const stale: AlertSnapshot = { revision: 4, unreadCount: 0, alerts: [] };
    const newer: AlertSnapshot = { revision: 6, unreadCount: 1, alerts: [] };
    expect(acceptAlertSnapshot(null, first)).toBe(first);
    expect(acceptAlertSnapshot(first, stale)).toBe(first);
    expect(acceptAlertSnapshot(first, newer)).toBe(newer);
  });
});
