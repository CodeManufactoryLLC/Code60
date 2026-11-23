import { describe, expect, it, vi } from "vitest";
import { parseAgentSetupRecord, parseSetupAttempt } from "../bridge/index.js";
import { AgentSetup, type SetupDependencies } from "./agent-setup.js";
import { CodexSetupError } from "./codex-login.js";
import { PROVIDERS, ProviderMissingError } from "./provider-catalog.js";

function fixture() {
  const commands: Record<string, readonly [string, ...string[]]> = {
    claude: ["claude"],
    codex: ["codex"],
    droid: ["droid"],
  };
  const deps: SetupDependencies = {
    command: (id) => commands[id],
    detect: vi.fn(async () => {}),
    probe: vi.fn(async () => {}),
    save: vi.fn(async () => {}),
    changed: vi.fn(),
    canChangePrimary: () => true,
  };
  const setup = new AgentSetup(deps);
  const identity = () => ({ sessionId: setup.snapshot().session?.id ?? "" });
  const attempt = (provider: string) => setup.attempt({ ...identity(), provider });
  return { setup, deps, commands, identity, attempt };
}

describe("agent setup transaction", () => {
  it("preserves unaffected verified memberships when recovering a changed primary command", async () => {
    const { setup, commands, identity, attempt } = fixture();
    setup.begin({ mode: "primary" });
    await attempt("claude");
    await attempt("codex");
    await setup.finish(identity());
    commands.claude = ["changed-command"];
    expect(setup.complete).toBe(false);
    setup.begin({ mode: "primary" });
    expect(setup.snapshot().session?.verified).toEqual(["codex"]);
    await attempt("droid");
    await setup.finish(identity());
    expect(setup.record).toMatchObject({ primary: "droid", enabled: ["codex", "droid"] });
  });
  it("detects then connects a primary and repeated additions, preserving primary and preventing duplicates", async () => {
    const { setup, deps, identity, attempt } = fixture();
    const phases: string[] = [];
    deps.changed = () => {
      const phase = setup.snapshot().session?.phase;
      if (phase) phases.push(phase);
    };
    setup.begin({ mode: "primary" });
    expect(setup.complete).toBe(false);
    await attempt("claude");
    expect(phases).toEqual(["select", "detecting", "connecting", "success"]);
    await attempt("codex");
    await attempt("droid");
    await expect(attempt("codex")).rejects.toThrow("already selected");
    expect(setup.snapshot().session).toMatchObject({
      primary: "claude",
      verified: ["claude", "codex", "droid"],
    });
    expect(deps.save).not.toHaveBeenCalled();
    expect(setup.complete).toBe(false);
    await setup.finish(identity());
    expect(setup.complete).toBe(true);
    expect(setup.snapshot().session).toBeNull();
    expect(deps.save).toHaveBeenCalledOnce();
    expect(setup.enabled).toEqual(["claude", "codex", "droid"]);
  });
  it("does not accept legacy or malformed preferences, or arbitrary request capabilities", () => {
    const { setup } = fixture();
    setup.restore(undefined);
    expect(setup.complete).toBe(false);
    expect(() => setup.restore({ orchestrationProvider: "claude" })).toThrow();
    expect(() =>
      parseSetupAttempt({ sessionId: crypto.randomUUID(), provider: "claude", command: ["evil"] }),
    ).toThrow();
    expect(() =>
      parseAgentSetupRecord({ version: 1, primary: "claude", enabled: ["claude"], commands: {} }),
    ).toThrow();
  });
  it("keeps existing settings until a successful add or primary commit", async () => {
    const { setup, identity, attempt } = fixture();
    setup.begin({ mode: "primary" });
    await attempt("claude");
    await setup.finish(identity());
    setup.begin({ mode: "add" });
    await attempt("codex");
    expect(setup.enabled).toEqual(["claude"]);
    await setup.abandon(identity());
    expect(setup.enabled).toEqual(["claude"]);
    setup.begin({ mode: "add" });
    await attempt("codex");
    await setup.finish(identity());
    expect(setup.record?.primary).toBe("claude");
    setup.begin({ mode: "primary" });
    await attempt("droid");
    expect(setup.record?.primary).toBe("claude");
    await setup.finish(identity());
    expect(setup.enabled).toEqual(["claude", "codex", "droid"]);
  });
  it("does not persist detection or authentication failures and allows retry", async () => {
    const { setup, deps, identity, attempt } = fixture();
    setup.begin({ mode: "primary" });
    vi.mocked(deps.detect).mockRejectedValueOnce(new Error("not installed"));
    await attempt("claude");
    expect(deps.probe).not.toHaveBeenCalled();
    expect(setup.snapshot().session).toMatchObject({ phase: "failed", detected: false });
    vi.mocked(deps.probe).mockRejectedValueOnce(new Error("ACP authentication required"));
    await attempt("claude");
    expect(setup.snapshot().session).toMatchObject({
      phase: "failed",
      detected: true,
      verified: [],
    });
    await expect(setup.finish(identity())).rejects.toThrow();
    await attempt("claude");
    await setup.finish(identity());
    expect(setup.complete).toBe(true);
  });
  it("retains verified results after preference-write failure and retries atomically", async () => {
    const { setup, deps, identity, attempt } = fixture();
    setup.begin({ mode: "primary" });
    await attempt("claude");
    vi.mocked(deps.save).mockRejectedValueOnce(new Error("disk full"));
    await expect(setup.finish(identity())).rejects.toThrow("disk full");
    expect(setup.complete).toBe(false);
    expect(setup.snapshot().session?.verified).toEqual(["claude"]);
    await setup.finish(identity());
    expect(setup.complete).toBe(true);
  });
  it.each(["detect", "probe"] as const)(
    "cancels %s, excludes stale success and waits for cleanup before another attempt",
    async (stage) => {
      const { setup, deps, identity, attempt } = fixture();
      let release!: () => void;
      deps[stage] = () =>
        new Promise<void>((resolve) => {
          release = resolve;
        });
      setup.begin({ mode: "primary" });
      const pending = attempt("claude");
      await vi.waitFor(() => expect(release).toBeTypeOf("function"));
      const cancellation = setup.cancel(identity());
      await expect(attempt("codex")).rejects.toThrow("already in progress");
      release();
      await pending;
      await cancellation;
      expect(setup.snapshot().session).toMatchObject({
        phase: "select",
        verified: [],
        candidate: null,
      });
      expect(deps.save).not.toHaveBeenCalled();
    },
  );
  it("abandons on dismissal, rejects stale session identities and cannot finish an empty setup", async () => {
    const { setup, identity, attempt } = fixture();
    setup.begin({ mode: "primary" });
    const old = identity();
    await expect(setup.finish(old)).rejects.toThrow();
    await attempt("claude");
    await setup.abandon(old);
    expect(setup.complete).toBe(false);
    setup.begin({ mode: "primary" });
    await expect(setup.finish(old)).rejects.toThrow("no longer current");
  });
  it("invalidates verified commands and rejects a primary change during active work", async () => {
    const { setup, deps, identity, attempt, commands } = fixture();
    setup.begin({ mode: "primary" });
    await attempt("claude");
    commands.claude = ["another-command"];
    await expect(setup.finish(identity())).rejects.toThrow("commands changed");
    await setup.abandon(identity());
    setup.begin({ mode: "primary" });
    await attempt("claude");
    deps.canChangePrimary = () => false;
    await expect(setup.finish(identity())).rejects.toThrow("active orchestration work");
    deps.canChangePrimary = () => true;
    await setup.finish(identity());
    commands.claude = ["changed-again"];
    expect(setup.complete).toBe(false);
    expect(setup.enabled).toEqual([]);
  });
});

