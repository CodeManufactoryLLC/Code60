import { z } from "zod";
import { pages, settingsSections } from "./navigation.js";

// Keep code generation disabled when this module is imported directly.
z.config({ jitless: true });

export const ALERT_SCHEMA_VERSION = 1;
export const ALERT_LIMITS = {
  maxItems: 200,
  maxDismissedKeys: 400,
  maxTitle: 160,
  maxDetail: 240,
  maxSource: 64,
  maxDedupeKey: 200,
  maxTargetId: 256,
  maxStateBytes: 512 * 1024,
} as const;

const alertSeveritySchema = z.enum(["info", "warning", "error"]);
export type AlertSeverity = z.infer<typeof alertSeveritySchema>;

const alertSourceSchema = z
  .string({ error: "Invalid alert source" })
  .regex(/^[a-z][a-z0-9-]{0,63}$/, "Invalid alert source");

const opaqueTargetIdSchema = z
  .string({ error: "Invalid alert target" })
  .min(1, "Invalid alert target")
  .max(ALERT_LIMITS.maxTargetId, "Invalid alert target")
  .refine(
    (value) => [...value].every((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127),
    "Invalid alert target",
  );

const pageIds = pages.map((page) => page.id) as [
  (typeof pages)[number]["id"],
  ...(typeof pages)[number]["id"][],
];
const settingsSectionIds = settingsSections.map((section) => section.id) as [
  (typeof settingsSections)[number]["id"],
  ...(typeof settingsSections)[number]["id"][],
];

export const alertTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("page"), id: z.enum(pageIds) }),
  z.strictObject({ kind: z.literal("settings"), id: z.enum(settingsSectionIds) }),
  z.strictObject({ kind: z.literal("conversation"), id: opaqueTargetIdSchema }),
  z.strictObject({ kind: z.literal("custom-agent"), id: opaqueTargetIdSchema }),
  z.strictObject({ kind: z.literal("workflow"), id: z.uuid() }),
  z.strictObject({ kind: z.literal("relay") }),
]);
export type AlertTarget = z.infer<typeof alertTargetSchema>;

const dedupeKeySchema = z
  .string({ error: "Invalid alert key" })
  .min(1, "Invalid alert key")
  .max(ALERT_LIMITS.maxDedupeKey, "Invalid alert key");

export const alertRecordSchema = z.strictObject({
  id: z.uuid(),
  dedupeKey: dedupeKeySchema.optional(),
  source: alertSourceSchema,
  severity: alertSeveritySchema,
  title: z
    .string({ error: "Invalid alert title" })
    .trim()
    .min(1, "Invalid alert title")
    .max(ALERT_LIMITS.maxTitle, "Invalid alert title"),
  detail: z
    .string({ error: "Invalid alert detail" })
    .trim()
    .min(1, "Invalid alert detail")
    .max(ALERT_LIMITS.maxDetail, "Invalid alert detail")
    .optional(),
  target: alertTargetSchema,
  read: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type AlertRecord = z.infer<typeof alertRecordSchema>;

export interface AlertSnapshot {
  revision: number;
  unreadCount: number;
  alerts: AlertRecord[];
}

export const alertRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("list") }),
  z.strictObject({ action: z.literal("mark-read"), id: z.uuid() }),
  z.strictObject({ action: z.literal("mark-unread"), id: z.uuid() }),
  z.strictObject({ action: z.literal("mark-all-read") }),
  z.strictObject({ action: z.literal("dismiss"), id: z.uuid() }),
  z.strictObject({ action: z.literal("clear-read") }),
]);
export type AlertRequest = z.infer<typeof alertRequestSchema>;

export const alertStateFileSchema = z.strictObject({
  format: z.literal(ALERT_SCHEMA_VERSION),
  seededSchedulerHistory: z.boolean().optional(),
  dismissedKeys: z.array(dedupeKeySchema).max(ALERT_LIMITS.maxDismissedKeys),
  alerts: z.array(alertRecordSchema).max(ALERT_LIMITS.maxItems),
});
export type AlertStateFile = z.infer<typeof alertStateFileSchema>;
