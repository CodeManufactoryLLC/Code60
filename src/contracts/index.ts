import { z } from "zod";

export * from "./logs.js";
export * from "./memory.js";
export * from "./usage.js";

import { type OperatingContractClauses, type PromptId, validatePromptTemplate } from "./prompts.js";

// Disable code generation before constructing objects: even the eval capability probe
// triggers a CSP violation in the sandboxed renderer. Apply the same mode in Node.
z.config({ jitless: true });

export * from "./knowledge.js";
export * from "./navigation.js";
export * from "./values.js";

/** Return one concise message, never a serialized Zod issue containing input data. */
export function parseValue<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value, { jitless: true });
  if (!result.success) throw new Error(result.error.issues[0]?.message ?? "Invalid value");
  return result.data;
}

export * from "./activity.js";
export * from "./automation.js";
export * from "./browser.js";
export * from "./commands.js";
export * from "./health-check.js";
export * from "./mcp-connector-text.js";
export * from "./mcp-connectors.js";
export * from "./mcp-tools.js";
export * from "./product.js";
export * from "./project-search.js";
export * from "./prompt-catalog.js";
export * from "./prompts.js";
export * from "./provider-login.js";
export * from "./search-summary.js";
export * from "./session-state.js";
export * from "./tactics.js";

const promptTemplateSchema = (id: PromptId) =>
  z.string().superRefine((template, ctx) => {
    const problem = validatePromptTemplate(id, template);
    if (problem) ctx.addIssue({ code: "custom", message: `prompts.${id}: ${problem}` });
  });
export const operatingContractSchema = z
  .custom<OperatingContractClauses>(
    (value) => validatePromptTemplate("contract.operating", value) === undefined,
    { error: "Invalid Operating Contract clauses" },
  )
  .transform((clauses) => ({ ...clauses }));
/** User overrides for the editable built-in prompt templates, keyed by canonical dotted ID. */
export const promptTemplatesSchema = z.strictObject({
  "contract.operating": operatingContractSchema.optional(),
  "handoff.summary": promptTemplateSchema("handoff.summary").optional(),
  "handoff.first-turn": promptTemplateSchema("handoff.first-turn").optional(),
  "worker.updates.project": promptTemplateSchema("worker.updates.project").optional(),
  "plan.accepted.project": promptTemplateSchema("plan.accepted.project").optional(),
  "task.continue": promptTemplateSchema("task.continue").optional(),
  "review.conflict-revision.project": promptTemplateSchema(
    "review.conflict-revision.project",
  ).optional(),
  "utility.chat-title": promptTemplateSchema("utility.chat-title").optional(),
  "utility.search-overview": promptTemplateSchema("utility.search-overview").optional(),
  "memory.episodic-instructions": promptTemplateSchema("memory.episodic-instructions").optional(),
});

/** IPC limits historically count UTF-16 code units, including surrogate pairs. */
export function boundedString(label: string, max: number) {
  return z
    .string({ error: `Invalid ${label}` })
    .refine((value) => value.length <= max, `Invalid ${label}`);
}

export * from "./mcp-authentication.js";
export * from "./mcp-editing.js";
export * from "./mcp-management.js";
export * from "./mcp-recovery.js";
export type {
  McpRuntimeRequest,
  McpRuntimeResponse,
} from "./mcp-runtime.js";
export { mcpRuntimeRequestSchema } from "./mcp-runtime.js";
export * from "./mcp-troubleshooting.js";
export * from "./workflows.js";
