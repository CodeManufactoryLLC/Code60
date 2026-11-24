import { z } from "zod";

const address = {
  service: z.string().regex(/^code60\.mcp\.[a-f0-9-]{36}$/),
  account: z.string().regex(/^[a-f0-9]{64}$/),
};
export const credentialRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("get"), ...address }),
  z.strictObject({ action: z.literal("delete"), ...address }),
  z.strictObject({ action: z.literal("set"), ...address, secret: z.string().max(128 * 1024) }),
]);
type CredentialRequest = z.infer<typeof credentialRequestSchema>;
export const credentialResponseSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("available"),
    secret: z
      .string()
      .max(128 * 1024)
      .nullable()
      .optional(),
  }),
  z.strictObject({ status: z.enum(["locked", "unavailable", "uncertain"]) }),
]);
type CredentialResponse = z.infer<typeof credentialResponseSchema>;
export interface CredentialStorePort {
  (request: CredentialRequest, signal?: AbortSignal): Promise<CredentialResponse>;
  close?(): Promise<void>;
}
