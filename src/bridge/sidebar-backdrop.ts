import { z } from "zod";
import { parseValue } from "../contracts/index.js";

z.config({ jitless: true });
export const sidebarBackdropWidthLimit = 16384;
const sidebarBackdropSchema = z.strictObject({
  width: z.number().finite().min(0).max(sidebarBackdropWidthLimit),
  strength: z.number().int().min(0).max(100),
  visible: z.boolean(),
});
export type SidebarBackdropRequest = z.infer<typeof sidebarBackdropSchema>;
export const inactiveSidebarBackdrop: Readonly<SidebarBackdropRequest> = Object.freeze({
  width: 0,
  strength: 0,
  visible: false,
});
export const parseSidebarBackdrop = (value: unknown): SidebarBackdropRequest =>
  parseValue(sidebarBackdropSchema, value);
