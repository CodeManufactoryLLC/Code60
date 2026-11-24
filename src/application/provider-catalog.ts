import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import type { SetupProvider } from "../bridge/index.js";
import type { Config } from "../core/index.js";
import { assertSupportedPlatform, environmentValue } from "../platform/index.js";

type Command = readonly [string, ...string[]];
export class ProviderMissingError extends Error {
  constructor(name: string) {
    super(`${name} was not found.`);
  }
}
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
    guidance:
      "Install Antigravity and sign in here. Complete Google sign-in, then paste its authorization code into this dialog. Custom commands require external setup.",
  },
  {
    id: "claude",
    name: "Claude",
    logo: "claude",
    command: ["npx", "-y", "@agentclientprotocol/claude-agent-acp"],
    prerequisites: ["claude", "claude-agent-acp"],
    guidance:
      "Install Claude and its ACP adapter here, then choose Claude subscription or Anthropic Console browser sign-in. Paste the returned authorization code into this dialog. Custom commands require external setup.",
  },
  {
    id: "codex",
    name: "Codex",
    logo: "codex",
    command: ["npx", "-y", "@agentclientprotocol/codex-acp"],
    prerequisites: ["codex", "codex-acp"],
    guidance:
      "Use Install Codex and sign in, or Sign in to Codex, to connect from this dialog. Custom launch commands require their own external setup. Connecting may download the ACP adapter through npx.",
  },
  {
    id: "copilot",
    name: "Copilot",
    logo: "copilot",
    command: ["copilot", "--acp", "--stdio"],
    guidance:
      "Install Copilot and sign in here using the GitHub.com device code. Custom hosts and launch commands require external setup.",
  },
  {
    id: "droid",
    name: "Droid",
    logo: "droid",
    command: ["droid", "exec", "--output-format", "acp"],
    guidance:
      "Install Droid and sign in here using Factory’s browser device-pairing flow. Custom commands require external setup.",
  },
  {
    id: "kiro",
    name: "Kiro",
    logo: "kiro",
    command: ["kiro-cli", "acp"],
    guidance:
      "Install Kiro and sign in here using its browser device flow. Organization policies may disable this flow. Custom enterprise settings require external setup.",
  },
  {
    id: "opencode",
    name: "OpenCode",
    logo: "opencode",
    command: ["opencode", "acp"],
    guidance:
      "Install OpenCode here and connect ChatGPT or GitHub Copilot through browser sign-in. Existing model-provider credentials are reused; API keys and custom integrations require external setup.",
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
  assertSupportedPlatform(platform);
  if (file.includes("/") && !isAbsolute(file)) return false;
  const candidates = isAbsolute(file)
    ? [file]
    : (environmentValue(env, "PATH") ?? "")
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
    throw new ProviderMissingError(provider.name);
}
