import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  lstat,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { delimiter, join } from "node:path";
import type { SetupProviderId } from "../bridge/index.js";
import type { CoreDeps } from "../core/index.js";
import {
  type OwnedProcess,
  privateDirectory,
  spawnOwnedProcess,
  userHome,
  verifyPrivatePath,
} from "../platform/index.js";
import { codexProviderAgents } from "./codex-provider.js";
import { downloadProviderArtifact, extractProviderArchive } from "./provider-archive.js";
import { PROVIDER_RELEASES } from "./provider-artifacts.js";
import { commandIdentity, PROVIDERS } from "./provider-catalog.js";
import { loginProviderCli, type ProviderSpawn } from "./provider-cli-login.js";
import { loginDroid, loginOpenCode } from "./provider-protocol-login.js";
import { ProviderSetupError, type ProviderSetupPolicy } from "./provider-setup-policy.js";

const executableNames: Record<string, string> = {
  antigravity: "agy",
  claude: "claude",
  copilot: "copilot",
  droid: "droid",
  kiro: "kiro-cli",
  opencode: "opencode",
};
const updateEnvironment: Record<string, Record<string, string>> = {
  claude: { DISABLE_AUTOUPDATER: "1" },
  antigravity: { AGY_CLI_DISABLE_AUTO_UPDATE: "true" },
  copilot: { COPILOT_AUTO_UPDATE: "false" },
  droid: { FACTORY_DROID_AUTO_UPDATE_ENABLED: "false", DROID_DISABLE_AUTO_UPDATE: "true" },
  opencode: { OPENCODE_DISABLE_AUTOUPDATE: "1" },
};
const overrideKeys: Record<string, readonly string[]> = {
  claude: ["CLAUDE_CODE_EXECUTABLE"],
  antigravity: [],
  copilot: ["COPILOT_GH_HOST"],
  droid: [],
  kiro: [],
  opencode: [],
};
export const managedProviderDirectory = (env: NodeJS.ProcessEnv, id: string) =>
  join(
    userHome(env),
    ".local",
    "share",
    "code60",
    "providers",
    id,
    PROVIDER_RELEASES[id]?.version ?? "unknown",
  );
