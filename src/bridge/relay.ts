import { z } from "zod";

const relayMessageReadSchema = z.strictObject({
  conversationId: z.string().uuid(),
  source: z.string().uuid(),
  cursor: z.string().uuid().optional(),
});
export type RelayMessageRead = z.infer<typeof relayMessageReadSchema>;
export interface RelayMessageSource {
  text: string;
  cursor: string | null;
}
export function parseRelayMessageRead(value: unknown): RelayMessageRead {
  const result = relayMessageReadSchema.safeParse(value, { jitless: true });
  if (!result.success) throw new Error("Invalid Relay source request");
  return result.data;
}
