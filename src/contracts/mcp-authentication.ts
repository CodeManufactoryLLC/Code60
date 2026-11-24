import { z } from "zod";
import { mcpTargetSchema } from "./mcp-management.js";

z.config({ jitless: true });
const captured = {
  target: mcpTargetSchema,
  expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
  serverId: z
    .string()
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/),
};
const mutation = { ...captured, requestId: z.uuid() };
export const mcpAuthenticationRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("status"), ...captured }),
  z.strictObject({
    action: z.literal("preview"),
    ...captured,
    issuer: z.string().max(4096).optional(),
    allowPrivateIssuer: z.boolean().default(false),
  }),
  z.strictObject({
    action: z.literal("credential-write"),
    ...mutation,
    previewId: z.uuid(),
    reference: z.string().min(1).max(128),
    secret: z
      .string()
      .min(1)
      .max(8192)
      .refine(
        (s) => !s.includes("\0") && new TextDecoder().decode(new TextEncoder().encode(s)) === s,
      ),
    storage: z.enum(["persistent", "temporary"]),
  }),
  z.strictObject({
    action: z.literal("credential-forget"),
    ...mutation,
    previewId: z.uuid(),
    reference: z.string().min(1).max(128),
  }),
  z.strictObject({
    action: z.literal("start"),
    ...mutation,
    previewId: z.uuid(),
    storage: z.enum(["persistent", "temporary"]),
  }),
  z.strictObject({ action: z.literal("cancel"), attemptId: z.uuid() }),
  z.strictObject({ action: z.literal("sign-out"), ...mutation }),
]);
export type McpAuthenticationRequest = z.infer<typeof mcpAuthenticationRequestSchema>;
export interface McpAuthenticationResponse {
  previewId?: string;
  fingerprint?: string;
  references?: {
    reference: string;
    state: string;
    storage: "persistent" | "temporary" | null;
    purpose: "binding" | "client-secret";
  }[];
  issuers?: string[];
  issuer?: string;
  scopes?: string[];
  resource?: string;
  endpoints?: string[];
  registration?:
    | "user-provided"
    | "metadata-url"
    | "per-installation"
    | "client-information-required";
  attemptId?: string;
  authorizationUrl?: string;
  status?:
    | "not-required"
    | "required"
    | "pending"
    | "authenticated"
    | "cancelled"
    | "reauthorization-required"
    | "signed-out"
    | "deletion-uncertain";
  storage?: "persistent" | "temporary";
  completed?: boolean;
  secureStorage?: "not-checked" | "available" | "locked" | "unavailable" | "uncertain";
  remoteRevocation?: "complete" | "not-advertised" | "uncertain";
}
