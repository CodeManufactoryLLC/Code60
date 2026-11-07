import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import type { SetupProvider } from "../bridge/index.js";
import type { Config } from "../core/index.js";
import { environmentValue, resolveCommand } from "../platform/index.js";

type Command = readonly [string, ...string[]];
interface Provider extends SetupProvider {
  command: Command;
  prerequisites?: string[];
}
export const PROVIDERS: Provider[] = [
  {
    id: "antigravity",
    name: "Antigravity",
    logo: "antigravity",
    command: ["agy", "acp"],
    guidance: "Install the Antigravity CLI, open agy to sign in, then retry.",
  },
  {
    id: "claude",
    name: "Claude",
    logo: "claude",
    command: ["npx", "-y", "@agentclientprotocol/claude-agent-acp"],
    prerequisites: ["claude", "claude-agent-acp"],
    guidance:
      "Install Claude Code and sign in with claude. Retry when ready. Connecting may download the ACP adapter through npx.",
  },
  {
    id: "codex",
    name: "Codex",
    logo: "codex",
    command: ["npx", "-y", "@agentclientprotocol/codex-acp"],
    prerequisites: ["codex", "codex-acp"],
    guidance:
      "Install Codex and sign in with codex login. Retry when ready. Connecting may download the ACP adapter through npx.",
  },
  {
    id: "copilot",
    name: "Copilot",
    logo: "copilot",
    command: ["copilot", "--acp", "--stdio"],
    guidance: "Install GitHub Copilot CLI, open copilot and sign in with /login, then retry.",
  },
  {
    id: "droid",
    name: "Droid",
    logo: "droid",
    command: ["droid", "exec", "--output-format", "acp"],
    guidance: "Install Factory Droid, open droid to sign in, then retry.",
  },
  {
    id: "kiro",
    name: "Kiro",
    logo: "kiro",
    command: ["kiro-cli", "acp"],
    guidance: "Install Kiro CLI and sign in with kiro-cli login, then retry.",
  },
  {
    id: "opencode",
    name: "OpenCode",
    logo: "opencode",
    command: ["opencode", "acp"],
    guidance: "Install OpenCode and configure a provider with opencode auth login, then retry.",
  },
];
export function desktopConfig(config: Config): Config {
  return {
    ...config,
    agents: {
      ...Object.fromEntries(PROVIDERS.map((p) => [p.id, { command: p.command }])),
      ...config.agents,
    },
  };
}
export const commandIdentity = (command: readonly string[]) =>
  createHash("sha256").update(JSON.stringify(command)).digest("hex");

/** Discovery never executes the candidate. Absolute overrides remain authoritative. */
export async function executableExists(
  file: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  if (platform === "win32") {
    try {
      const resolved = await resolveCommand([file], env, platform);
      return (await stat(resolved.file)).isFile();
    } catch {
      return false;
    }
  }
  if (file.includes("/") && !isAbsolute(file)) return false;
  const candidates = isAbsolute(file)
    ? [file]
    : (environmentValue(env, "PATH", platform) ?? "")
        .split(":")
        .filter(isAbsolute)
        .map((dir) => join(dir, file));
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) {
        await access(candidate, constants.X_OK);
        return true;
      }
    } catch {
      /* next PATH entry */
    }
  }
  return false;
}
export async function detectProvider(
  id: string,
  command: Command,
  env: NodeJS.ProcessEnv,
  exists: (file: string) => Promise<boolean> = (file) => executableExists(file, env),
): Promise<void> {
  const provider = PROVIDERS.find((p) => p.id === id);
  if (!provider) throw new Error("Unknown agent");
  if (!(await exists(command[0])))
    throw new Error(`${provider.name} launch command was not found.`);
  // Overrides can launch standalone adapters, Node scripts, or private executables.
  if (
    commandIdentity(command) !== commandIdentity(provider.command) &&
    !/^npx(?:\.cmd|\.exe)?$/i.test(basename(command[0]))
  )
    return;
  if (
    provider.prerequisites &&
    !(await Promise.all(provider.prerequisites.map(exists))).some(Boolean)
  )
    throw new Error(`${provider.name} was not found.`);
}
