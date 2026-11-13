import { z } from "zod";
import { memoryActionSchema, memoryBrowseSchema, parseValue } from "../contracts/index.js";

export const parseMemoryAction = (value: unknown) => parseValue(memoryActionSchema, value);
export const parseMemoryBrowse = (value: unknown) => parseValue(memoryBrowseSchema, value);
export const parseMemoryDetail = (value: unknown) =>
  parseValue(z.strictObject({ id: z.string().uuid() }), value);
