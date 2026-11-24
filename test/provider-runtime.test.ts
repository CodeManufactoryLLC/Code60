import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  createProviderRuntime,
  managedProviderDirectory,
  providerAgents,
} from "../src/application/provider-runtime.js";
import { loginMethods } from "../src/application/provider-setup-policy.js";
import type { ProviderLoginChallenge, SetupProviderId } from "../src/bridge/index.js";
import { syntheticProviderDownload } from "./fixtures/provider-artifacts.js";

const homes: string[] = [];
afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true });
});
async function fixture() {
  const HOME = await realpath(await mkdtemp(join(tmpdir(), "code60-provider-runtime-")));
  homes.push(HOME);
  const tools = join(HOME, "tools");
  const log = join(HOME, "processes");
  await mkdir(tools);
  await mkdir(log);
  await symlink(process.execPath, join(tools, "node"));
  await symlink(resolve("test/fixtures/fake-provider-tools.mjs"), join(tools, "npm"));
  const env = {
    HOME,
    PATH: `${tools}:/usr/bin:/bin`,
    CODE60_QA_REPO: resolve("."),
    CODE60_QA_PROCESS_LOG: log,
  };
  const download = vi.fn(syntheticProviderDownload);
  const runtime = createProviderRuntime(env, { download });
  return { HOME, env, runtime, download };
}
it.each(["antigravity", "claude", "copilot", "droid", "kiro", "opencode"] as SetupProviderId[])(
  "installs %s privately and signs in using only its owned fixed login flow",
  async (id) => {
    const f = await fixture();
    const policy = f.runtime.policies[id];
    expect(policy).toBeDefined();
    await expect(f.runtime.executable(id)).rejects.toMatchObject({ reason: "missing" });
    await policy?.install(new AbortController().signal);
    expect(await f.runtime.valid(id)).toBe(true);
    expect((await f.runtime.environment(id)).PATH).toContain(managedProviderDirectory(f.env, id));
    const count = f.download.mock.calls.length;
    await policy?.install(new AbortController().signal);
    expect(f.download.mock.calls).toHaveLength(count);
    if (id === "copilot") await writeFile(join(f.HOME, "no-keychain"), "1");
    const challenges: (ProviderLoginChallenge | null)[] = [];
    await policy?.login({
      signal: new AbortController().signal,
      method: loginMethods[id][0] ?? "default",
      challenge: (challenge) => {
        challenges.push(challenge);
        if (challenge) void writeFile(join(f.HOME, `authorize-${id}`), "1");
      },
      input: async (challenge) => {
        challenges.push(challenge);
        return challenge.kind === "confirmation"
          ? { kind: "confirmation", accepted: true }
          : { kind: "code", code: "QA60-PASTE" };
      },
    });
    expect(challenges.some((challenge) => !!challenge)).toBe(true);
    expect((await readdir(f.HOME)).filter((name) => name.startsWith(".code60-"))).toEqual([]);
    for (const file of await readdir(join(f.HOME, "processes"))) {
      const { pid } = JSON.parse(await readFile(join(f.HOME, "processes", file), "utf8"));
      expect(() => process.kill(pid, 0)).toThrow();
    }
  },
);
it("preserves external files, rejects symlinked storage and removes failed activation staging", async () => {
  const f = await fixture();
  const path = managedProviderDirectory(f.env, "copilot");
  await mkdir(path, { recursive: true });
  await writeFile(join(path, "keep"), "untouched");
  await expect(f.runtime.policies.copilot?.install(new AbortController().signal)).rejects.toThrow();
  expect(await readFile(join(path, "keep"), "utf8")).toBe("untouched");
  const g = await fixture();
  await symlink(f.HOME, join(g.HOME, ".local"));
  await expect(g.runtime.policies.kiro?.install(new AbortController().signal)).rejects.toThrow();
  const h = await fixture();
  const bad = createProviderRuntime(h.env, {
    download: async () => {
      throw new Error("PRIVATE_ERROR");
    },
  });
  await expect(bad.policies.droid?.install(new AbortController().signal)).rejects.toMatchObject({
    reason: "install",
  });
  expect(await readdir(join(managedProviderDirectory(h.env, "droid"), ".."))).toEqual([]);
});
it("uses managed tools for standard execution/restore and preserves explicit overrides and command identity", async () => {
  const f = await fixture();
  await f.runtime.policies.claude?.install(new AbortController().signal);
  const start = vi.fn(async (..._args: unknown[]) => ({}));
  const restore = vi.fn(async (..._args: unknown[]) => ({}));
  const agents = providerAgents({ start, restore } as never, f.env);
  const spec = {
    name: "claude",
    command: ["npx", "-y", "@agentclientprotocol/claude-agent-acp"],
    cwd: f.HOME,
  } as const;
  await agents.start(spec);
  expect(start.mock.calls[0]?.[0]).toMatchObject({
    env: { CLAUDE_CODE_EXECUTABLE: expect.stringContaining("/providers/claude/") },
  });
  await agents.restore?.(spec, "existing");
  expect(restore.mock.calls[0]?.[1]).toBe("existing");
  await agents.start({ ...spec, command: ["custom"] });
  expect(start.mock.calls.at(-1)?.[0]).toMatchObject({ command: ["custom"] });
  await agents.start({ ...spec, env: { CLAUDE_CODE_EXECUTABLE: "/custom/claude" } });
  expect(start.mock.calls.at(-1)?.[0]).toMatchObject({ command: spec.command });
  await f.runtime.policies.copilot?.install(new AbortController().signal);
  await agents.start({ name: "copilot", command: ["copilot", "--acp", "--stdio"], cwd: f.HOME });
  expect(start.mock.calls.at(-1)?.[0]).toMatchObject({ env: { COPILOT_AUTO_UPDATE: "false" } });
  expect(spec.command[0]).toBe("npx");
});
it("bounds cancelled installs and refuses incompatible installed login versions", async () => {
  const f = await fixture();
  const abort = new AbortController();
  abort.abort();
  await expect(f.runtime.policies.copilot?.install(abort.signal)).rejects.toThrow();
  await writeFile(join(f.HOME, "tools/copilot"), "#!/usr/bin/env node\nconsole.log('0.0.1')\n", {
    mode: 0o700,
  });
  await expect(
    f.runtime.policies.copilot?.login({
      signal: new AbortController().signal,
      method: "default",
      challenge: () => {},
      input: vi.fn(),
    }),
  ).rejects.toMatchObject({ reason: "unsupported" });
});
it("retains uncertain resources after failed cleanup and retries only its own staging", async () => {
  const { PassThrough } = await import("node:stream");
  const f = await fixture();
  const stop = vi.fn(async () => {});
  stop.mockRejectedValueOnce(new Error("PRIVATE_PROCESS_ERROR"));
  const child = {
    pid: 1,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exited: new Promise<{ code: number; signal: null }>(() => {}),
    hasExited: () => false,
    stop,
  };
  const abort = new AbortController();
  const spawn = vi.fn(async () => {
    // Cancel only after the owned child exists: filesystem/archive work can
    // legitimately outlast a short wall-clock deadline under coverage.
    abort.abort();
    return child;
  });
  const runtime = createProviderRuntime(f.env, {
    download: syntheticProviderDownload,
    spawn,
  });
  await expect(runtime.policies.claude?.install(abort.signal)).rejects.toMatchObject({
    reason: "cleanup",
  });
  expect(spawn).toHaveBeenCalledOnce();
  const parent = join(managedProviderDirectory(f.env, "claude"), "..");
  expect((await readdir(parent)).some((name) => name.startsWith(".install-"))).toBe(true);
  await runtime.policies.claude?.cleanup();
  expect(await readdir(parent)).toEqual([]);
  expect(stop).toHaveBeenCalledTimes(2);
});
