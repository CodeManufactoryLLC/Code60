import { z } from "zod";
import { parseValue } from "../contracts/index.js";

const databaseWriteSchema = z.strictObject({
  request: z.unknown(),
  databaseEpoch: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
});

export const parseDatabaseWrite = (value: unknown) => parseValue(databaseWriteSchema, value);
