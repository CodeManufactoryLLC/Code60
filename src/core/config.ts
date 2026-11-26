import { join } from "node:path";
import { z } from "zod";
import {
  DEFAULT_PROMPT_TEMPLATES,
  durationSchema,
  parseValue,
  permissionRuleSchema,
  promptTemplatesSchema,
  TOOL_KINDS,
} from "../contracts/index.js";
import { environmentValue, userHome } from "../platform/index.js";
import type { AgentConfig, Config, PermissionPolicy } from "./types.js";
import { UsageError } from "./types.js";

export const DEFAULT_PERMISSIONS: PermissionPolicy = {
  read: "allow",
  search: "allow",
  think: "allow",
  edit: "allow",
  default: "ask",
};

const DEFAULT_AGENTS: Readonly<Record<string, AgentConfig>> = {
  claude: { command: ["npx", "-y", "@agentclientprotocol/claude-agent-acp"] },
  codex: { command: ["npx", "-y", "@agentclientprotocol/codex-acp"] },
  opencode: { command: ["opencode", "acp"] },
  droid: { command: ["droid", "exec", "--output-format", "acp"] },
};

export const DEFAULT_CONFIG: Config = {
  defaultAgent: "claude",
  maxParallel: 4,
  turnTimeout: "30m",
  worktreeDir: null,
  permissions: DEFAULT_PERMISSIONS,
  agents: DEFAULT_AGENTS,
  prompts: DEFAULT_PROMPT_TEMPLATES,
};

