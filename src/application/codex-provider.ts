import { constants } from "node:fs";
import { access, lstat, mkdtemp, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import { delimiter, join } from "node:path";
import type { CodexChallenge } from "../bridge/index.js";
import type { CoreDeps } from "../core/index.js";
import {
  type OwnedProcess,
  privateDirectory,
  spawnOwnedProcess,
  userHome,
  verifyPrivatePath,
} from "../platform/index.js";
import { CodexSetupError, loginCodex } from "./codex-login.js";
import { commandIdentity, PROVIDERS } from "./provider-catalog.js";

export const MANAGED_CODEX_VERSION = "0.171.0";
export async function prepareCodexEnvironment(env: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> {
  return createCodexProvider(env).environment();
}
/** Apply the ACP adapter's documented override only to the standard Codex command. */
export function codexProviderAgents(
  agents: CoreDeps["agents"],
  env: NodeJS.ProcessEnv,
): CoreDeps["agents"] {
  const provider = createCodexProvider(env);
  const prepare = async (spec: Parameters<CoreDeps["agents"]["start"]>[0]) => {
    if (
      spec.name !== "codex" ||
      env.CODEX_PATH ||
      spec.env?.CODEX_PATH ||
      commandIdentity(spec.command) !==
        commandIdentity(PROVIDERS.find((p) => p.id === "codex")?.command ?? [])
    )
      return spec;
    const current = await provider.executable().catch(() => null);
    if (!current) return spec;
    return {
      ...spec,
      env: Object.fromEntries(
        Object.entries({
          ...current.env,
          ...spec.env,
          PATH: current.env.PATH,
          CODEX_PATH: current.file,
        }).filter((entry): entry is [string, string] => entry[1] !== undefined),
      ),
    };
  };
  const restore = agents.restore?.bind(agents);
  return {
    start: async (spec, signal) => agents.start(await prepare(spec), signal),
    ...(restore
      ? {
          restore: async (spec: Parameters<typeof restore>[0], id: string, signal?: AbortSignal) =>
            restore(await prepare(spec), id, signal),
        }
      : {}),
  };
}
export function managedCodexDirectory(env: NodeJS.ProcessEnv): string {
  return join(
    userHome(env),
    ".local",
    "share",
    "code60",
    "providers",
    "codex",
    MANAGED_CODEX_VERSION,
  );
}

/** Private provider policy. Browser callers cannot select a package, command or location. */
export function createCodexProvider(
  env: NodeJS.ProcessEnv,
  options: { spawn?: typeof spawnOwnedProcess; installMs?: number } = {},
) {
  const processes = new Set<OwnedProcess>();
  const stagingPaths = new Set<string>();
  const spawn: typeof spawnOwnedProcess = async (...args) => {
    const child = await (options.spawn ?? spawnOwnedProcess)(...args);
    processes.add(child);
    return child;
  };
  const release = async (child: OwnedProcess) => {
    await child.stop(1_000);
    processes.delete(child);
  };
  const cleanup = async () => {
    for (const child of processes) {
      await child.stop(0);
      processes.delete(child);
    }
    for (const path of stagingPaths) {
      await rm(path, { recursive: true, force: true });
      stagingPaths.delete(path);
    }
  };
  const directory = managedCodexDirectory(env);
  const validManaged = async () => {
    try {
      await verifyPrivatePath(directory, true);
      const bin = join(directory, "bin", "codex");
      const target = await realpath(bin);
      if (!target.startsWith(`${await realpath(directory)}/`) || !(await stat(target)).isFile())
        return false;
      await access(bin, constants.X_OK);
      const pkg = JSON.parse(
        await readFile(join(directory, "lib/node_modules/@openai/codex/package.json"), "utf8"),
      );
      return pkg.name === "@openai/codex" && pkg.version === MANAGED_CODEX_VERSION;
    } catch {
      return false;
    }
  };
  const environment = async (): Promise<NodeJS.ProcessEnv> => {
    const base = {
      ...env,
      PATH: (env.PATH ?? "")
        .split(delimiter)
        .filter((path) => path !== join(directory, "bin"))
        .join(delimiter),
    };
    if (!(await validManaged())) return base;
    return { ...base, PATH: [join(directory, "bin"), base.PATH].join(delimiter) };
  };
  const executable = async (): Promise<{ file: string; env: NodeJS.ProcessEnv }> => {
    const current = await environment();
    for (const path of (current.PATH ?? "")
      .split(delimiter)
      .filter((path) => path.startsWith("/"))) {
      const file = join(path, "codex");
      try {
        if ((await stat(file)).isFile()) {
          await access(file, constants.X_OK);
          return { file, env: current };
        }
      } catch {}
    }
    throw new CodexSetupError("missing");
  };
  const install = async (signal: AbortSignal) => {
    await cleanup();
    signal.throwIfAborted();
    if (process.getuid?.() === 0) throw new CodexSetupError("install");
    if (await validManaged()) return;
    const parent = join(directory, "..");
    // Check each private managed component; never redirect installation through a symlink.
    let path = userHome(env);
    for (const component of [".local", "share", "code60", "providers", "codex"]) {
      path = join(path, component);
      await privateDirectory(path);
      const info = await lstat(path);
      if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== (process.getuid?.() ?? -1))
        throw new CodexSetupError("install");
    }
    await verifyPrivatePath(parent, true);
    try {
      await lstat(directory);
      throw new CodexSetupError("install");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const staging = await mkdtemp(join(parent, ".install-"));
    stagingPaths.add(staging);
    let child: OwnedProcess | undefined;
    const timeout = AbortSignal.timeout(options.installMs ?? 10 * 60_000);
    const combined = AbortSignal.any([signal, timeout]);
    let interrupt: (() => void) | undefined;
    const interrupted = new Promise<never>((_, reject) => {
      interrupt = () => reject(new CodexSetupError(timeout.aborted ? "timeout" : "install"));
    });
    let outcome: Error | undefined;
    let clean = true;
    try {
      child = await spawn(
        [
          "npm",
          "install",
          "--global",
          "--prefix",
          staging,
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
          "--registry",
          "https://registry.npmjs.org",
          `@openai/codex@${MANAGED_CODEX_VERSION}`,
        ],
        staging,
        {
          ...Object.fromEntries(Object.entries(env).filter(([key]) => !/^npm_config_/i.test(key))),
          NPM_CONFIG_USERCONFIG: join(staging, ".npmrc-user"),
          NPM_CONFIG_GLOBALCONFIG: join(staging, ".npmrc-global"),
        },
      );
      child.stdout.resume();
      child.stderr.resume();
      const stop = interrupt as () => void;
      combined.addEventListener("abort", stop, { once: true });
      if (combined.aborted) stop();
      const result = await Promise.race([child.exited, interrupted]);
      combined.throwIfAborted();
      if (result.code !== 0) throw new CodexSetupError("install");
      try {
        await release(child);
        child = undefined;
      } catch {
        throw new CodexSetupError("cleanup");
      }
      combined.throwIfAborted();
      // Verify staged layout before publishing; never overwrite a pre-existing installation.
      const pkg = JSON.parse(
        await readFile(join(staging, "lib/node_modules/@openai/codex/package.json"), "utf8"),
      );
      const bin = await realpath(join(staging, "bin/codex"));
      if (
        pkg.name !== "@openai/codex" ||
        pkg.version !== MANAGED_CODEX_VERSION ||
        !bin.startsWith(`${await realpath(staging)}/`)
      )
        throw new CodexSetupError("install");
      await access(bin, constants.X_OK);
      if (!(await stat(bin)).isFile()) throw new CodexSetupError("install");
      combined.throwIfAborted();
      try {
        await rename(staging, directory);
      } catch (error) {
        if (!(await validManaged())) throw error;
      }
    } catch (error) {
      outcome = error instanceof CodexSetupError ? error : new CodexSetupError("install");
    } finally {
      if (interrupt) combined.removeEventListener("abort", interrupt);
      if (child) {
        try {
          await release(child);
        } catch {
          clean = false;
          outcome = new CodexSetupError("cleanup");
        }
      }
      if (clean) {
        try {
          await rm(staging, { recursive: true, force: true });
          stagingPaths.delete(staging);
        } catch {
          outcome = new CodexSetupError("cleanup");
        }
      }
    }
    if (outcome) throw outcome;
  };
  const login = async (signal: AbortSignal, challenge: (value: CodexChallenge) => void) => {
    await cleanup();
    signal.throwIfAborted();
    const current = await executable();
    await loginCodex(current.file, userHome(env), current.env, signal, challenge, {
      spawn,
      release,
    });
  };
  return { environment, install, login, cleanup, executable, supported: !env.CODEX_PATH };
}
