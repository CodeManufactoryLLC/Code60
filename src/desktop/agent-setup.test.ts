import { describe, expect, it, vi } from "vitest";
import { parseAgentSetupRecord, parseSetupAttempt } from "../bridge/index.js";
import { AgentSetup, type SetupDependencies } from "./agent-setup.js";

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
    expect(setup.enabled).toEqual(["droid"]);
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
