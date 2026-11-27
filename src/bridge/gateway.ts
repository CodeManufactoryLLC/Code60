import { z } from "zod";

z.config({ jitless: true });
export const GATEWAY_VERSION = 1;
export const GATEWAY_LIMITS = {
  requestBytes: 2 * 1024 * 1024,
  responseBytes: 16 * 1024 * 1024,
  streamBytes: 2 * 1024 * 1024,
  sessions: 16,
  requests: 64,
  pairingMs: 60_000,
  sessionMs: 12 * 60 * 60_000,
  interactionMs: 120_000,
} as const;
export type PickKind = "folder" | "database-open" | "database-create";
export const confirmationPresentation = {
  "open-project": { title: "Open project?", action: "Open project", danger: false },
  "open-search-project": { title: "Open this project?", action: "Open project", danger: false },
  "use-repository": {
    title: "Use this automation repository?",
    action: "Use repository",
    danger: false,
  },
  "test-mcp": { title: "Test MCP server?", action: "Test connection", danger: false },
  "open-link": { title: "Open web link?", action: "Open link", danger: false },
  "share-memory": { title: "Share this memory globally?", action: "Share memory", danger: false },
  "apply-changes": { title: "Apply reviewed changes?", action: "Apply changes", danger: false },
  "recover-changes": {
    title: "Recover interrupted changes?",
    action: "Recover changes",
    danger: false,
  },
  "install-scheduler": {
    title: "Install Scheduling Service?",
    action: "Install service",
    danger: false,
  },
  "repair-scheduler": {
    title: "Repair Scheduling Service?",
    action: "Repair service",
    danger: false,
  },
  "start-scheduler": { title: "Start Scheduling Service?", action: "Start service", danger: false },
  "clear-logs": { title: "Clear logs?", action: "Clear logs", danger: true },
  "clear-usage": { title: "Clear usage history?", action: "Clear usage history", danger: true },
  "stop-backend": { title: "Stop Code60 Backend?", action: "Stop backend", danger: true },
  "stop-runs": { title: "Stop all runs?", action: "Stop all runs", danger: true },
  "clear-index": { title: "Clear RAG index?", action: "Clear index", danger: true },
  "remove-codebase-index": {
    title: "Remove repository index?",
    action: "Remove index",
    danger: true,
  },
  "undo-request": { title: "Undo this request?", action: "Undo request", danger: true },
  "replace-database": { title: "Replace database?", action: "Replace database", danger: true },
  "clear-history": { title: "Clear project history?", action: "Clear history", danger: true },
  "close-project": { title: "Close project?", action: "Close project", danger: true },
  "stop-folder": { title: "Stop folder?", action: "Stop folder", danger: true },
  "delete-configuration": {
    title: "Delete run configuration?",
    action: "Delete configuration",
    danger: true,
  },
  "delete-command": { title: "Delete command?", action: "Delete command", danger: true },
  "reset-prompt": { title: "Reset prompt template?", action: "Reset template", danger: true },
  "discard-worktree": { title: "Discard this worktree?", action: "Discard worktree", danger: true },
  "enable-retention": {
    title: "Automatically delete old memories?",
    action: "Enable deletion",
    danger: true,
  },
  "forget-memories": { title: "Forget derived memories?", action: "Forget memories", danger: true },
  "archive-assistant": {
    title: "Archive custom assistant?",
    action: "Archive assistant",
    danger: true,
  },
  "delete-automation": { title: "Delete automation?", action: "Delete automation", danger: true },
  "undo-changes": { title: "Undo reviewed changes?", action: "Undo changes", danger: true },
  "stop-scheduler": { title: "Stop Scheduling Service?", action: "Stop service", danger: true },
  "uninstall-scheduler": {
    title: "Uninstall Scheduling Service?",
    action: "Uninstall service",
    danger: true,
  },
} as const;
export type ConfirmationId = keyof typeof confirmationPresentation;
export type Interaction = { id: string; title: string; detail: string } & (
  | { kind: "confirm"; presentation: ConfirmationId; picker?: never }
  | { kind: "pick"; picker: PickKind; presentation?: never }
);
interface Choice {
  id: string;
  name: string;
  directory: boolean;
}
export interface Choices {
  directory: string;
  entries: Choice[];
  truncated: boolean;
}
export const operationRequestSchema = z.strictObject({
  id: z.uuid(),
  operation: z.string().min(1).max(80),
  value: z.unknown().optional(),
});
export const interactionAnswerSchema = z.strictObject({
  id: z.uuid(),
  accepted: z.boolean(),
  choice: z.uuid().optional(),
  filename: z.string().min(1).max(200).optional(),
});
export const pairingRequestSchema = z.strictObject({
  code: z.string().regex(/^(?:[a-f0-9]{16}|[0-9]{3}-?[0-9]{3})$/),
  version: z.literal(GATEWAY_VERSION),
});
export const connectionRequestSchema = z.strictObject({ version: z.literal(GATEWAY_VERSION) });
export const connectionStatusSchema = z.strictObject({
  version: z.literal(GATEWAY_VERSION),
  requirePairing: z.boolean(),
});
export const pairingPolicySchema = z.strictObject({ requirePairing: z.boolean() });
export const gatewaySettingsSchema = z.strictObject({
  roots: z.array(z.string().min(1).max(4096)).min(1).max(32).optional(),
  requirePairing: z.boolean().optional(),
  webServerEnabled: z.boolean().optional(),
});
export type GatewaySettings = z.infer<typeof gatewaySettingsSchema>;
export const chooserRequestSchema = z.strictObject({
  id: z.uuid(),
  directory: z.uuid().optional(),
  createDirectory: z.string().min(1).max(200).optional(),
});
export type InteractionAnswer = z.infer<typeof interactionAnswerSchema>;
export type ChooserRequest = z.infer<typeof chooserRequestSchema>;
export interface GatewayFrame {
  sequence: number;
  event: string;
  value?: unknown;
}
export interface BrowserSession {
  /** Ephemeral page identity; never persisted as execution authority. */
  clientId?: string;
  token: string;
  generation: number;
  controlling: boolean;
  version: number;
}
