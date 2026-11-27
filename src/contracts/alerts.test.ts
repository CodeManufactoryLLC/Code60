import { describe, expect, it } from "vitest";
import {
  ALERT_SCHEMA_VERSION,
  alertRecordSchema,
  alertRequestSchema,
  alertStateFileSchema,
  alertTargetSchema,
} from "./alerts.js";

const validId = "550e8400-e29b-41d4-a716-446655440000";

describe("alert contracts", () => {
  it("accepts valid alert requests and rejects unknown fields or invalid IDs", () => {
    expect(alertRequestSchema.safeParse({ action: "list" }, { jitless: true }).success).toBe(true);
    expect(
      alertRequestSchema.safeParse({ action: "mark-read", id: validId }, { jitless: true }).success,
    ).toBe(true);
    expect(
      alertRequestSchema.safeParse({ action: "mark-unread", id: validId }, { jitless: true })
        .success,
    ).toBe(true);
    expect(
      alertRequestSchema.safeParse({ action: "mark-all-read" }, { jitless: true }).success,
    ).toBe(true);
    expect(
      alertRequestSchema.safeParse({ action: "dismiss", id: validId }, { jitless: true }).success,
    ).toBe(true);
    expect(alertRequestSchema.safeParse({ action: "clear-read" }, { jitless: true }).success).toBe(
      true,
    );

    expect(
      alertRequestSchema.safeParse({ action: "list", extra: true }, { jitless: true }).success,
    ).toBe(false);
    expect(
      alertRequestSchema.safeParse({ action: "mark-read", id: "not-a-uuid" }, { jitless: true })
        .success,
    ).toBe(false);
    expect(alertRequestSchema.safeParse({ action: "delete-all" }, { jitless: true }).success).toBe(
      false,
    );
  });

  it("restricts navigation targets to known internal destinations", () => {
    expect(
      alertTargetSchema.safeParse({ kind: "page", id: "automations" }, { jitless: true }).success,
    ).toBe(true);
    expect(
      alertTargetSchema.safeParse({ kind: "settings", id: "updates" }, { jitless: true }).success,
    ).toBe(true);
    expect(
      alertTargetSchema.safeParse({ kind: "conversation", id: "chat-123" }, { jitless: true })
        .success,
    ).toBe(true);
    expect(
      alertTargetSchema.safeParse({ kind: "workflow", id: validId }, { jitless: true }).success,
    ).toBe(true);
    expect(alertTargetSchema.safeParse({ kind: "relay" }, { jitless: true }).success).toBe(true);

    expect(
      alertTargetSchema.safeParse({ kind: "page", id: "nonexistent" }, { jitless: true }).success,
    ).toBe(false);
    expect(
      alertTargetSchema.safeParse({ kind: "url", href: "https://example.com" }, { jitless: true })
        .success,
    ).toBe(false);
    expect(
      alertTargetSchema.safeParse({ kind: "conversation", id: "bad\nid" }, { jitless: true })
        .success,
    ).toBe(false);
  });

  it("validates alert records and persisted state files strictly", () => {
    const record = {
      id: validId,
      dedupeKey: "live:approval:run-1:perm#1",
      source: "approval",
      severity: "warning",
      title: "Approval needed: Relay",
      detail: "Tool permission request",
      target: { kind: "conversation", id: "run-1" },
      read: false,
      createdAt: "2026-11-27T10:00:00.000Z",
      updatedAt: "2026-11-27T10:00:00.000Z",
    };
    expect(alertRecordSchema.safeParse(record, { jitless: true }).success).toBe(true);
    expect(
      alertStateFileSchema.safeParse(
        {
          format: ALERT_SCHEMA_VERSION,
          seededSchedulerHistory: true,
          dismissedKeys: ["event:automation-exec:123"],
          alerts: [record],
        },
        { jitless: true },
      ).success,
    ).toBe(true);
    expect(
      alertRecordSchema.safeParse({ ...record, source: "Bad Source!" }, { jitless: true }).success,
    ).toBe(false);
  });
});
