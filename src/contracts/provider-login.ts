import { z } from "zod";

z.config({ jitless: true });

export const CODEX_VERIFICATION_URL = "https://auth.openai.com/codex/device";
export const codexChallengeSchema = z.strictObject({
  verificationUrl: z.literal(CODEX_VERIFICATION_URL),
  userCode: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9-]+$/),
});
export type CodexChallenge = z.infer<typeof codexChallengeSchema>;
const identity = z.strictObject({ sessionId: z.uuid(), attemptId: z.uuid() });
export const parseCodexSetupIdentity = (value: unknown) => identity.parse(value);
export type CodexSetupIdentity = z.infer<typeof identity>;
export interface CodexSetupStarted {
  attemptId: string;
}
export interface CodexSetupProgress {
  attemptId: string;
  phase: "installing" | "authenticating" | "connecting" | "success" | "failed";
  challenge: CodexChallenge | null;
}

const setupProviderIdSchema = z.enum([
  "antigravity",
  "claude",
  "codex",
  "copilot",
  "droid",
  "kiro",
  "opencode",
]);
export type SetupProviderId = z.infer<typeof setupProviderIdSchema>;
const providerLoginMethodSchema = z.enum([
  "default",
  "claude-subscription",
  "claude-console",
  "chatgpt",
  "github-copilot",
]);
export type ProviderLoginMethod = z.infer<typeof providerLoginMethodSchema>;
const providerIdentity = identity.extend({ provider: setupProviderIdSchema });
export const parseProviderSetupIdentity = (value: unknown) => providerIdentity.parse(value);
export type ProviderSetupIdentity = z.infer<typeof providerIdentity>;
const start = z.strictObject({
  sessionId: z.uuid(),
  provider: setupProviderIdSchema,
  method: providerLoginMethodSchema,
});
export const parseProviderSetupStart = (value: unknown) => start.parse(value);
export type ProviderSetupStart = z.infer<typeof start>;

/** Further restricted to the selected harness's destinations by the application. */
const verificationUrl = z
  .string()
  .max(8192)
  .url()
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port;
  });
const challengeIdentity = { challengeId: z.uuid() };
export const providerLoginChallengeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...challengeIdentity, kind: z.literal("browser"), verificationUrl }),
  z.strictObject({
    ...challengeIdentity,
    kind: z.literal("device"),
    verificationUrl,
    userCode: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9 -]+$/),
  }),
  z.strictObject({ ...challengeIdentity, kind: z.literal("code"), verificationUrl }),
  z.strictObject({
    ...challengeIdentity,
    kind: z.literal("confirmation"),
    confirmation: z.literal("save-copilot-login"),
  }),
]);
export type ProviderLoginChallenge = z.infer<typeof providerLoginChallengeSchema>;
const answer = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("code"),
    code: z
      .string()
      .min(1)
      .max(4096)
      .refine((value) =>
        [...value].every(
          (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
        ),
      ),
  }),
  z.strictObject({ kind: z.literal("confirmation"), accepted: z.boolean() }),
]);
export type ProviderLoginAnswer = z.infer<typeof answer>;
const submission = providerIdentity.extend({ challengeId: z.uuid(), answer });
export const parseProviderSetupSubmission = (value: unknown) => submission.parse(value);
export type ProviderSetupSubmission = z.infer<typeof submission>;
export interface ProviderSetupProgress {
  attemptId: string;
  phase: CodexSetupProgress["phase"];
  challenge: ProviderLoginChallenge | null;
}
