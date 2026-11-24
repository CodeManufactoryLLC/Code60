import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { SetupProviderId } from "../bridge/index.js";
import { AgentSetup } from "./agent-setup.js";
import { PROVIDERS, ProviderMissingError } from "./provider-catalog.js";
import type { ProviderLoginContext } from "./provider-setup-policy.js";
import { loginMethods, ProviderSetupError } from "./provider-setup-policy.js";

function fixture(id: SetupProviderId = "claude") {
  let found = false;
  let authenticated = false;
  const command = [
    ...(PROVIDERS.find((provider) => provider.id === id)?.command ?? ["missing"]),
  ] as [string, ...string[]];
  const challengeId = randomUUID();
  const policy = {
    install: vi.fn(async () => {
      found = true;
    }),
    cleanup: vi.fn(async () => {}),
    login: vi.fn(async (context: ProviderLoginContext) => {
      const result = await context.input({
        kind: "code",
        challengeId,
        verificationUrl: "https://claude.ai/oauth/authorize?state=PRIVATE-STATE",
      });
      if (result.kind !== "code" || result.code !== "PRIVATE-PASTE")
        throw new ProviderSetupError("login");
      authenticated = true;
    }),
  };
  const save = vi.fn(async () => {});
  const setup = new AgentSetup({
    command: () => command,
    detect: async () => {
      if (!found) throw new ProviderMissingError(id);
    },
    probe: async () => {
      if (!authenticated)
        throw Object.assign(new Error("Authentication required"), { authRequired: true });
    },
    providers: { [id]: policy },
    save,
    changed: () => {},
    canChangePrimary: () => true,
  });
  setup.begin({ mode: "primary" });
  const request = {
    sessionId: setup.snapshot().session?.id ?? "",
    provider: id,
    method: loginMethods[id][0] ?? "default",
  };
  return {
    setup,
    policy,
    request,
    save,
    command,
    challengeId,
    found: () => {
      found = true;
    },
    authenticated: () => {
      authenticated = true;
    },
  };
}
it("keeps paste-back private, owner-bound and single-use, probes and saves only after authentication", async () => {
  const f = fixture();
  await f.setup.attempt({ sessionId: f.request.sessionId, provider: "claude" });
  expect(f.setup.snapshot().session).toMatchObject({ setupAction: "install" });
  const started = f.setup.startProvider(f.request, "page-a", true);
  const identity = { ...f.request, attemptId: started.attemptId };
  // Browser identities intentionally have no login method.
  const { method: _method, ...address } = identity;
  await vi.waitFor(() => expect(f.setup.readProvider(address, "page-a").challenge).not.toBeNull());
  expect(JSON.stringify(f.setup.snapshot())).not.toMatch(/PRIVATE|oauth\/authorize/);
  expect(() => f.setup.readProvider(address, "page-b")).toThrow();
  const submission = {
    ...address,
    challengeId: f.challengeId,
    answer: { kind: "code" as const, code: "PRIVATE-PASTE" },
  };
  expect(() => f.setup.submitProvider(submission, "page-b")).toThrow();
  f.setup.submitProvider(submission, "page-a");
  expect(() => f.setup.submitProvider(submission, "page-a")).toThrow();
  await vi.waitFor(() => expect(f.setup.snapshot().session?.phase).toBe("success"));
  expect(f.save).not.toHaveBeenCalled();
  await f.setup.finish({ sessionId: f.request.sessionId });
  expect(f.setup.record).toMatchObject({ version: 1, primary: "claude", enabled: ["claude"] });
});
it.each(["antigravity", "claude", "copilot", "droid", "kiro", "opencode"] as SetupProviderId[])(
  "reuses retained %s authentication after installation without logging in",
  async (id) => {
    const f = fixture(id);
    f.authenticated();
    await f.setup.attempt({ sessionId: f.request.sessionId, provider: id });
    f.setup.startProvider(f.request, "page", true);
    await vi.waitFor(() => expect(f.setup.snapshot().session?.phase).toBe("success"));
    expect(f.policy.login).not.toHaveBeenCalled();
  },
);
it("cancels pending input, rejects stale attempts and prevents overlapping or unsupported actions", async () => {
  const f = fixture();
  f.found();
  await f.setup.attempt({ sessionId: f.request.sessionId, provider: "claude" });
  expect(() => f.setup.startProvider({ ...f.request, method: "chatgpt" }, "page", false)).toThrow();
  const start = f.setup.startProvider(f.request, "page", false);
  const address = {
    sessionId: f.request.sessionId,
    provider: "claude" as const,
    attemptId: start.attemptId,
  };
  expect(() => f.setup.startProvider(f.request, "page", false)).toThrow();
  await vi.waitFor(() => expect(f.setup.readProvider(address, "page").challenge).not.toBeNull());
  await f.setup.cancelProvider(address, "page");
  expect(() => f.setup.readProvider(address, "page")).toThrow();
  expect(() =>
    f.setup.submitProvider(
      { ...address, challengeId: f.challengeId, answer: { kind: "code", code: "late" } },
      "page",
    ),
  ).toThrow();
  expect(f.setup.snapshot().session?.phase).toBe("select");
  expect(f.setup.record).toBeNull();
});
it("keeps cleanup failures explicit and preserves custom launch setup", async () => {
  const f = fixture();
  f.found();
  f.command.splice(0, f.command.length, "custom");
  await f.setup.attempt({ sessionId: f.request.sessionId, provider: "claude" });
  expect(f.setup.snapshot().session?.setupAction).toBeUndefined();
  expect(() => f.setup.startProvider(f.request, "page", false)).toThrow();
});
it("reports install failures without losing the retry action and blocks unresolved cleanup", async () => {
  const f = fixture();
  await f.setup.attempt({ sessionId: f.request.sessionId, provider: "claude" });
  f.policy.install.mockRejectedValueOnce(new ProviderSetupError("install"));
  f.setup.startProvider(f.request, "page", true);
  await vi.waitFor(() => expect(f.setup.snapshot().session?.phase).toBe("failed"));
  expect(f.setup.snapshot().session).toMatchObject({
    setupAction: "install",
    failureReason: "install",
  });
  f.policy.cleanup.mockRejectedValueOnce(new Error("PRIVATE"));
  f.setup.startProvider(f.request, "page", true);
  await vi.waitFor(() => expect(f.setup.snapshot().session?.failureReason).toBe("cleanup"));
  expect(() => f.setup.startProvider(f.request, "page", true)).toThrow("cleanup");
  await f.setup.cancel({ sessionId: f.request.sessionId });
  expect(f.setup.snapshot().session?.phase).toBe("select");
});
it.each(["antigravity", "claude", "copilot", "droid", "kiro", "opencode"] as SetupProviderId[])(
  "connects an existing authenticated %s installation without install or login",
  async (id) => {
    const f = fixture(id);
    f.found();
    f.authenticated();
    await f.setup.attempt({ sessionId: f.request.sessionId, provider: id });
    expect(f.setup.snapshot().session?.phase).toBe("success");
    expect(f.policy.install).not.toHaveBeenCalled();
    expect(f.policy.login).not.toHaveBeenCalled();
    await f.setup.finish({ sessionId: f.request.sessionId });
    expect(f.setup.record?.enabled).toEqual([id]);
  },
);