async function connectedFixture() {
  const value = fixture();
  value.setup.begin({ mode: "primary" });
  await value.attempt("claude");
  await value.attempt("codex");
  await value.attempt("droid");
  await value.setup.finish(value.identity());
  return value;
}

it("changes primary without probing or losing other memberships, then disconnects only the requested provider", async () => {
  const { setup, deps } = await connectedFixture();
  const old = structuredClone(setup.record);
  const calls = vi.mocked(deps.probe).mock.calls.length;
  await setup.manage({ type: "set-primary", provider: "codex" });
  expect(setup.record).toEqual({ ...old, primary: "codex" });
  expect(vi.mocked(deps.probe).mock.calls).toHaveLength(calls);
  await setup.manage({ type: "disconnect", provider: "claude" });
  expect(setup.record).toMatchObject({ primary: "codex", enabled: ["codex", "droid"] });
  expect(setup.record?.commands).not.toHaveProperty("claude");
  expect(setup.complete).toBe(true);
  const restored = fixture().setup;
  restored.restore(setup.record);
  expect(restored.snapshot()).toMatchObject({
    primary: "codex",
    enabled: ["codex", "droid"],
    session: null,
  });
});

it("rejects stale membership, changed commands, current primary, active work and setup transactions", async () => {
  const { setup, deps, commands, identity } = await connectedFixture();
  const saved = structuredClone(setup.record);
  await expect(setup.manage({ type: "disconnect", provider: "claude" })).rejects.toThrow(
    "Set another provider",
  );
  await expect(setup.manage({ type: "set-primary", provider: "claude" })).rejects.toThrow(
    "already the primary",
  );
  await expect(setup.manage({ type: "set-primary", provider: "kiro" })).rejects.toThrow("verify");
  await expect(setup.manage({ type: "disconnect", provider: "unknown" })).rejects.toThrow("verify");
  deps.canChangePrimary = () => false;
  await expect(setup.manage({ type: "disconnect", provider: "codex" })).rejects.toThrow(
    "active agent work",
  );
  deps.canChangePrimary = () => true;
  setup.begin({ mode: "add" });
  await expect(setup.manage({ type: "set-primary", provider: "codex" })).rejects.toThrow(
    "setup first",
  );
  await setup.abandon(identity());
  commands.codex = ["changed"];
  await expect(setup.manage({ type: "set-primary", provider: "codex" })).rejects.toThrow("verify");
  expect(setup.record).toEqual(saved);
});

