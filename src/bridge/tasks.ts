import { z } from "zod";
import { pairedProjectIdentity, projectRequestFields } from "./project-identity.js";

const identity = {
  project: z.string().min(1).max(4096),
  reviewId: z.string().uuid(),
  ...projectRequestFields,
};
const taskActionSchema = z
  .discriminatedUnion("type", [
    z.strictObject({ ...identity, type: z.literal("status") }),
    z.strictObject({ ...identity, type: z.literal("cancel") }),
    z.strictObject({ ...identity, type: z.literal("prepare"), revisionId: z.string().uuid() }),
    z.strictObject({
      ...identity,
      type: z.literal("file"),
      operationId: z.string().uuid(),
      fileId: z.string().uuid(),
    }),
    z.strictObject({
      ...identity,
      type: z.enum(["apply", "undo", "recover", "revise"]),
      operationId: z.string().uuid(),
    }),
  ])
  .refine(pairedProjectIdentity);
export type TaskAction = z.infer<typeof taskActionSchema>;
export interface TaskView {
  available: boolean;
  canPrepare: boolean;
  source: "Current saved files" | "Selected Git revision";
  undoId?: string;
  operation?: {
    id: string;
    revisionId: string;
    status: "prepared" | "applying" | "applied" | "undoing" | "undone" | "recovery" | "failed";
    changes: { id: string; path: string }[];
    conflicts: { path: string; reason: string }[];
    error?: string;
  };
  file?: { path: string; original: string; modified: string; limitation?: string };
}
export function parseTaskAction(value: unknown): TaskAction {
  const result = taskActionSchema.safeParse(value, { jitless: true });
  if (!result.success) throw new Error("Invalid task request");
  return result.data;
}
