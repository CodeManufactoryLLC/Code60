import type { AgentSpec, Agents } from "../agents/index.js";
import { renderEpisodicMemoryPrompt } from "../contracts/index.js";
import type { RunEvent } from "./types.js";

export const MEMORY_EVENT_LIMIT = 10_000;
export const MEMORY_INPUT_LIMIT = 1_000_000;
const CHUNK_SIZE = 32_000;
const OUTPUT_LIMIT = 64_000;

export function parseMemoryStatements(text: string): string[] {
  if (text.length > OUTPUT_LIMIT) throw new Error("Extraction response is too large");
  const json = text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, "$1");
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error("The provider did not return valid statements. Edit the prompt and try again.");
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Object.keys(value).length !== 1 ||
    !("statements" in value) ||
    !Array.isArray(value.statements) ||
    value.statements.length > 500 ||
    value.statements.some(
      (item: unknown) => typeof item !== "string" || !item.trim() || item.length > 2_000,
    )
  )
    throw new Error("The provider returned an invalid statements list");
  return (value.statements as string[]).map((item) => item.replace(/\s+/g, " ").trim());
}

/** One explicit extraction; no run records, worktrees, tools, or conversation state. */
export async function extractEpisodicMemory(
  agents: Agents,
  spec: AgentSpec,
  events: readonly RunEvent[],
  instructions: string,
  signal: AbortSignal,
  timeoutMs = 300_000,
): Promise<string[]> {
  if (!events.length) throw new Error("No events available to extract");
  if (events.length > MEMORY_EVENT_LIMIT)
    throw new Error("Extraction supports at most 10,000 events");
  const chunks: string[] = [];
  let chunk = "";
  let size = 0;
  for (const event of events) {
    const text = `${JSON.stringify(event)}\n`;
    size += text.length;
    if (size > MEMORY_INPUT_LIMIT)
      throw new Error("Event data exceeds the 1,000,000-character extraction limit");
    if (chunk.length + text.length > CHUNK_SIZE && chunk) {
      chunks.push(chunk);
      chunk = "";
    }
    for (let offset = 0; offset < text.length; offset += CHUNK_SIZE) {
      const part = text.slice(offset, offset + CHUNK_SIZE);
      if (part.length === CHUNK_SIZE) chunks.push(part);
      else chunk += part;
    }
  }
  if (chunk) chunks.push(chunk);
  const failure = new AbortController();
  const timer = setTimeout(
    () => failure.abort(new Error("Extraction timed out after five minutes")),
    timeoutMs,
  );
  const combined = AbortSignal.any([signal, failure.signal]);
  const statements = new Map<string, string>();
  try {
    for (const [index, data] of chunks.entries()) {
      combined.throwIfAborted();
      const session = await agents.start(spec, combined);
      let dispose = () => {};
      let onAbort = () => {};
      try {
        combined.throwIfAborted();
        session.onPermission(async () => "deny");
        let response = "";
        dispose = session.onUpdate((update) => {
          if (update.type !== "message") return;
          if (response.length + update.text.length > OUTPUT_LIMIT) {
            failure.abort(new Error("Extraction response is too large"));
          } else response += update.text;
        });
        const aborted = new Promise<never>((_, reject) => {
          onAbort = () => reject(combined.reason);
          combined.addEventListener("abort", onAbort, { once: true });
          if (combined.aborted) onAbort();
        });
        const reason = await Promise.race([
          session.prompt(renderEpisodicMemoryPrompt(instructions, data, index + 1, chunks.length)),
          aborted,
        ]);
        combined.throwIfAborted();
        if (reason !== "end_turn")
          throw new Error(`Extraction ended without a complete result (${reason})`);
        for (const statement of parseMemoryStatements(response)) {
          statements.set(statement.toLowerCase(), statement);
          if (statements.size > 2_000)
            throw new Error("Extraction returned more than 2,000 statements");
        }
      } finally {
        dispose();
        combined.removeEventListener("abort", onAbort);
        await session.stop(1_000);
      }
    }
    combined.throwIfAborted();
    return [...statements.values()];
  } catch (error) {
    if (signal.aborted) throw new Error("Extraction cancelled");
    if (failure.signal.aborted) throw failure.signal.reason;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
