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
