import { z } from "zod";

// Re-exports run before index.ts; preserve the sandbox's no-code-generation contract.
z.config({ jitless: true });

/** Fixed vocabulary only. No provider text, paths, prompts, arguments or exception messages. */
export const LOG_EVENTS = {
  "app.start": ["desktop", "Desktop startup started"],
  "app.ready": ["desktop", "Desktop startup completed"],
  "app.stop": ["desktop", "Desktop shutdown started"],
  "app.stopped": ["desktop", "Desktop shutdown completed"],
  "provider.connect": ["provider", "Provider connection started"],
  "provider.connected": ["provider", "Provider connection completed"],
  "dispatch.accepted": ["coordination", "Run dispatch accepted"],
  "turn.start": ["core", "Agent turn started"],
  "turn.end": ["core", "Agent turn completed"],
  "permission.decided": ["permissions", "Once-only permission decision"],
  "cancel.requested": ["core", "Turn cancellation requested"],
  "cancel.escalated": ["process", "Cancellation escalated to process stop"],
  "cancel.escalation_failed": ["process", "Escalated process stop failed"],
  "process.stopped": ["process", "Owned process cleanup completed"],
  "recovery.start": ["recovery", "Explicit recovery started"],
  "recovery.end": ["recovery", "Explicit recovery completed"],
  "worktree.create": ["worktree", "Worktree creation completed"],
  "worktree.remove": ["worktree", "Worktree removal completed"],
  "database.connect": ["database", "Database connection completed"],
  "persistence.failed": ["persistence", "Lifecycle persistence failed"],
} as const;
const logEventSchema = z.enum(
  Object.keys(LOG_EVENTS) as [keyof typeof LOG_EVENTS, ...(keyof typeof LOG_EVENTS)[]],
);
const logSeveritySchema = z.enum(["debug", "info", "warning", "error"]);
const logComponentSchema = z.enum([
  "desktop",
  "provider",
  "coordination",
  "core",
  "permissions",
  "process",
  "recovery",
  "worktree",
  "database",
  "persistence",
]);
const logOutcomeSchema = z.enum([
  "started",
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
  "allowed",
  "denied",
  "interrupted",
]);
const identifier = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const uuid = z.uuid();
export const logInputSchema = z.strictObject({
  event: logEventSchema,
  operationId: uuid,
  severity: logSeveritySchema.optional(),
  runId: identifier.optional(),
  provider: z
    .enum(["antigravity", "claude", "codex", "copilot", "droid", "kiro", "opencode"])
    .optional(),
  projectId: z
    .string()
    .regex(/^[a-f0-9]{16}$/)
    .optional(),
  outcome: logOutcomeSchema,
  durationMs: z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  errorCategory: z
    .enum(["storage", "permission", "transport", "process", "timeout", "unknown"])
    .optional(),
  errorCode: z
    .enum(["EACCES", "EPERM", "ENOSPC", "EIO", "ENOENT", "EBUSY", "ETIMEDOUT", "UNKNOWN"])
    .optional(),
  persistenceStage: z
    .enum(["queue", "open", "validate", "write", "sync", "close", "mark-incomplete"])
    .optional(),
  persistenceFailure: z.enum(["io", "identity", "invalid-frame", "capacity", "unknown"]).optional(),
  queuedCharacters: z.number().int().min(0).max(1_048_576).optional(),
  queuedRecords: z.number().int().min(0).max(1024).optional(),
  changedIdentityFields: z
    .array(z.enum(["dev", "ino", "size", "mtimeNs", "ctimeNs"]))
    .max(5)
    .optional(),
});
export type LogInput = z.infer<typeof logInputSchema>;
export type LogSink = (input: LogInput) => void;
/** Even an injected faulty observer must never alter lifecycle outcomes. */
export function emitLog(sink: LogSink | undefined, input: LogInput): void {
  try {
    sink?.(input);
  } catch {
    /* Diagnostic observers are best effort. */
  }
}
export const logRecordSchema = logInputSchema
  .extend({
    version: z.literal(1),
    id: uuid,
    timestamp: z.iso.datetime(),
    severity: logSeveritySchema,
    component: logComponentSchema,
    message: z.string().max(100),
    appLaunchId: uuid,
  })
  .refine((record) => {
    const [component, message] = LOG_EVENTS[record.event];
    return record.component === component && record.message === message;
  });
export type LogRecord = z.infer<typeof logRecordSchema>;
const logFieldSchema = z.enum([
  "timestamp",
  "severity",
  "component",
  "event",
  "runId",
  "provider",
  "outcome",
  "durationMs",
  "message",
  "appLaunchId",
  "projectId",
]);
const condition = z.strictObject({
  column: logFieldSchema,
  op: z.enum(["contains", "eq", "ne", "ge", "le", "empty", "present", "recent", "older"]),
  value: z.string().max(200),
});
export const logQuerySchema = z.strictObject({
  scope: z.enum(["all", "current"]).default("all"),
  limit: z.number().int().min(1).max(200).default(100),
  cursor: uuid.optional(),
  search: z.string().max(200).default(""),
  projectId: z
    .string()
    .regex(/^[a-f0-9]{16}$/)
    .optional(),
  appLaunchId: uuid.optional(),
  conditions: z.array(condition).max(24).default([]),
  match: z.enum(["all", "any"]).default("all"),
  columnConditions: z.array(condition).max(24).default([]),
});
export type LogQuery = z.infer<typeof logQuerySchema>;
export const logDetailSchema = z.strictObject({ id: uuid });
export const logClearSchema = z.strictObject({ confirm: z.literal(true) });
export interface LogStatus {
  dropped: number;
  persistenceFailures: number;
  unavailable: boolean;
  malformed: number;
}
export interface LogPage {
  records: LogRecord[];
  cursor: string | null;
  state: "ready" | "expired-cursor";
  status: LogStatus;
  appLaunchId: string;
}
