import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import type { OwnedProcess } from "../platform/index.js";
import {
  createCodexProvider,
  MANAGED_CODEX_VERSION,
  managedCodexDirectory,
} from "./codex-provider.js";

const homes: string[] = [];
afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true });
});
async function fixture(fail = false) {
  const HOME = await realpath(await mkdtemp(join(tmpdir(), "code60-managed-codex-")));
  homes.push(HOME);
  const env = { HOME, PATH: "/usr/bin:/bin" };
  const children: OwnedProcess[] = [];
  const spawn = vi.fn(async (command: readonly [string, ...string[]]) => {
    const prefix = command[command.indexOf("--prefix") + 1];
    if (!prefix) throw new Error("Missing fixture prefix");
    await mkdir(join(prefix, "bin"), { recursive: true });
    await mkdir(join(prefix, "lib/node_modules/@openai/codex"), { recursive: true });
    await writeFile(
      join(prefix, "lib/node_modules/@openai/codex/package.json"),
      JSON.stringify({ name: "@openai/codex", version: MANAGED_CODEX_VERSION }),
    );
    await writeFile(
      join(prefix, "lib/node_modules/@openai/codex/cli.mjs"),
      "#!/usr/bin/env node\n",
      { mode: 0o700 },
    );
    await symlink("../lib/node_modules/@openai/codex/cli.mjs", join(prefix, "bin/codex"));
    const child: OwnedProcess = {
      pid: 1,
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      exited: Promise.resolve({ code: fail ? 7 : 0, signal: null }),
      hasExited: () => true,
      stop: vi.fn(async () => {}),
    };
    children.push(child);
    return child;
  });
  return { HOME, env, spawn, children, provider: createCodexProvider(env, { spawn }) };
}
it("installs only the pinned package privately, activates atomically and reuses it", async () => {
  const f = await fixture();
  await f.provider.install(new AbortController().signal);
  const command = f.spawn.mock.calls[0]?.[0];
  expect(command).toContain(`@openai/codex@${MANAGED_CODEX_VERSION}`);
  expect(command).toContain("--ignore-scripts");
  expect(command).toContain("https://registry.npmjs.org");
  expect((await f.provider.environment()).PATH?.split(":")[0]).toBe(
    join(managedCodexDirectory(f.env), "bin"),
  );
  await f.provider.install(new AbortController().signal);
  expect(f.spawn).toHaveBeenCalledOnce();
  expect(f.children[0]?.stop).toHaveBeenCalled();
  expect(f.env.PATH).toBe("/usr/bin:/bin");
});
it("preserves existing installations and removes only failed staging data", async () => {
  const f = await fixture(true);
  await expect(f.provider.install(new AbortController().signal)).rejects.toMatchObject({
    reason: "install",
  });
  expect((await f.provider.environment()).PATH).toBe(f.env.PATH);
  await mkdir(managedCodexDirectory(f.env));
  await writeFile(join(managedCodexDirectory(f.env), "keep"), "existing");
  await expect(f.provider.install(new AbortController().signal)).rejects.toThrow();
  expect(await readFile(join(managedCodexDirectory(f.env), "keep"), "utf8")).toBe("existing");
});
it("rejects redirected managed storage and missing CLIs", async () => {
  const f = await fixture();
  await mkdir(join(f.HOME, "elsewhere"));
  await symlink(join(f.HOME, "elsewhere"), join(f.HOME, ".local"));
  await expect(f.provider.install(new AbortController().signal)).rejects.toThrow();
  expect(f.spawn).not.toHaveBeenCalled();
  const empty = await fixture();
  await expect(empty.provider.login(new AbortController().signal, () => {})).rejects.toMatchObject({
    reason: "missing",
  });
});
it.each(["cancel", "timeout"])(
  "bounds %s even when npm never exits and preserves the old CLI",
  async (mode) => {
    const f = await fixture();
    const old = join(f.HOME, "old-bin");
    await mkdir(old);
    await writeFile(join(old, "codex"), "existing executable", { mode: 0o700 });
    const child: OwnedProcess = {
      pid: 1,
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      exited: new Promise(() => {}),
      hasExited: () => false,
      stop: vi.fn(async () => {}),
    };
    let ready: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const spawn = vi.fn(async () => {
      ready();
      return child;
    });
    const provider = createCodexProvider(
      { ...f.env, PATH: old, NPM_CONFIG_REGISTRY: "https://untrusted.invalid" },
      { spawn, installMs: 20 },
    );
    const abort = new AbortController();
    const done = provider.install(abort.signal).catch((error: unknown) => error);
    if (mode === "cancel") {
      await started;
      abort.abort();
    }
    expect(await done).toMatchObject({ reason: mode === "timeout" ? "timeout" : "install" });
    expect(child.stop).toHaveBeenCalled();
    expect(await readFile(join(old, "codex"), "utf8")).toBe("existing executable");
  },
);
it("selects the same executable for standard ACP start and restore without altering custom launches", async () => {
  const f = await fixture();
  await f.provider.install(new AbortController().signal);
  const { codexProviderAgents } = await import("./codex-provider.js");
  const { PROVIDERS } = await import("./provider-catalog.js");
  const command = PROVIDERS.find((provider) => provider.id === "codex")?.command;
  if (!command) throw new Error("Missing standard command");
  const start = vi.fn(
    async (_spec: { command: readonly string[]; env?: Readonly<Record<string, string>> }) => {
      throw new Error("fixture");
    },
  );
  const restore = vi.fn(async (...args: unknown[]) => {
    void args;
    throw new Error("fixture");
  });
  const agents = codexProviderAgents({ start, restore }, f.env);
  const spec = { name: "codex", command, cwd: f.HOME };
  await expect(agents.start(spec)).rejects.toThrow("fixture");
  expect(start.mock.calls[0]?.[0].env?.CODEX_PATH).toBe(
    join(managedCodexDirectory(f.env), "bin/codex"),
  );
  await expect(agents.restore?.(spec, "session")).rejects.toThrow("fixture");
  expect(restore.mock.calls[0]?.[0]).toMatchObject({
    env: { CODEX_PATH: join(managedCodexDirectory(f.env), "bin/codex") },
  });
  const custom = { ...spec, command: ["/custom/codex"] as const };
  await expect(agents.start(custom)).rejects.toThrow("fixture");
  expect(start.mock.calls.at(-1)?.[0]).toBe(custom);
  const configured = codexProviderAgents({ start }, { ...f.env, CODEX_PATH: "/custom/codex" });
  await expect(configured.start(spec)).rejects.toThrow("fixture");
  expect(start.mock.calls.at(-1)?.[0]).toBe(spec);
});
