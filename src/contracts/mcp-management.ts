import { z } from "zod";
import { type McpTextIssue, validateMcpConnectorText } from "./mcp-connector-text.js";
import {
  type McpConnectorConfigurationStatus,
  type McpConnectorDefinition,
  type McpConnectorDocument,
  mcpConnectorDocumentSchema,
} from "./mcp-connectors.js";

z.config({ jitless: true });
const targetId = z.string().regex(/^[a-f0-9]{64}$/);
const revision = z.string().regex(/^[a-f0-9]{64}$/);
export const mcpTargetSchema = z.discriminatedUnion("scope", [
  z.strictObject({ scope: z.literal("user"), targetId }),
  z.strictObject({
    scope: z.literal("project"),
    targetId,
    projectId: z.uuid(),
    databaseEpoch: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  }),
]);
export const mcpSaveSchema = z.strictObject({
  target: mcpTargetSchema,
  expectedRevision: revision,
  requestId: z.uuid(),
  document: mcpConnectorDocumentSchema,
});
export const mcpMovePreviewSchema = z.strictObject({
  source: mcpTargetSchema,
  destination: mcpTargetSchema,
  serverId: z
    .string()
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/),
  expectedSourceRevision: revision,
  expectedDestinationRevision: revision,
});
export const mcpMoveSchema = mcpMovePreviewSchema.extend({ requestId: z.uuid() });
export type McpTargetAddress = z.infer<typeof mcpTargetSchema>;
export type McpSaveRequest = z.infer<typeof mcpSaveSchema>;
export type McpMovePreviewRequest = z.infer<typeof mcpMovePreviewSchema>;
export type McpMoveRequest = z.infer<typeof mcpMoveSchema>;
export interface McpManagementTarget {
  address: McpTargetAddress;
  label: string;
}
export interface McpManagementTargets {
  targets: McpManagementTarget[];
  templates: readonly { id: string; definition: McpConnectorDefinition }[];
  unavailableProjects: number;
}
export interface McpManagementRead {
  target: McpTargetAddress;
  exists: boolean;
  revision: string;
  document?: McpConnectorDocument;
  issues: McpTextIssue[];
  pendingRecovery: string[];
  inheritanceComplete: boolean;
  rows: (McpConnectorConfigurationStatus & { transport: "stdio" | "http" })[];
}
export interface McpManagementResult {
  status:
    | "saved"
    | "moved"
    | "restored"
    | "reset"
    | "unchanged"
    | "completed"
    | "rolled-back"
    | "recovery-required";
  transactionId: string;
  revisions: Record<string, string>;
}
export interface McpMovePreview {
  allowed: boolean;
  reason?: string;
  label: string;
  sourceLabel: string;
  destinationLabel: string;
  affectedProjects: string[];
  userScopeAffected: boolean;
  credentialReferences: number;
}
export const MCP_CONNECTOR_TEMPLATES: readonly {
  id: string;
  definition: McpConnectorDefinition;
}[] = [
  {
    id: "playwright",
    definition: {
      label: "Playwright",
      enabled: false,
      type: "stdio",
      command: "npx",
      args: ["-y", "@playwright/mcp@0.0.84", "--isolated", "--headless"],
      env: {},
    },
  },
  {
    id: "context7",
    definition: {
      label: "Context7",
      enabled: false,
      type: "stdio",
      command: "npx",
      args: ["-y", "@upstash/context7-mcp@4.5.1"],
      env: {},
    },
  },
];

/** Single definition only. The same bounded scanner rejects escaped duplicate keys. */
export function parseMcpDefinitionText(text: string): McpConnectorDefinition {
  const result = validateMcpConnectorText(`{"version":1,"servers":{"draft":${text}}}`);
  if (
    !result.valid ||
    Object.keys(result.document.servers).length !== 1 ||
    !result.document.servers.draft
  )
    throw new Error("Invalid MCP server definition.");
  return { ...result.document.servers.draft, enabled: false };
}

export function parseMcpManagement<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value, { jitless: true });
  if (!result.success) throw new Error("Invalid MCP management request.");
  return result.data;
}
