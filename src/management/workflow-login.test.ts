import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { workflowLogin } from "./workflow-login.js";

beforeEach(() => vi.stubGlobal("process", { ...process, platform: "darwin", arch: "arm64" }));
afterEach(() => vi.unstubAllGlobals());
function fixture() {
  const deadline = new AbortController();
  let interrupt: (() => void) | undefined;
  let terminate: (() => void) | undefined;
  let hangup: (() => void) | undefined;
  const remove = vi.fn();
  const ports = {
    interactive: true,
    runtime: vi.fn(async () => ({
      root: "/private/cache/engine ' space",
      node: "/recorded/node",
      codex: "/private/cache/native/codex",
    })),
    probe: vi.fn(async () => ({ version: "24.22.0", executable: "/recorded/node" })),
    run: vi.fn(
      async (
        _node: string,
        _args: readonly string[],
        _env: NodeJS.ProcessEnv,
        _signal: AbortSignal,
      ) => 0,
    ),
    deadline: () => deadline.signal,
    listen: vi.fn((onInterrupt: () => void, onTerminate: () => void, onHangup: () => void) => {
      interrupt = onInterrupt;
      terminate = onTerminate;
      hangup = onHangup;
      return remove;
    }),
  };
  return {
    ports,
    deadline,
    remove,
    interrupt: () => interrupt?.(),
    terminate: () => terminate?.(),
    hangup: () => hangup?.(),
  };
}
it.each([[], ["status"], ["login", "--yes"], ["login", "--with-api-key", "untrusted"]])(
  "rejects unsupported login arguments before side effects: %j",
  async (...args: string[]) => {
    const f = fixture();
    await expect(workflowLogin(args, {}, f.ports)).rejects.toThrow("Use code60 workflows login");
    expect(f.ports.runtime).not.toHaveBeenCalled();
    expect(f.ports.listen).not.toHaveBeenCalled();
  },
);
it("refuses non-interactive authentication without looking up or starting an engine", async () => {
  const f = fixture();
  f.ports.interactive = false;
  await expect(workflowLogin(["login"], {}, f.ports)).rejects.toThrow("interactive terminal");
  expect(f.ports.runtime).not.toHaveBeenCalled();
  expect(f.ports.run).not.toHaveBeenCalled();
});
it("rejects a relative Codex home before authentication or signal subscriptions", async () => {
  const f = fixture();
  await expect(workflowLogin(["login"], { CODEX_HOME: "relative" }, f.ports)).rejects.toThrow(
    "absolute",
  );
  expect(f.ports.runtime).not.toHaveBeenCalled();
  expect(f.ports.listen).not.toHaveBeenCalled();
});
it("launches only the cached Codex login with arguments intact and sanitized Node/npm environment", async () => {
  const f = fixture();
  const env = {
    HOME: "/private/home",
    CODEX_HOME: "/private/workflow credentials",
    PATH: "/normal/path",
    NODE_OPTIONS: "poison",
    NODE_PATH: "poison",
    npm_config_registry: "poison",
    CODEX_PATH: "/unwanted/application/codex",
  };
  f.ports.run.mockResolvedValue(7);
  expect(await workflowLogin(["login"], env, f.ports)).toBe(7);
  expect(f.ports.run).toHaveBeenCalledWith(
    "/recorded/node",
    ["/private/cache/engine ' space/node_modules/@openai/codex/bin/codex.js", "login"],
    {
      HOME: env.HOME,
      CODEX_HOME: env.CODEX_HOME,
      PATH: env.PATH,
      CODEX_PATH: "/private/cache/native/codex",
    },
    expect.any(AbortSignal),
  );
  expect(env.NODE_OPTIONS).toBe("poison");
  expect(f.remove).toHaveBeenCalledOnce();
});
it.each(["22.0.0", "24.21.0", "25.0.0"])(
  "refuses incompatible recorded Node %s before authentication",
  async (version) => {
    const f = fixture();
    f.ports.probe.mockResolvedValue({ version, executable: "/recorded/node" });
    await expect(workflowLogin(["login"], {}, f.ports)).rejects.toThrow("recorded Node");
    expect(f.ports.run).not.toHaveBeenCalled();
    expect(f.remove).toHaveBeenCalledOnce();
  },
);
it("refuses a different Node identity and preserves missing/damaged bindings", async () => {
  const f = fixture();
  f.ports.probe.mockResolvedValue({ version: "24.22.0", executable: "/other/node" });
  await expect(workflowLogin(["login"], {}, f.ports)).rejects.toThrow("runtime binding");
  f.ports.runtime.mockRejectedValue(new Error("Damaged runtime binding"));
  await expect(workflowLogin(["login"], {}, f.ports)).rejects.toThrow("Damaged runtime binding");
  expect(f.ports.run).not.toHaveBeenCalled();
});
it.each([
  ["interrupt", 130],
  ["terminate", 143],
  ["hangup", 129],
] as const)("retains child ownership through %s and propagates exit %d", async (action, code) => {
  const f = fixture();
  f.ports.run.mockImplementation(async (_node, _args, _env, signal) => {
    f[action]();
    expect(signal.aborted).toBe(true);
    return 1;
  });
  expect(await workflowLogin(["login"], {}, f.ports)).toBe(code);
  expect(f.remove).toHaveBeenCalledOnce();
});
it("bounds authentication and reports timeout after the child settles", async () => {
  const f = fixture();
  f.ports.run.mockImplementation(async (_node, _args, _env, signal) => {
    f.deadline.abort();
    expect(signal.aborted).toBe(true);
    return 143;
  });
  await expect(workflowLogin(["login"], {}, f.ports)).rejects.toThrow("timed out");
  expect(f.remove).toHaveBeenCalledOnce();
});
it("rejects Linux before touching bindings", async () => {
  vi.stubGlobal("process", { ...process, platform: "linux", arch: "x64" });
  const f = fixture();
  await expect(workflowLogin(["login"], {}, f.ports)).rejects.toThrow("macOS Apple Silicon");
  expect(f.ports.runtime).not.toHaveBeenCalled();
});
