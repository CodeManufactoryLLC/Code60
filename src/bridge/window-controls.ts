import { z } from "zod";
import { parseValue } from "../contracts/index.js";

const windowControlSchema = z.enum(["minimize", "maximize", "close"]);
export type WindowControl = z.infer<typeof windowControlSchema>;
export const parseWindowControl = (value: unknown): WindowControl =>
  parseValue(windowControlSchema, value);
