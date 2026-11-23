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
export interface Interaction {
  id: string;
  kind: "confirm" | "pick";
  title: string;
  detail: string;
  picker?: PickKind;
}
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
