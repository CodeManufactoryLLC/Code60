import { DEFAULT_PROMPT_TEMPLATES, renderPrompt } from "../contracts/index.js";
import type { RunEvent, RunRecord } from "./types.js";

export const HANDOFF_PROMPT_LIMIT = 12_000;

function latestToolCalls(events: readonly RunEvent[]): string[] {
  const calls = new Map<string, Extract<RunEvent, { type: "toolCall" }>>();
  for (const event of events) {
    if (event.type === "toolCall") calls.set(event.toolCallId, event);
  }
  return [...calls.values()].map(({ title, kind, status }) => `- ${title} (${kind}, ${status})`);
}

const list = (lines: readonly string[]) => (lines.length ? lines.join("\n") : "(none)");

/** Builds a deterministic, bounded handoff from saved run events without invoking an agent. */
export function buildHandoffPrompt(
  record: RunRecord,
  events: readonly RunEvent[],
  template: string = DEFAULT_PROMPT_TEMPLATES.handoffSummary,
  limit = HANDOFF_PROMPT_LIMIT,
): string {
  const prompts = events
    .filter((event): event is Extract<RunEvent, { type: "prompt" }> => event.type === "prompt")
    .map((event) => event.text);
  if (prompts.length === 0 && record.firstPrompt !== "") prompts.push(record.firstPrompt);
  const messages = events
    .filter((event): event is Extract<RunEvent, { type: "message" }> => event.type === "message")
    .map((event) => event.text);

  const content = renderPrompt("handoffSummary", template, {
    status: record.status,
    turns: String(record.turns),
    agent: record.agent,
    branch: record.branch ?? "none",
    base: record.base ?? "none",
    worktree: record.worktree,
    reason: record.reason || "none",
    prompts: list(prompts.map((text) => `- ${text}`)),
    messages: list(messages),
    toolCalls: list(latestToolCalls(events)),
  });

  const safeLimit = Math.max(256, Math.floor(limit));
  if (content.length <= safeLimit) return content;
  const suffix = "\n\n[Handoff context truncated to fit the recovery limit.]";
  return `${content.slice(0, safeLimit - suffix.length)}${suffix}`;
}
