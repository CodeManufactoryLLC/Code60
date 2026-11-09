import { z } from "zod";
import { parseValue, runIdSchema } from "../contracts/index.js";

const uuid = z.string().uuid();
const revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const title = z.string().trim().min(1).max(160);
const taskText = z.string().trim().min(1).max(2_000);
export const planDraftSchema = z.strictObject({
  title,
  description: z.string().max(16_000),
  tasks: z
    .array(z.strictObject({ id: uuid.optional(), text: taskText }))
    .min(1)
    .max(100),
});
export const planCreateSchema = planDraftSchema.extend({
  requestId: z.string().min(1).max(128),
});
export const planUpdateSchema = z.discriminatedUnion("operation", [
  z.strictObject({
    operation: z.literal("revise"),
    planId: uuid,
    revision,
    draft: planDraftSchema,
  }),
  z.strictObject({
    operation: z.literal("progress"),
    planId: uuid,
    revision,
    taskId: uuid,
    state: z.enum(["pending", "in_progress", "completed", "blocked"]),
    note: z.string().trim().min(1).max(2_000),
    workerIds: z.array(runIdSchema).max(100).optional(),
  }),
]);
export const planSchema = z.strictObject({
  format: z.literal(1),
  id: uuid,
  chatId: runIdSchema,
  project: z.string().max(4_096).nullable(),
  revision,
  proposalRevision: revision,
  requestId: z.string().max(128),
  creationKey: z.string().max(250_000),
  title,
  description: z.string().max(16_000),
  state: z.enum(["draft", "queued", "running", "paused", "failed", "completed", "dismissed"]),
  acceptedRevision: revision.optional(),
  error: z.string().max(2_000).optional(),
  tasks: z
    .array(
      z.strictObject({
        id: uuid,
        text: taskText,
        state: z.enum(["pending", "in_progress", "completed", "blocked"]),
        note: z.string().max(2_000),
        workerIds: z.array(runIdSchema).max(100),
      }),
    )
    .min(1)
    .max(100),
});
export type Plan = z.infer<typeof planSchema>;
export type PlanCreate = z.infer<typeof planCreateSchema>;
export type PlanUpdate = z.infer<typeof planUpdateSchema>;
export type PlanSummary = Pick<
  Plan,
  "id" | "chatId" | "project" | "revision" | "proposalRevision" | "title" | "state"
> & { completed: number; total: number };
export const planReadSchema = z.strictObject({ chatId: runIdSchema, planId: uuid });
export const planActionSchema = planReadSchema.extend({
  revision,
  type: z.enum(["accept", "dismiss", "resume"]),
});
export type PlanRead = z.infer<typeof planReadSchema>;
export type PlanAction = z.infer<typeof planActionSchema>;
export const parsePlanRead = (value: unknown) => parseValue(planReadSchema, value);
export const parsePlanAction = (value: unknown) => parseValue(planActionSchema, value);
export function planSummary(plan: Plan): PlanSummary {
  const { id, chatId, project, revision, proposalRevision, title, state } = plan;
  return {
    id,
    chatId,
    project,
    revision,
    proposalRevision,
    title,
    state,
    completed: plan.tasks.filter((task) => task.state === "completed").length,
    total: plan.tasks.length,
  };
}
/** The count and progress bar belong to the UI, never this document. */
export function planMarkdown(plan: Plan): string {
  return [
    `# ${plan.title.replace(/\s+/g, " ")}`,
    "",
    plan.description,
    "",
    ...plan.tasks.flatMap((task) => [
      `- [${task.state === "completed" ? "x" : " "}] ${task.text.replace(/\n/g, "\n  ")}`,
      ...(task.note ? [`  ${task.state}: ${task.note.replace(/\n/g, "\n  ")}`] : []),
    ]),
    "",
  ].join("\n");
}
