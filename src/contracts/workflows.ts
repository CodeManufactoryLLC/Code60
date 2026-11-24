import { z } from "zod";

z.config({ jitless: true });
export const LEGACY_TRANSMISSION_VERSION = "0.1.0-staging.18";
export const TRANSMISSION_VERSION = "0.1.0-staging.20";
const LINUX_TRANSMISSION_VERSION = "0.1.1";
export const workflowEngineVersion = z.enum([
  LEGACY_TRANSMISSION_VERSION,
  TRANSMISSION_VERSION,
  LINUX_TRANSMISSION_VERSION,
]);
export function defaultWorkflowEngine(os: string) {
  return os === "linux" ? LINUX_TRANSMISSION_VERSION : TRANSMISSION_VERSION;
}
export function supportsWorkflowPause(version?: string) {
  return version === TRANSMISSION_VERSION || version === LINUX_TRANSMISSION_VERSION;
}
const text = z.string().trim().min(1).max(65_536);
const id = z.uuid();
const workflowTaskSchema = z.strictObject({
  name: z.string().trim().min(1).max(160),
  instructions: text,
  verify: text,
  checks: z.array(z.string().trim().min(1).max(2_000)).max(30),
});
const workflowFieldsSchema = z.strictObject({
  name: z.string().trim().min(1).max(160),
  tasks: z.array(workflowTaskSchema).min(1).max(100),
});
export const workflowDraftSchema = workflowFieldsSchema.extend({
  repositoryToken: id,
  repairs: z.number().int().min(0).max(30),
  retries: z.number().int().min(0).max(30),
  autoApprove: z.boolean(),
});
export const workflowDraftReplySchema = z.strictObject({
  message: z.string().trim().min(1).max(16_000),
  draft: workflowFieldsSchema.optional(),
});
export const workflowVerdictSchema = z.object({
  decision: z.enum(["accept", "reject"]),
  reason: z.string().max(65_536),
  checks: z
    .array(z.object({ command: text, passed: z.boolean(), evidence: text }))
    .max(30)
    .optional(),
});
export const workflowSnapshotSchema = z.object({
  runId: id,
  status: z.enum([
    "running",
    "pausing",
    "paused",
    "needs_input",
    "completed",
    "failed",
    "cancelled",
  ]),
  tasks: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        name: text,
        state: z.enum([
          "pending",
          "pausing",
          "paused",
          "implementing",
          "verifying",
          "repairing",
          "needs_input",
          "accepted",
          "failed",
          "cancelled",
        ]),
      }),
    )
    .min(1)
    .max(100),
  activeTaskIndex: z.number().int().nonnegative().nullable(),
  eventCursor: z.number().int().nonnegative(),
  phase: z.enum(["worker", "verifier"]).optional(),
  task: text.optional(),
  reason: z.string().max(65_536).optional(),
  decision: z
    .object({
      id,
      text,
      options: z
        .array(z.object({ id: text, name: text }))
        .max(32)
        .optional(),
    })
    .optional(),
  attempts: z.array(z.string().max(65_536)).max(2_000),
  accepted: z
    .array(
      z.object({
        name: text,
        result: text,
        revision: text,
        worker: text,
        verifier: text,
        verdict: workflowVerdictSchema,
      }),
    )
    .max(100),
  result: text.optional(),
  verdict: z
    .object({ decision: z.enum(["accept", "reject"]), reason: z.string().max(65_536) })
    .optional(),
});
export const workflowEventsSchema = z.object({
  events: z
    .array(
      z.object({
        sequence: z.number().int().positive(),
        time: z.string().max(100),
        kind: z.string().max(100),
        detail: z.record(z.string().max(100), z.unknown()),
      }),
    )
    .max(100),
});
export const workflowDiffSchema = z.object({
  content: z
    .string()
    .max(100_000)
    .regex(/^[A-Za-z0-9+/=]*$/),
  nextOffset: z.number().int().nonnegative().nullable(),
  revision: text.optional(),
});
const form = { formId: id, revision: z.number().int().nonnegative() };
export const workflowRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("list") }),
  z.strictObject({ action: z.literal("pickRepository"), formId: id }),
  z.strictObject({ action: z.literal("review"), ...form, draft: workflowDraftSchema }),
  z.strictObject({ action: z.literal("start"), ...form, approvalId: id }),
  z.strictObject({ action: z.literal("read"), id }),
  z.strictObject({ action: z.literal("events"), id, after: z.number().int().nonnegative() }),
  z.strictObject({ action: z.literal("diff"), id, offset: z.number().int().nonnegative() }),
  z.strictObject({ action: z.literal("answer"), id, questionId: z.uuid(), answer: text }),
  z.strictObject({ action: z.literal("message"), id, message: text }),
  z.strictObject({ action: z.literal("pause"), id }),
  z.strictObject({ action: z.literal("resume"), id }),
  z.strictObject({ action: z.literal("cancel"), id }),
  z.strictObject({ action: z.literal("recover"), id }),
  z.strictObject({ action: z.literal("reconnect"), id }),
  z.strictObject({ action: z.literal("invalidate"), ...form }),
  z.strictObject({ action: z.literal("disposeForm"), formId: id }),
  z.strictObject({
    action: z.literal("draft"),
    ...form,
    requestId: id,
    repositoryToken: id.optional(),
    fields: z.strictObject({
      name: z.string().max(160),
      tasks: z
        .array(
          z.strictObject({
            name: z.string().max(65_536),
            instructions: z.string().max(65_536),
            verify: z.string().max(65_536),
            checks: z.array(z.string().max(65_536)).max(30).optional(),
          }),
        )
        .max(100),
    }),
    messages: z
      .array(
        z.strictObject({
          role: z.enum(["user", "assistant"]),
          text: z.string().min(1).max(16_000),
        }),
      )
      .min(1)
      .max(20),
  }),
  z.strictObject({ action: z.literal("cancelDraft"), formId: id, requestId: id.optional() }),
]);
export type WorkflowRequest = z.infer<typeof workflowRequestSchema>;
export type WorkflowDraft = z.infer<typeof workflowDraftSchema>;
export type WorkflowDraftReply = z.infer<typeof workflowDraftReplySchema>;
export type WorkflowSnapshot = z.infer<typeof workflowSnapshotSchema>;
export type WorkflowEvent = z.infer<typeof workflowEventsSchema>["events"][number];
export interface WorkflowRepository {
  token: string;
  label: string;
}
export interface WorkflowRecord {
  stopPending?: boolean;
  engineVersion?: z.infer<typeof workflowEngineVersion>;
  id: string;
  name: string;
  repository: string;
  worktree: string;
  branch: string;
  baseline: string;
  repositoryIdentity: string;
  repositoryGitIdentity: string;
  worktreeIdentity: string;
  definition: Omit<WorkflowDraft, "repositoryToken">;
  key: string;
  createdAt: string;
  snapshot?: WorkflowSnapshot;
  updatedAt?: string;
  state: "preparing" | "preparation_failed" | "starting" | "submitted" | "uncertain";
}
export interface WorkflowList {
  supported: boolean;
  version: string;
  entries: WorkflowRecord[];
}
export interface WorkflowReview {
  approvalId: string;
  repository: string;
  draft: WorkflowDraft;
}
export interface WorkflowRead {
  record: WorkflowRecord;
  connected: boolean;
  error?: string;
}