/** Parses the same duration grammar used by saved run configurations. */
export function parseDuration(text: string): number {
  try {
    return parseValue(durationSchema, text);
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
}

export function configPath(env: Readonly<Record<string, string | undefined>>): string {
  const base = environmentValue(env, "XDG_CONFIG_HOME") || join(userHome(env), ".config");
  return join(base, "code60", "config.json");
}

const permissionsSchema = z.record(z.string(), permissionRuleSchema).superRefine((rules, ctx) => {
  for (const kind of Object.keys(rules)) {
    if (kind !== "default" && !TOOL_KINDS.some((known) => known === kind)) {
      ctx.addIssue({ code: "custom", message: `permissions: unknown tool-call kind '${kind}'` });
    }
  }
});
const configSchema = z.strictObject({
  defaultAgent: z.string().min(1).optional(),
  maxParallel: z.number().int().positive().optional(),
  turnTimeout: z
    .string()
    .superRefine((value, ctx) => {
      const result = durationSchema.safeParse(value);
      if (!result.success)
        ctx.addIssue({
          code: "custom",
          message: `turnTimeout: ${result.error.issues[0]?.message}`,
        });
    })
    .optional(),
  worktreeDir: z.string().min(1).nullable().optional(),
  permissions: permissionsSchema.optional(),
  agents: z
    .record(z.string(), z.strictObject({ command: z.tuple([z.string().min(1)], z.string()) }))
    .optional(),
  prompts: promptTemplatesSchema.optional(),
});

/** Keep CLI diagnostics concise and independent of Zod's internal error format. */
function configError(issue: z.core.$ZodIssue): string {
  const [key, name] = issue.path;
  if (issue.code === "custom")
    return key === "prompts" && name === "contract.operating"
      ? "prompts.contract.operating must contain the predefined valid clauses"
      : issue.message;
  if (issue.code === "unrecognized_keys") {
    if (issue.keys.includes("mcpServers")) return "configuration contains unsupported fields";
    const prefix = issue.path.length ? `${issue.path.join(".")}: ` : "";
    return `${prefix}unknown key '${issue.keys[0]}'`;
  }
  switch (key) {
    case "defaultAgent":
      return "defaultAgent must be a non-empty string";
    case "maxParallel":
      return "maxParallel must be a positive integer";
    case "turnTimeout":
      return 'turnTimeout must be a string such as "30m"';
    case "worktreeDir":
      return "worktreeDir must be null or a non-empty path";
    case "permissions":
      return name === undefined
        ? "permissions must be an object"
        : `permissions.${String(name)} must be "allow", "deny", or "ask"`;
    case "agents":
      return name === undefined
        ? "agents must be an object"
        : `agents.${String(name)}.command must be a non-empty array of strings`;
    case "prompts":
      return name === undefined
        ? "prompts must be an object"
        : name === "contract.operating"
          ? "prompts.contract.operating must contain the predefined valid clauses"
          : `prompts.${String(name)} must be a string`;
    default:
      return "must be a JSON object";
  }
}

/** Validates parsed config JSON and fills in the documented defaults. */
export function parseConfig(raw: unknown, source = "config"): Config {
  const result = configSchema.safeParse(raw, { jitless: true });
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new UsageError(`${source}: ${issue ? configError(issue) : "invalid configuration"}`);
  }
  const value = result.data;
  const config: Config = {
    defaultAgent: value.defaultAgent ?? DEFAULT_CONFIG.defaultAgent,
    maxParallel: value.maxParallel ?? DEFAULT_CONFIG.maxParallel,
    turnTimeout: value.turnTimeout ?? DEFAULT_CONFIG.turnTimeout,
    worktreeDir: value.worktreeDir === undefined ? DEFAULT_CONFIG.worktreeDir : value.worktreeDir,
    permissions: { ...DEFAULT_PERMISSIONS, ...value.permissions },
    agents: { ...DEFAULT_AGENTS, ...value.agents },
    prompts: {
      "contract.operating":
        value.prompts?.["contract.operating"] ?? DEFAULT_PROMPT_TEMPLATES["contract.operating"],
      "handoff.summary":
        value.prompts?.["handoff.summary"] ?? DEFAULT_PROMPT_TEMPLATES["handoff.summary"],
      "handoff.first-turn":
        value.prompts?.["handoff.first-turn"] ?? DEFAULT_PROMPT_TEMPLATES["handoff.first-turn"],
      "worker.updates.project":
        value.prompts?.["worker.updates.project"] ??
        DEFAULT_PROMPT_TEMPLATES["worker.updates.project"],
      "plan.accepted.project":
        value.prompts?.["plan.accepted.project"] ??
        DEFAULT_PROMPT_TEMPLATES["plan.accepted.project"],
      "task.continue":
        value.prompts?.["task.continue"] ?? DEFAULT_PROMPT_TEMPLATES["task.continue"],
      "review.conflict-revision.project":
        value.prompts?.["review.conflict-revision.project"] ??
        DEFAULT_PROMPT_TEMPLATES["review.conflict-revision.project"],
      "utility.chat-title":
        value.prompts?.["utility.chat-title"] ?? DEFAULT_PROMPT_TEMPLATES["utility.chat-title"],
      "utility.search-overview":
        value.prompts?.["utility.search-overview"] ??
        DEFAULT_PROMPT_TEMPLATES["utility.search-overview"],
      "memory.episodic-instructions":
        value.prompts?.["memory.episodic-instructions"] ??
        DEFAULT_PROMPT_TEMPLATES["memory.episodic-instructions"],
    },
  };
  if (!Object.hasOwn(config.agents, config.defaultAgent)) {
    throw new UsageError(
      `${source}: defaultAgent '${config.defaultAgent}' is not a configured agent`,
    );
  }
  return config;
}

export interface ConfigFs {
  readFile(path: string, encoding: "utf8"): Promise<string>;
}

/** Loads the config file. A missing file means the defaults. */
export async function loadConfig(
  fs: ConfigFs,
  env: Readonly<Record<string, string | undefined>>,
): Promise<Config> {
  const path = configPath(env);
  let text: string;
  try {
    text = await fs.readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return DEFAULT_CONFIG;
    throw new UsageError(`cannot read ${path}: ${(error as Error).message}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new UsageError(`${path}: invalid JSON`);
  }
  return parseConfig(raw, path);
}
