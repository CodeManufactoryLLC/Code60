import { z } from "zod";
import { parseValue } from "../contracts/index.js";

z.config({ jitless: true });
const fields = {
  name: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .refine((s) => !/[\r\n\0]/.test(s)),
  instructions: z
    .string()
    .min(1)
    .max(32_000)
    .refine((s) => s.trim().length > 0 && !s.includes("\0")),
};
export const customAgentSchema = z.strictObject({
  id: z.string().uuid(),
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  ...fields,
  archived: z.boolean(),
});
const identity = { id: z.string().uuid(), revision: customAgentSchema.shape.revision };
const requestSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("list") }),
  z.strictObject({ type: z.literal("read"), id: identity.id }),
  z.strictObject({ type: z.literal("create"), ...fields }),
  z.strictObject({ type: z.literal("edit"), ...identity, ...fields }),
  z.strictObject({ type: z.enum(["archive", "restore"]), ...identity }),
  z.strictObject({ type: z.literal("open"), id: identity.id }),
]);
export type CustomAgent = z.infer<typeof customAgentSchema>;
export type CustomAgentSummary = Omit<CustomAgent, "instructions">;
export type CustomAgentRequest = z.infer<typeof requestSchema>;
export interface CustomAgentResponse {
  agents: CustomAgentSummary[];
  agent?: CustomAgent;
  conversationId?: string;
}
export const parseCustomAgentRequest = (value: unknown): CustomAgentRequest =>
  parseValue(requestSchema, value);
