import { expect, it } from "vitest";
import { codexChallengeSchema, parseCodexSetupIdentity } from "./provider-login.js";

it("accepts only bounded opaque setup identities and rejects browser launch overrides", () => {
  const value = {
    sessionId: "00000000-0000-4000-8000-000000000001",
    attemptId: "00000000-0000-4000-8000-000000000002",
  };
  expect(parseCodexSetupIdentity(value)).toEqual(value);
  for (const extra of [
    { command: ["sh"] },
    { path: "/tmp" },
    { env: {} },
    { package: "other" },
    { owner: "other" },
  ])
    expect(() => parseCodexSetupIdentity({ ...value, ...extra })).toThrow();
  expect(() => parseCodexSetupIdentity({ ...value, attemptId: "old" })).toThrow();
});
it("accepts exactly the official HTTPS verification destination with bounded codes", () => {
  const value = { verificationUrl: "https://auth.openai.com/codex/device", userCode: "ABCD-1234" };
  expect(codexChallengeSchema.parse(value)).toEqual(value);
  for (const verificationUrl of [
    "http://auth.openai.com/codex/device",
    "https://auth.openai.com/codex/device?token=secret",
    "https://auth.openai.com.evil.test/codex/device",
    "javascript:alert(1)",
  ])
    expect(codexChallengeSchema.safeParse({ ...value, verificationUrl }).success).toBe(false);
  for (const userCode of ["", "A".repeat(129), "<script>", "has space"])
    expect(codexChallengeSchema.safeParse({ ...value, userCode }).success).toBe(false);
});
