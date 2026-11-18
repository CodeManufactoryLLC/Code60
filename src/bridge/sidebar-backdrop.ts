import { z } from "zod";
import { parseValue } from "../contracts/index.js";

z.config({ jitless: true });
const sidebarBackdropSchema = z.strictObject({
  width: z.number().finite().min(0).max(16384),
  strength: z.number().int().min(0).max(100),
  visible: z.boolean(),
});
export type SidebarBackdropRequest = z.infer<typeof sidebarBackdropSchema>;
export const parseSidebarBackdrop = (value: unknown): SidebarBackdropRequest =>
  parseValue(sidebarBackdropSchema, value);
