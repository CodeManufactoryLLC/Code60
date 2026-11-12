import { z } from "zod";
import { runIdSchema, tacticIdSchema } from "../contracts/index.js";

export {
  findTactic,
  searchTactics,
  TACTIC_SHARED_INSTRUCTIONS,
  TACTICS,
  type Tactic,
  tacticPrompt,
} from "../contracts/index.js";

export const taskContextSchema = z.strictObject({
  id: z.string().uuid(),
  title: z.string().max(100_000),
  turn: z.number().int().nonnegative(),
  project: z.string().max(32_768).nullable(),
  tactic: z
    .strictObject({
      id: tacticIdSchema,
      version: z.number().int().positive(),
      title: z.string().max(120),
      prompt: z.string().min(1).max(32_000),
    })
    .nullable(),
  cleared: z.boolean().optional(),
  deliveries: z.array(z.number().int().positive()).max(10_000).optional(),
  reviewId: z.string().uuid().optional(),
  planIds: z.array(z.string().uuid()).max(100),
  workers: z
    .array(
      z.strictObject({
        runId: runIdSchema,
        turn: z.number().int().nonnegative(),
        label: z.string().max(128).optional(),
        planTaskId: z.string().uuid().optional(),
      }),
    )
    .max(10_000),
});
export type TaskContext = z.infer<typeof taskContextSchema>;

export const savedChatSchema = z.strictObject({
  format: z.literal(1),
  directoryId: z.string().uuid(),
  runId: runIdSchema,
  provider: z.string().min(1).max(128),
  commandHash: z.string().regex(/^[a-f0-9]{64}$/),
  title: z.string().max(120).optional(),
  archived: z.boolean(),
  selectedAt: z.number().nonnegative(),
  tactic: tacticIdSchema.nullable().optional(),
  tasks: z.array(taskContextSchema).max(1_000),
  taskId: z.string().uuid().optional(),
});
export type SavedChat = z.infer<typeof savedChatSchema>;
