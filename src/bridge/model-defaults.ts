import { z } from "zod";
import { logInputSchema, parseValue, sessionValueSchema } from "../contracts/index.js";

z.config({ jitless: true });
const provider = logInputSchema.shape.provider.unwrap();
const role = z.enum(["orchestrator", "worker"]);
const selections = z
  .array(
    z.strictObject({
      configId: sessionValueSchema,
      value: sessionValueSchema,
      name: z.string().min(1).max(1024),
    }),
  )
  .min(1)
  .max(32)
  .refine(
    (items) => new Set(items.map((item) => item.configId)).size === items.length,
    "Duplicate session setting",
  );
const schema = z.strictObject({
  version: z.literal(1),
  providers: z.partialRecord(provider, z.partialRecord(role, selections)),
});
const action = z.strictObject({ type: z.literal("clear"), provider, role });
export type ModelDefaultsRecord = z.infer<typeof schema>;
export type ModelDefaultAction = z.infer<typeof action>;
export type ModelDefaultRole = z.infer<typeof role>;
export const parseModelDefaults = (value: unknown) => parseValue(schema, value);
export const parseModelDefaultAction = (value: unknown) => parseValue(action, value);
