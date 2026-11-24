import { z } from "zod";

z.config({ jitless: true });
export const mcpFailureSchema = z.strictObject({
  code: z.enum([
    "launch",
    "arguments",
    "authentication",
    "scope",
    "network",
    "tls",
    "timeout",
    "protocol",
    "limit",
    "cancelled",
    "cleanup",
    "provider",
  ]),
  stage: z.enum([
    "launch",
    "authentication",
    "initialize",
    "discovery",
    "call",
    "cleanup",
    "provider",
  ]),
});
export type McpFailure = z.infer<typeof mcpFailureSchema>;
const guidance: Record<McpFailure["code"], string> = {
  launch:
    "The executable could not start. Review the command, installed prerequisites and execution permissions, then Test connection.",
  arguments:
    "The launch settings were refused. Review the command and argument rows, then Test connection.",
  authentication:
    "Authentication required. Credentials are missing or expired. Sign in again or supply the referenced credential, then Test connection.",
  scope:
    "The server refused access. Review the requested scopes and server permissions before signing in again.",
  network:
    "The network request failed. Check the configured endpoint and network access, then explicitly Test connection. A lost response may be uncertain; never replay a tool call.",
  tls: "The secure connection failed. Review the endpoint certificate and trust settings; do not disable TLS verification. Then Test connection.",
  timeout:
    "The bounded operation timed out. Check the server and network, then explicitly Test connection. An uncertain tool call must not be replayed.",
  protocol:
    "The server did not complete the tools-only MCP protocol stage. Review its MCP support and configuration, then Test connection.",
  limit:
    "A connection, discovery or message limit was reached. Reduce configured work or disconnect unused instances before testing again.",
  cancelled:
    "The operation was cancelled. No retry is automatic; use Test connection for a fresh discovery-only attempt.",
  cleanup:
    "Owned cleanup could not be verified. Keep the Gateway running and use Verify cleanup. Authority remains revoked; no work is replayed.",
  provider:
    "This provider cannot restore the owning session. Start a new session or use a provider with ACP load/resume support to reconnect.",
};
export function mcpFailureGuidance(value: McpFailure): string {
  return `MCP_${value.code.toUpperCase()} (${value.stage}): ${guidance[value.code]} Other tools remain available. The agent session remains usable.`;
}
/** Accept fixed codes only; upstream exceptions and output never become DTOs. */
export function mcpFailure(value: unknown, fallback: McpFailure): McpFailure {
  if (value && typeof value === "object" && "mcpFailure" in value) {
    const result = mcpFailureSchema.safeParse(value.mcpFailure);
    if (result.success) return result.data;
  }
  return fallback;
}
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
/** An allowlist, deliberately without labels, IDs, paths, definitions or free text. */
export const mcpTroubleshootingReportSchema = z.strictObject({
  version: z.literal(1),
  scope: z.enum(["user", "project"]),
  configuration: z.enum(["missing", "valid", "invalid", "unavailable"]),
  issues: count,
  pendingTransactions: count,
  definitions: count,
  enabled: count,
  projectApproval: z.enum(["not-required", "required", "approved", "not-checked"]),
  authentication: z.strictObject({
    notChecked: count,
    notRequired: count,
    required: count,
    authenticated: count,
    failed: count,
  }),
  connections: z.strictObject({
    notTested: count,
    connecting: count,
    connected: count,
    failed: count,
    disconnected: count,
    cleanupUnresolved: count,
    authenticationRequired: count,
  }),
  failures: z.array(mcpFailureSchema).max(64),
  unresolvedCleanup: count,
  capturedInstances: count,
  connectedInstances: count,
});
export type McpTroubleshootingReport = z.infer<typeof mcpTroubleshootingReportSchema>;
