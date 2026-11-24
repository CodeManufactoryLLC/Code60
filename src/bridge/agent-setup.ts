export type {
  ProviderLoginAnswer,
  ProviderLoginChallenge,
  ProviderLoginMethod,
  ProviderSetupIdentity,
  ProviderSetupProgress,
  ProviderSetupStart,
  ProviderSetupSubmission,
  SetupProviderId,
} from "../contracts/index.js";
export {
  parseProviderSetupIdentity,
  parseProviderSetupStart,
  parseProviderSetupSubmission,
  providerLoginChallengeSchema,
} from "../contracts/index.js";

import { z } from "zod";

export type {
  CodexChallenge,
  CodexSetupIdentity,
  CodexSetupProgress,
  CodexSetupStarted,
} from "../contracts/index.js";
export {
  CODEX_VERIFICATION_URL,
  codexChallengeSchema,
  parseCodexSetupIdentity,
} from "../contracts/index.js";

z.config({ jitless: true });
const provider = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[\w-]+$/);
const identity = z.string().regex(/^[a-f0-9]{64}$/);
const record = z
  .strictObject({
    version: z.literal(1),
    primary: provider,
    enabled: z.array(provider).min(1).max(100),
    commands: z.record(provider, identity),
  })
  .refine(
    (value) =>
      new Set(value.enabled).size === value.enabled.length &&
      value.enabled.includes(value.primary) &&
      value.enabled.every((id) => !!value.commands[id]) &&
      Object.keys(value.commands).every((id) => value.enabled.includes(id)),
    "Invalid enabled agents",
  );
export type AgentSetupRecord = z.infer<typeof record>;
export const parseAgentSetupRecord = (value: unknown): AgentSetupRecord => record.parse(value);
const providerAction = z.strictObject({
  type: z.enum(["set-primary", "disconnect"]),
  provider,
});
export type ProviderAction = z.infer<typeof providerAction>;
export const parseProviderAction = (value: unknown): ProviderAction => providerAction.parse(value);
const begin = z.strictObject({ mode: z.enum(["primary", "add"]) });
const session = z.strictObject({ sessionId: z.uuid() });
const attempt = session.extend({ provider });
export const parseSetupBegin = (value: unknown) => begin.parse(value);
export const parseSetupSession = (value: unknown) => session.parse(value);
export const parseSetupAttempt = (value: unknown) => attempt.parse(value);
export type SetupBegin = z.infer<typeof begin>;
export type SetupIdentity = z.infer<typeof session>;
export type SetupAttempt = z.infer<typeof attempt>;
export interface SetupProvider {
  id: string;
  name: string;
  logo: string;
  guidance: string;
  loginMethods?: readonly import("../contracts/index.js").ProviderLoginMethod[];
}
export interface AgentSetupSession {
  id: string;
  mode: "primary" | "add";
  role: "primary" | "additional";
  candidate: string | null;
  phase:
    | "select"
    | "detecting"
    | "connecting"
    | "installing"
    | "authenticating"
    | "success"
    | "failed";
  setupAction?: "install" | "login";
  codexAction?: "install" | "login";
  failureReason?:
    | "missing"
    | "authentication"
    | "install"
    | "login"
    | "unsupported"
    | "timeout"
    | "connection"
    | "cleanup";
  detected: boolean;
  error: string | null;
  primary: string | null;
  verified: string[];
}
export interface AgentSetupSnapshot {
  management?: { blockedReason: string | null };
  complete: boolean;
  primary: string | null;
  enabled: string[];
  providers: SetupProvider[];
  session: AgentSetupSession | null;
}
