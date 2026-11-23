import { z } from "zod";
import { MCP_TEXT_LIMITS, type McpTextIssue } from "./mcp-connector-text.js";
import { mcpConnectorDocumentSchema } from "./mcp-connectors.js";
import { type McpTargetAddress, mcpTargetSchema } from "./mcp-management.js";

z.config({ jitless: true });
const revision = z.string().regex(/^[a-f0-9]{64}$/);
const backupId = z.string().regex(/^[a-f0-9-]{36}-[01]$/);
const content = z
  .string()
  .max(Math.ceil(MCP_TEXT_LIMITS.bytes / 3) * 4)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
export const mcpSaveTextSchema = z.strictObject({
  target: mcpTargetSchema,
  expectedRevision: revision,
  requestId: z.uuid(),
  contentBase64: content,
});
export const mcpBackupSchema = z.strictObject({ target: mcpTargetSchema, backupId });
export const mcpRestoreSchema = mcpBackupSchema.extend({
  expectedRevision: revision,
  expectedBackupRevision: revision,
  requestId: z.uuid(),
});
export const mcpResetPreviewSchema = z
  .strictObject({ target: mcpTargetSchema, includeUser: z.boolean() })
  .refine((v) => v.target.scope === "project" || !v.includeUser);
export const mcpResetSchema = z
  .strictObject({
    target: mcpTargetSchema,
    includeUser: z.boolean(),
    expectedRevision: revision,
    expectedUserRevision: revision.optional(),
    requestId: z.uuid(),
  })
  .refine((v) =>
    v.target.scope === "project"
      ? Boolean(v.expectedUserRevision)
      : !v.includeUser && v.expectedUserRevision === undefined,
  );
export type McpSaveText = z.infer<typeof mcpSaveTextSchema>;
export type McpBackupRequest = z.infer<typeof mcpBackupSchema>;
export type McpRestore = z.infer<typeof mcpRestoreSchema>;
export type McpResetRequest = z.infer<typeof mcpResetSchema>;
export type McpResetSelection = z.infer<typeof mcpResetPreviewSchema>;
export interface McpTextRead {
  target: McpTargetAddress;
  exists: boolean;
  revision: string;
  contentBase64: string | null;
  issues: McpTextIssue[];
  pendingRecovery: string[];
}
export interface McpBackupEntry {
  backupId: string;
  createdAt: number;
  valid: boolean;
  pinned: boolean;
}
export interface McpBackupPreview {
  backupId: string;
  backupRevision: string;
  contentBase64: string | null;
  missing: boolean;
}
export interface McpResetPreview {
  request: Omit<McpResetRequest, "requestId">;
  configurationLabels: string[];
  removedLabels: string[];
  inheritedLabels: string[];
  remainingEnabled: number | null;
  affectedProjects: string[];
  malformed: boolean;
  blocked: boolean;
}
export const MCP_EMPTY_TEXT = '{\n  "version": 1,\n  "servers": {}\n}\n';
/** Encoding is a wire envelope, never encryption or credential storage. */
export function encodeMcpText(text: string): string {
  const data = new TextEncoder().encode(text);
  if (
    data.length > MCP_TEXT_LIMITS.bytes ||
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data) !== text
  )
    throw new Error("Invalid MCP configuration text.");
  let binary = "";
  for (let offset = 0; offset < data.length; offset += 16384)
    binary += String.fromCharCode(...data.subarray(offset, offset + 16384));
  return btoa(binary);
}
export function decodeMcpText(value: string): string {
  try {
    if (!content.safeParse(value).success) throw new Error();
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    if (bytes.length > MCP_TEXT_LIMITS.bytes || btoa(binary) !== value) throw new Error();
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Error("Invalid MCP configuration text.");
  }
}
/** Data conversion only: Zod JIT remains disabled. Refinements stay authoritative in text validation. */
export const MCP_COMPLETION_SCHEMA = z.toJSONSchema(mcpConnectorDocumentSchema, {
  io: "input",
  unrepresentable: "any",
  target: "draft-07",
});
