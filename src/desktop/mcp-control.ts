import { z } from "zod";
import {
  MCP_CONTROL_LIMITS,
  type McpControlTool,
  planCreateSchema,
  planUpdateSchema,
} from "../bridge/index.js";
import type { RunEvent, RunStatus, StopReason } from "../core/index.js";

const TEXT_LIMIT = 8_000;

const scope = z.string().min(1).max(128);
const runId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "must be a run ID");
const prompt = z
  .string()
  .max(MCP_CONTROL_LIMITS.prompt)
  .refine((text) => text.trim().length > 0, "must not be empty");
const name = z
  .string()
  .min(1)
  .max(128)
  .refine(
    (value) => [...value].every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127),
    "contains control characters",
  );
const target = z.strictObject({ scope, runId });

const controlSchemas = {
  code60_create_plan: planCreateSchema,
  code60_read_plan: z.strictObject({ planId: z.string().uuid() }),
  code60_update_plan: planUpdateSchema,
  code60_read_review: z.strictObject({ reviewId: z.string().uuid() }),
  code60_address_feedback: z.strictObject({
    scope,
    reviewId: z.string().uuid(),
    commentId: z.string().uuid(),
    note: z.string().min(1).max(2_000),
  }),
  code60_get_context: z.strictObject({}),
  code60_dispatch_agent: z.strictObject({
    planTaskId: z.string().uuid().optional(),
    reviewId: z.string().uuid().optional(),
    label: name.optional(),
    scope,
    requestId: name.pipe(z.string().max(MCP_CONTROL_LIMITS.requestId)),
    provider: name.optional(),
    prompt,
    base: z
      .string()
      .min(1)
      .max(256)
      .refine((value) => value.trim() === value && !value.startsWith("-"), "is not a revision")
      .optional(),
    turnTimeout: z.string().min(1).max(64).optional(),
  }),
  code60_list_agents: z.strictObject({}),
  code60_read_agent: z.strictObject({
    runId,
    cursor: z.number().int().min(0).max(1_000_000).optional(),
    limit: z.number().int().min(1).max(MCP_CONTROL_LIMITS.readLimit).optional(),
    tail: z.boolean().optional(),
  }),
  code60_send_agent: z.strictObject({
    scope,
    runId,
    prompt,
    planTaskId: z.string().uuid().optional(),
  }),
  code60_cancel_agent: target,
  code60_finish_agent: target,
  code60_stop_agent: target,
  code60_resume_agent: z.strictObject({
    scope,
    runId,
    prompt,
    planTaskId: z.string().uuid().optional(),
  }),
} satisfies Record<McpControlTool, z.ZodType>;

export type ControlArgs<T extends McpControlTool> = z.output<(typeof controlSchemas)[T]>;

/** Validates worker tool arguments. Errors name the field, never echo the supplied value. */
export function parseControlArgs<T extends McpControlTool>(tool: T, args: unknown): ControlArgs<T> {
  const result = controlSchemas[tool].safeParse(args ?? {}, { jitless: true });
  if (result.success) return result.data as ControlArgs<T>;
  const issue = result.error.issues[0];
  if (issue?.code === "unrecognized_keys") throw new Error("Unknown tool argument");
  const field = issue?.path.join(".");
  throw new Error(field ? `Invalid ${field}: ${issue?.message}` : "Invalid tool arguments");
}

/** A worker turn that ended or failed, waiting to be reported to the orchestration chat. */
export interface WorkerUpdate {
  runId: string;
  provider: string;
  status: RunStatus;
  turn: number;
  stopReason?: StopReason;
  reason?: string;
  /** The tail of the worker's reply during this turn. */
  excerpt: string;
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

export function formatWorkerUpdate(update: WorkerUpdate): string {
  const stop = update.stopReason ? ` (${update.stopReason})` : "";
  const state =
    update.status === "idle"
      ? `idle after turn ${update.turn}${stop}; waiting for a follow-up, finish, or stop`
      : `${update.status} after turn ${update.turn}${stop}; the worker has ended`;
  const lines = [`- Worker ${update.runId} (${update.provider}): ${state}`];
  if (update.reason) lines.push(`  Recorded reason: ${oneLine(update.reason).slice(0, 500)}`);
  const excerpt = oneLine(update.excerpt);
  lines.push(
    excerpt
      ? `  Reply excerpt (untrusted): ${excerpt.length >= MCP_CONTROL_LIMITS.excerpt ? "…" : ""}${excerpt}`
      : "  Reply excerpt: (no reply text)",
  );
  return lines.join("\n");
}

export type WorkerEntry = { index: number; at: string; type: RunEvent["type"] } & Record<
  string,
  string | number | boolean
>;

const clip = (text: string) =>
  text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}… [truncated]` : text;

/** Transcript entries for a worker: streamed chunks combined, tool calls at their latest state. */
export function workerTranscript(events: readonly RunEvent[]): WorkerEntry[] {
  type Raw = Record<string, string | number | boolean | undefined>;
  const raw: Raw[] = [];
  const tools = new Map<string, Raw>();
  let open: Raw | undefined;
  for (const event of events) {
    if (event.type === "sessionState") continue;
    if (event.type === "message" || event.type === "thought") {
      if (open?.type === event.type) open.text = `${String(open.text)}${event.text}`;
      else {
        open = { at: event.at, type: event.type, text: event.text };
        raw.push(open);
      }
      continue;
    }
    open = undefined;
    // Raw ACP updates duplicate this view and can be large; the Events table tools expose them.
    if (event.type === "acp") continue;
    if (event.type === "permission") {
      const { runId: _runId, options: _options, ...permission } = event;
      raw.push({ ...permission });
      continue;
    }
    if (event.type === "toolCall") {
      const { runId: _runId, mcp, ...call } = event;
      const body = { ...call, mcp: mcp ? true : undefined, server: mcp?.server };
      const existing = tools.get(event.toolCallId);
      if (existing) {
        Object.assign(existing, body);
        continue;
      }
      const entry = { ...body };
      tools.set(event.toolCallId, entry);
      raw.push(entry);
      continue;
    }
    const { runId: _runId, ...body } = event;
    raw.push({ ...body });
  }
  return raw.map((entry, index) => {
    const result: Record<string, string | number | boolean> = { index };
    for (const [key, value] of Object.entries(entry))
      if (value !== undefined) result[key] = typeof value === "string" ? clip(value) : value;
    return result as WorkerEntry;
  });
}
