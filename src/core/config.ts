import { join } from "node:path";
import { z } from "zod";
import type { AgentMcpServer } from "../agents/index.js";
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

export const DEFAULT_AGENTS: Readonly<Record<string, AgentConfig>> = {
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
  mcpServers: {},
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
const nonemptyString = z.string().refine((value) => value.trim().length > 0);
const stringMap = z.record(z.string(), z.string());
const mcpUrl = z.url({ protocol: /^https?$/, hostname: /.+/ });
const mcpServerSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("stdio"),
    command: nonemptyString,
    args: z.array(z.string()).default([]),
    env: stringMap.default({}),
  }),
  z.strictObject({
    type: z.literal("http"),
    url: mcpUrl,
    headers: stringMap.default({}),
  }),
  z.strictObject({
    type: z.literal("sse"),
    url: mcpUrl,
    headers: stringMap.default({}),
  }),
]);

export type McpServerConfig = z.infer<typeof mcpServerSchema>;

/** Resolve a private per-preparation copy, never record or expose these definitions. */
export function configuredMcpServers(config: Config): AgentMcpServer[] {
  return Object.entries(config.mcpServers).map(([name, server]) =>
    server.type === "stdio"
      ? {
          name,
          type: server.type,
          command: server.command,
          args: [...server.args],
          env: Object.entries(server.env).map(([name, value]) => ({ name, value })),
        }
      : {
          name,
          type: server.type,
          url: server.url,
          headers: Object.entries(server.headers).map(([name, value]) => ({ name, value })),
        },
  );
}

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
  mcpServers: z
    .record(
      nonemptyString.refine((name) => name !== "code60"),
      mcpServerSchema,
    )
    .optional(),
  prompts: promptTemplatesSchema.optional(),
});

/** Keep CLI diagnostics concise and independent of Zod's internal error format. */
function configError(issue: z.core.$ZodIssue): string {
  // Do not include Zod messages, input values, or arbitrary nested keys for MCP credentials.
  if (issue.path[0] === "mcpServers") {
    return "mcpServers must map non-empty names (except reserved 'code60') to strict stdio (command, string args/env) or http/sse (HTTP(S) url, string headers) definitions";
  }
  if (issue.code === "custom") return issue.message;
  const [key, name] = issue.path;
  if (issue.code === "unrecognized_keys") {
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
    mcpServers: value.mcpServers ?? {},
    prompts: {
      operatingContract:
        value.prompts?.operatingContract ?? DEFAULT_PROMPT_TEMPLATES.operatingContract,
      handoffSummary: value.prompts?.handoffSummary ?? DEFAULT_PROMPT_TEMPLATES.handoffSummary,
      handoffTurn: value.prompts?.handoffTurn ?? DEFAULT_PROMPT_TEMPLATES.handoffTurn,
      workerUpdates: value.prompts?.workerUpdates ?? DEFAULT_PROMPT_TEMPLATES.workerUpdates,
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