it("retains the previous record on save failure and excludes overlapping writes and setup", async () => {
  const { setup, deps } = await connectedFixture();
  const old = structuredClone(setup.record);
  vi.mocked(deps.save).mockRejectedValueOnce(new Error("Cannot save. Retry."));
  await expect(setup.manage({ type: "set-primary", provider: "codex" })).rejects.toThrow("Retry");
  expect(setup.record).toEqual(old);
  let release!: () => void;
  vi.mocked(deps.save).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const pending = setup.manage({ type: "set-primary", provider: "codex" });
  await expect(setup.manage({ type: "disconnect", provider: "droid" })).rejects.toThrow("Wait");
  expect(() => setup.begin({ mode: "add" })).toThrow("Wait");
  expect(setup.record).toEqual(old);
  release();
  await pending;
  expect(setup.record?.primary).toBe("codex");
});

function codexFixture() {
  const f = fixture();
  const provider = PROVIDERS.find((value) => value.id === "codex");
  if (!provider) throw new Error("Codex fixture missing");
  f.commands.codex = provider.command;
  let installed = false;
  let authenticated = false;
  let finishLogin: () => void = () => {};
  f.deps.detect = vi.fn(async () => {
    if (!installed) throw new ProviderMissingError("Codex");
  });
  f.deps.probe = vi.fn(async () => {
    if (!authenticated)
      throw Object.assign(new Error("private auth error"), { authRequired: true });
  });
  f.deps.codex = {
    install: vi.fn(async () => {
      installed = true;
    }),
    login: vi.fn(async (_signal, challenge) => {
      challenge({ verificationUrl: "https://auth.openai.com/codex/device", userCode: "ABCD-1234" });
      await new Promise<void>((resolve) => {
        finishLogin = resolve;
      });
      authenticated = true;
    }),
    cleanup: vi.fn(async () => {}),
  };
  f.setup.begin({ mode: "primary" });
  return {
    ...f,
    finishLogin: () => finishLogin(),
    installed: () => {
      installed = true;
    },
    authenticated: () => {
      installed = true;
      authenticated = true;
    },
  };
}
it("owns install/login challenges privately and verifies ACP before saving v1 membership", async () => {
  const f = codexFixture();
  await f.attempt("codex");
  expect(f.setup.snapshot().session).toMatchObject({
    codexAction: "install",
    failureReason: "missing",
  });
  const started = f.setup.startCodex(f.identity(), "page-a", true);
  const address = { ...f.identity(), ...started };
  await vi.waitFor(() =>
    expect(f.setup.readCodex(address, "page-a").challenge?.userCode).toBe("ABCD-1234"),
  );
  expect(JSON.stringify(f.setup.snapshot())).not.toContain("ABCD-1234");
  expect(JSON.stringify(f.setup.snapshot())).not.toContain("https://auth.openai.com");
  expect(() => f.setup.readCodex(address, "page-b")).toThrow("no longer current");
  expect(() => f.setup.readCodex({ ...address, attemptId: crypto.randomUUID() }, "page-a")).toThrow(
    "no longer current",
  );
  expect(() => f.setup.startCodex(f.identity(), "page-a", true)).toThrow();
  expect(f.deps.save).not.toHaveBeenCalled();
  f.finishLogin();
  await vi.waitFor(() => expect(f.setup.snapshot().session?.phase).toBe("success"));
  expect(f.setup.readCodex(address, "page-a").challenge).toBeNull();
  await f.setup.finish(f.identity());
  expect(f.setup.record).toMatchObject({ version: 1, primary: "codex", enabled: ["codex"] });
  expect(JSON.stringify(f.setup.record)).not.toContain("ABCD-1234");
});
it("cancels login, waits for owned cleanup and ignores late success", async () => {
  const f = codexFixture();
  f.installed();
  await f.attempt("codex");
  expect(f.setup.snapshot().session?.codexAction).toBe("login");
  const started = f.setup.startCodex(f.identity(), "page-a", false);
  const address = { ...f.identity(), ...started };
  await vi.waitFor(() => expect(f.setup.readCodex(address, "page-a").challenge).not.toBeNull());
  await expect(f.setup.cancelCodex(address, "page-b")).rejects.toThrow("no longer current");
  const cancelled = f.setup.cancelCodex(address, "page-a");
  f.finishLogin();
  await cancelled;
  expect(f.setup.snapshot().session).toMatchObject({ phase: "select", verified: [] });
  expect(f.deps.codex?.cleanup).toHaveBeenCalled();
  expect(f.deps.save).not.toHaveBeenCalled();
  expect(() => f.setup.readCodex(address, "page-a")).toThrow();
});
it("reuses an existing login and preserves manual setup for custom commands", async () => {
  const f = codexFixture();
  f.authenticated();
  await f.attempt("codex");
  expect(f.setup.snapshot().session?.phase).toBe("success");
  expect(f.deps.codex?.install).not.toHaveBeenCalled();
  expect(f.deps.codex?.login).not.toHaveBeenCalled();
  const custom = codexFixture();
  custom.commands.codex = ["/custom/adapter"];
  await custom.attempt("codex");
  expect(custom.setup.snapshot().session?.codexAction).toBeUndefined();
  expect(() => custom.setup.startCodex(custom.identity(), "page", true)).toThrow("unavailable");
});
it("offers compatible installation for unsupported login and never grants connection on login failure", async () => {
  const f = codexFixture();
  f.installed();
  await f.attempt("codex");
  if (!f.deps.codex) throw new Error("Missing fixture authentication");
  f.deps.codex.login = vi.fn(async () => {
    throw new CodexSetupError("unsupported");
  });
  const { attemptId } = f.setup.startCodex(f.identity(), "page", false);
  await vi.waitFor(() =>
    expect(f.setup.snapshot().session).toMatchObject({
      phase: "failed",
      codexAction: "install",
      failureReason: "unsupported",
    }),
  );
  expect(f.setup.readCodex({ ...f.identity(), attemptId }, "page").challenge).toBeNull();
  await expect(f.setup.finish(f.identity())).rejects.toThrow();
});
it("rejects new attempts while cancellation drains and coalesces repeated cancellation", async () => {
  const f = codexFixture();
  await f.attempt("codex");
  const hooks = f.deps.codex;
  if (!hooks) throw new Error("Missing authentication fixture");
  let release: () => void = () => {};
  hooks.cleanup = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const first = f.setup.cancel(f.identity());
  const second = f.setup.cancel(f.identity());
  expect(() => f.setup.startCodex(f.identity(), "page", true)).toThrow("cleanup");
  await expect(f.attempt("codex")).rejects.toThrow("cleanup");
  expect(() => f.setup.begin({ mode: "primary" })).toThrow("cleanup");
  await vi.waitFor(() => expect(hooks.cleanup).toHaveBeenCalledOnce());
  expect(hooks.install).not.toHaveBeenCalled();
  release();
  await Promise.all([first, second]);
  expect(f.setup.snapshot().session?.phase).toBe("select");
  await f.attempt("codex");
  expect(f.setup.snapshot().session?.codexAction).toBe("install");
});
it("offers the compatible copy when an installed CLI cannot open ACP, without echoing provider output", async () => {
  const f = codexFixture();
  f.installed();
  f.deps.probe = vi.fn(async () => {
    throw new Error("PRIVATE_UNSUPPORTED_CLI_OUTPUT");
  });
  await f.attempt("codex");
  expect(f.setup.snapshot().session).toMatchObject({
    phase: "failed",
    detected: true,
    failureReason: "connection",
    codexAction: "install",
  });
  expect(JSON.stringify(f.setup.snapshot())).not.toContain("PRIVATE_UNSUPPORTED");
  expect(f.deps.codex?.install).not.toHaveBeenCalled();
  expect(f.deps.save).not.toHaveBeenCalled();
});
