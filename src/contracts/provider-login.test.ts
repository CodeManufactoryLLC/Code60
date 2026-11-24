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

it("restricts generic provider operations and keeps code submissions bounded and correlated", async () => {
  const {
    parseProviderSetupStart,
    parseProviderSetupIdentity,
    parseProviderSetupSubmission,
    providerLoginChallengeSchema,
  } = await import("./provider-login.js");
  const sessionId = "00000000-0000-4000-8000-000000000001";
  const attemptId = "00000000-0000-4000-8000-000000000002";
  const challengeId = "00000000-0000-4000-8000-000000000003";
  const address = { sessionId, attemptId, provider: "claude" };
  expect(
    parseProviderSetupStart({ sessionId, provider: "claude", method: "claude-console" }).method,
  ).toBe("claude-console");
  expect(
    parseProviderSetupSubmission({
      ...address,
      challengeId,
      answer: { kind: "code", code: "opaque-code" },
    }).answer,
  ).toEqual({ kind: "code", code: "opaque-code" });
  for (const field of ["command", "env", "url", "package", "path", "owner"])
    expect(() => parseProviderSetupIdentity({ ...address, [field]: "untrusted" })).toThrow();
  for (const code of ["", "x".repeat(4097), "a\nb", "a\u0000b"])
    expect(() =>
      parseProviderSetupSubmission({ ...address, challengeId, answer: { kind: "code", code } }),
    ).toThrow();
  expect(() =>
    parseProviderSetupStart({ sessionId, provider: "unknown", method: "default" }),
  ).toThrow();
  expect(() =>
    providerLoginChallengeSchema.parse({
      kind: "code",
      challengeId,
      verificationUrl: "http://claude.ai/oauth/authorize",
    }),
  ).toThrow();
});
