import { z } from "zod";

z.config({ jitless: true });
export const webServerEnabledSchema = z.strictObject({ enabled: z.boolean() });
export interface WebServerStatus {
  enabled: boolean;
  state: "disabled" | "starting" | "listening" | "stopping" | "unavailable";
  url: string | null;
  error: string | null;
  canManage: boolean;
}
export interface WebServerCode {
  code: string;
  expiresAt: number;
}
