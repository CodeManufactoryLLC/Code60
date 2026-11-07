import { createHash } from "node:crypto";
import type { AgentSetupRecord } from "../../src/bridge/index.js";
import type { Config } from "../../src/core/index.js";

/** Durable fixture for tests of features that run after onboarding. No live agents required. */
export function verifiedAgents(config: Config, primary = config.defaultAgent): AgentSetupRecord {
  return {
    version: 1,
    primary,
    enabled: Object.keys(config.agents),
    commands: Object.fromEntries(
      Object.entries(config.agents).map(([id, agent]) => [
        id,
        createHash("sha256").update(JSON.stringify(agent.command)).digest("hex"),
      ]),
    ),
  };
}
