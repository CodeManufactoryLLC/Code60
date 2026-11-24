import { z } from "zod";
import { mcpTargetSchema } from "./mcp-management.js";
import type { McpFailure, McpTroubleshootingReport } from "./mcp-troubleshooting.js";

z.config({ jitless: true });
const revision = z.string().regex(/^[a-f0-9]{64}$/);
const serverId = z
  .string()
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/);
const captured = { target: mcpTargetSchema, expectedRevision: revision };
const mutation = { ...captured, requestId: z.uuid() };
const connection = {
  ...captured,
  sessionGeneration: z.uuid(),
  serverIds: z.array(serverId).min(1).max(64),
};
export const mcpRuntimeRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("status"), target: mcpTargetSchema }),
  z.strictObject({ action: z.literal("report"), target: mcpTargetSchema }),
  z.strictObject({
    action: z.literal("verify-cleanup"),
    target: mcpTargetSchema,
    requestId: z.uuid(),
  }),
  z.strictObject({ action: z.literal("enable"), ...mutation, serverId, enabled: z.boolean() }),
  z.strictObject({ action: z.literal("review-approval"), ...captured }),
  z.strictObject({ action: z.literal("approve"), ...mutation }),
  z.strictObject({ action: z.literal("revoke-approval"), ...mutation }),
  z.strictObject({ action: z.literal("test"), ...mutation, serverId }),
  z.strictObject({ action: z.literal("cancel-test"), requestId: z.uuid() }),
  z.strictObject({ action: z.literal("preview-reconnect"), ...connection }),
  z.strictObject({ action: z.literal("preview-disconnect"), ...connection }),
  z.strictObject({
    action: z.literal("reconnect"),
    ...connection,
    requestId: z.uuid(),
    previewId: z.uuid(),
  }),
  z.strictObject({
    action: z.literal("disconnect"),
    ...connection,
    requestId: z.uuid(),
    previewId: z.uuid(),
  }),
]);
export type McpRuntimeRequest = z.infer<typeof mcpRuntimeRequestSchema>;
interface McpRuntimeSessionStatus {
  sessionGeneration: string;
  runId: string;
  idle: boolean;
  canReconnect: boolean;
  connectors: { id: string; targetId: string; revision: string; connection: string }[];
}
export interface McpRuntimeResponse {
  failure?: McpFailure;
  failures?: McpFailure[];
  unresolvedCleanup?: number;
  report?: McpTroubleshootingReport;
  previewId?: string;
  sessions?: McpRuntimeSessionStatus[];
  approved?: boolean;
  connectors?: { id: string; targetId: string; revision: string }[];
  connection?: "connected" | "failed" | "authentication-required" | "cancelled";
  tools?: number;
  completed?: boolean;
}
