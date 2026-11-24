import { z } from "zod";
import type { McpManagementResult } from "./mcp-management.js";
import { mcpTargetSchema } from "./mcp-management.js";

z.config({ jitless: true });
const revision = z.string().regex(/^[a-f0-9]{64}$/);
export const mcpRecoveryRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("list"), target: mcpTargetSchema }),
  z.strictObject({ action: z.literal("review"), target: mcpTargetSchema, transactionId: z.uuid() }),
  z.strictObject({
    action: z.literal("recover"),
    transactionId: z.uuid(),
    direction: z.enum(["complete", "rollback"]),
    reviewRevision: revision,
    targets: z
      .array(z.strictObject({ target: mcpTargetSchema, expectedRevision: revision }))
      .min(1)
      .max(2)
      .refine(
        (targets) => new Set(targets.map((entry) => entry.target.targetId)).size === targets.length,
      ),
    requestId: z.uuid(),
  }),
]);
export type McpRecoveryRequest = z.infer<typeof mcpRecoveryRequestSchema>;
export interface McpRecoveryReview {
  transactionId: string;
  reviewRevision: string;
  kind: "saved" | "moved" | "restored" | "reset";
  createdAt: number;
  allowed: boolean;
  targets: {
    target: z.infer<typeof mcpTargetSchema>;
    label: string;
    expectedRevision: string;
    state: "before" | "after" | "unchanged" | "conflict";
    writes: boolean;
    changedServerIds: string[];
    before: { exists: boolean; valid: boolean; servers: number | null };
    after: { exists: boolean; valid: boolean; servers: number | null };
  }[];
}
export interface McpRecoveryResponse {
  pending?: { transactionId: string; available: boolean }[];
  review?: McpRecoveryReview;
  result?: McpManagementResult;
}