export function createProviderRuntime(
  env: NodeJS.ProcessEnv,
  options: {
    spawn?: ProviderSpawn;
    fetch?: typeof fetch | undefined;
    download?: typeof downloadProviderArtifact | undefined;
    installMs?: number;
    loginMs?: number;
  } = {},
) {
  const children = new Set<OwnedProcess>();
  const staging = new Set<string>();
  const spawn: ProviderSpawn = async (...args) => {
    const child = await (options.spawn ?? spawnOwnedProcess)(...args);
    children.add(child);
    return child;
  };
  const release = async (child: OwnedProcess) => {
    await child.stop(1_000);
    children.delete(child);
  };
  const cleanup = async () => {
    for (const child of children) {
      await release(child);
    }
    for (const path of staging) {
      await rm(path, { recursive: true, force: true });
      staging.delete(path);
    }
  };
  const valid = async (id: string) => {
    const directory = managedProviderDirectory(env, id);
    try {
      await verifyPrivatePath(directory, true);
      const receipt = JSON.parse(await readFile(join(directory, "release.json"), "utf8"));
      if (
        receipt.identity !==
        createHash("sha256").update(JSON.stringify(PROVIDER_RELEASES[id])).digest("hex")
      )
        return false;
      for (const name of [executableNames[id], ...(id === "claude" ? ["claude-agent-acp"] : [])]) {
        const file = join(directory, "bin", name as string);
        const resolved = await realpath(file);
        if (
          !resolved.startsWith(`${await realpath(directory)}/`) ||
          !(await stat(resolved)).isFile()
        )
          return false;
        await access(file, constants.X_OK);
      }
      return true;
    } catch {
      return false;
    }
  };
  const environment = async (id: string) => {
    const directory = managedProviderDirectory(env, id);
    return (await valid(id))
      ? { ...env, PATH: `${join(directory, "bin")}${delimiter}${env.PATH ?? ""}` }
      : { ...env };
  };
  const executable = async (id: string) => {
    const current = await environment(id);
    for (const parent of (current.PATH ?? "")
      .split(delimiter)
      .filter((path) => path.startsWith("/"))) {
      const file = join(parent, executableNames[id] as string);
      try {
        if ((await stat(file)).isFile()) {
          await access(file, constants.X_OK);
          return { file, env: current };
        }
      } catch {}
    }
    throw new ProviderSetupError("missing");
  };
  const install = async (id: string, signal: AbortSignal) => {
    await cleanup();
    signal.throwIfAborted();
    const releaseInfo = PROVIDER_RELEASES[id];
    const artifact = releaseInfo?.archives[`${process.platform}-${process.arch}`];
    if (process.getuid?.() === 0 || !releaseInfo || !artifact)
      throw new ProviderSetupError("install");
    if (await valid(id)) return;
    const timeout = AbortSignal.timeout(options.installMs ?? 10 * 60_000);
    const combined = AbortSignal.any([signal, timeout]);
    let parent = userHome(env);
    for (const component of [".local", "share", "code60", "providers", id]) {
      parent = join(parent, component);
      await privateDirectory(parent);
      const info = await lstat(parent);
      if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.())
        throw new ProviderSetupError("install");
    }
    await verifyPrivatePath(parent, true);
    const directory = managedProviderDirectory(env, id);
    try {
      await lstat(directory);
      throw new ProviderSetupError("install");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const stage = await mkdtemp(join(parent, ".install-"));
    staging.add(stage);
    let outcome: unknown;
    try {
      const archive = join(stage, "release.tgz");
      await (options.download ?? downloadProviderArtifact)(
        artifact,
        archive,
        combined,
        options.fetch,
      );
      await extractProviderArchive(archive, join(stage, "payload"), combined);
      await rm(archive);
      await privateDirectory(join(stage, "bin"));
      await symlink(
        `../payload/${releaseInfo.binary}`,
        join(stage, "bin", executableNames[id] as string),
      );
      if (releaseInfo.adapter) {
        const adapter = join(stage, "adapter.tgz");
        await (options.download ?? downloadProviderArtifact)(
          releaseInfo.adapter,
          adapter,
          combined,
          options.fetch,
        );
        const child = await spawn(
          [
            "npm",
            "install",
            "--prefix",
            join(stage, "adapter"),
            "--ignore-scripts",
            "--no-audit",
            "--no-fund",
            "--registry",
            "https://registry.npmjs.org",
            adapter,
          ],
          stage,
          {
            ...Object.fromEntries(
              Object.entries(env).filter(([key]) => !/^npm_config_/i.test(key)),
            ),
            NPM_CONFIG_USERCONFIG: join(stage, ".npmrc-user"),
            NPM_CONFIG_GLOBALCONFIG: join(stage, ".npmrc-global"),
          },
        );
        child.stdout.resume();
        child.stderr.resume();
        await waitExit(child, combined);
        await release(child);
        await symlink(
          "../adapter/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js",
          join(stage, "bin/claude-agent-acp"),
        );
        await rm(adapter);
      }
      await writeFile(
        join(stage, "release.json"),
        JSON.stringify({
          identity: createHash("sha256").update(JSON.stringify(releaseInfo)).digest("hex"),
        }),
        { mode: 0o600 },
      );
      for (const name of [executableNames[id], ...(id === "claude" ? ["claude-agent-acp"] : [])]) {
        const path = join(stage, "bin", name as string);
        const resolved = await realpath(path);
        if (!resolved.startsWith(`${await realpath(stage)}/`) || !(await stat(resolved)).isFile())
          throw new ProviderSetupError("install");
        await access(path, constants.X_OK);
      }
      combined.throwIfAborted();
      await rename(stage, directory);
      staging.delete(stage);
    } catch (error) {
      outcome =
        error instanceof ProviderSetupError
          ? error
          : new ProviderSetupError(timeout.aborted ? "timeout" : "install");
    } finally {
      try {
        await cleanup();
      } catch {
        outcome = new ProviderSetupError("cleanup");
      }
    }
    if (outcome) throw outcome;
  };
  const policies: Partial<Record<SetupProviderId, ProviderSetupPolicy>> = {};
  for (const id of Object.keys(PROVIDER_RELEASES) as SetupProviderId[]) {
    policies[id] = {
      supported: !(overrideKeys[id] ?? []).some((key) => !!env[key]),
      install: (signal) => install(id, signal),
      cleanup,
      login: async (context) => {
        await cleanup();
        context.signal.throwIfAborted();
        const timeout = AbortSignal.timeout(options.loginMs ?? 15 * 60_000);
        const signal = AbortSignal.any([context.signal, timeout]);
        let outcome: unknown;
        try {
          const current = await executable(id);
          const loginEnv = { ...current.env, ...updateEnvironment[id] };
          const version = await spawn([current.file, "--version"], userHome(env), loginEnv);
          let text = "";
          const capture = (bytes: Buffer) => {
            text += bytes.toString("utf8");
            if (text.length > 4096) text = text.slice(0, 4096);
          };
          version.stdout.on("data", capture);
          version.stderr.resume();
          await waitExit(version, AbortSignal.any([signal, AbortSignal.timeout(15_000)]));
          await release(version);
          if (!text.match(/\d+\.\d+\.\d+/)?.includes(PROVIDER_RELEASES[id]?.version ?? ""))
            throw new ProviderSetupError("unsupported");
          const loginContext = { ...context, signal };
          if (id === "droid")
            await loginDroid(current.file, userHome(env), loginEnv, loginContext, spawn, (path) => {
              staging.add(path);
            });
          else if (id === "opencode")
            await loginOpenCode(
              current.file,
              userHome(env),
              loginEnv,
              loginContext,
              spawn,
              options.fetch,
              (path) => {
                staging.add(path);
              },
            );
          else
            await loginProviderCli(id, current.file, userHome(env), loginEnv, loginContext, spawn);
        } catch (error) {
          outcome =
            error instanceof ProviderSetupError
              ? error
              : new ProviderSetupError(timeout.aborted ? "timeout" : "login");
        } finally {
          try {
            await cleanup();
          } catch {
            outcome = new ProviderSetupError("cleanup");
          }
        }
        if (outcome) throw outcome;
      },
    };
  }
  return { policies, environment, executable, valid };
}
async function waitExit(child: OwnedProcess, signal: AbortSignal) {
  let abort: () => void = () => {};
  try {
    const interrupted = new Promise<never>((_, reject) => {
      abort = () => reject(new ProviderSetupError("timeout"));
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
    const result = await Promise.race([child.exited, interrupted]);
    if (result.code !== 0) throw new ProviderSetupError("install");
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
/** Resolve managed tools per standard integration, preserving configured command hashes and overrides. */
export function providerAgents(
  agents: CoreDeps["agents"],
  env: NodeJS.ProcessEnv,
): CoreDeps["agents"] {
  const base = codexProviderAgents(agents, env);
  const runtime = createProviderRuntime(env);
  const prepare = async (spec: Parameters<typeof agents.start>[0]) => {
    const id = spec.name;
    if (
      !PROVIDER_RELEASES[id] ||
      commandIdentity(spec.command) !==
        commandIdentity(PROVIDERS.find((provider) => provider.id === id)?.command ?? []) ||
      (overrideKeys[id] ?? []).some((key) => !!env[key] || !!spec.env?.[key])
    )
      return spec;
    if (!(await runtime.valid(id))) return spec;
    const current = await runtime.executable(id);
    const directory = managedProviderDirectory(env, id);
    return {
      ...spec,
      command:
        id === "claude"
          ? ([
              process.execPath,
              join(
                directory,
                "adapter/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js",
              ),
            ] as const)
          : ([current.file, ...spec.command.slice(1)] as [string, ...string[]]),
      env: {
        ...current.env,
        ...spec.env,
        PATH: current.env.PATH as string,
        ...updateEnvironment[id],
        ...(id === "claude" ? { CLAUDE_CODE_EXECUTABLE: current.file } : {}),
      } as Record<string, string>,
    };
  };
  const restore = base.restore?.bind(base);
  return {
    start: async (spec, signal) => base.start(await prepare(spec), signal),
    ...(restore
      ? {
          restore: async (spec: Parameters<typeof restore>[0], id: string, signal?: AbortSignal) =>
            restore(await prepare(spec), id, signal),
        }
      : {}),
  };
}
