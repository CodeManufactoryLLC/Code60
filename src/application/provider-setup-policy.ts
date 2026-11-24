import type {
  ProviderLoginAnswer,
  ProviderLoginChallenge,
  ProviderLoginMethod,
  SetupProviderId,
} from "../bridge/index.js";
import { providerLoginChallengeSchema } from "../bridge/index.js";

export type ProviderFailure =
  | "missing"
  | "unsupported"
  | "install"
  | "login"
  | "timeout"
  | "cleanup";
export class ProviderSetupError extends Error {
  constructor(readonly reason: ProviderFailure) {
    super(
      {
        missing: "The provider executable is missing. Install the compatible copy for Code60.",
        unsupported: "This version cannot sign in from Code60. Install the compatible copy.",
        install: "Provider installation failed. Check your connection and retry.",
        login: "Provider sign-in did not complete. Check account access and retry.",
        timeout: "Provider setup timed out. Retry to continue.",
        cleanup: "Provider setup could not finish cleanup. Retry after its owned resources stop.",
      }[reason],
    );
  }
}
export interface ProviderLoginContext {
  signal: AbortSignal;
  method: ProviderLoginMethod;
  challenge(value: ProviderLoginChallenge | null): void;
  input(value: ProviderLoginChallenge): Promise<ProviderLoginAnswer>;
}
export interface ProviderSetupPolicy {
  supported?: boolean;
  install(signal: AbortSignal): Promise<void>;
  login(context: ProviderLoginContext): Promise<void>;
  cleanup(): Promise<void>;
}
export const loginMethods: Record<SetupProviderId, readonly ProviderLoginMethod[]> = {
  codex: ["default"],
  antigravity: ["default"],
  copilot: ["default"],
  droid: ["default"],
  kiro: ["default"],
  claude: ["claude-subscription", "claude-console"],
  opencode: ["chatgpt", "github-copilot"],
};
const hosts: Record<SetupProviderId, readonly string[]> = {
  codex: ["auth.openai.com"],
  claude: ["claude.ai", "platform.claude.com", "console.anthropic.com"],
  antigravity: ["accounts.google.com"],
  copilot: ["github.com"],
  droid: ["app.factory.ai"],
  kiro: ["app.kiro.dev", "view.awsapps.com"],
  opencode: ["auth.openai.com", "github.com"],
};
/** Never follow or open an arbitrary URL found in a provider's output. */
export function validateLoginChallenge(
  provider: SetupProviderId,
  value: unknown,
): ProviderLoginChallenge {
  const challenge = providerLoginChallengeSchema.parse(value);
  if (challenge.kind === "confirmation") {
    if (provider !== "copilot") throw new ProviderSetupError("login");
    return challenge;
  }
  const url = new URL(challenge.verificationUrl);
  if (!hosts[provider].includes(url.hostname)) throw new ProviderSetupError("login");
  if (
    (provider === "copilot" || provider === "opencode") &&
    url.hostname === "github.com" &&
    url.pathname !== "/login/device"
  )
    throw new ProviderSetupError("login");
  if (
    (provider === "codex" || provider === "opencode") &&
    url.hostname === "auth.openai.com" &&
    url.pathname !== "/codex/device"
  )
    throw new ProviderSetupError("login");
  return challenge;
}
