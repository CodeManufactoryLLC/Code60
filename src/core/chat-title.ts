import type { AgentSpec, Agents } from "../agents/index.js";
import { CHAT_TITLE_GUARDRAIL, DEFAULT_PROMPT_TEMPLATES } from "../contracts/index.js";

/** A presentation-only turn, isolated from the conversation and denied tool permissions. */
export async function generateChatTitle(
  agents: Agents,
  spec: AgentSpec,
  firstMessage: string,
  reply: string,
  signal: AbortSignal,
  instructions: string = DEFAULT_PROMPT_TEMPLATES["utility.chat-title"],
): Promise<string> {
  const failure = new AbortController();
  const timer = setTimeout(() => failure.abort(new Error("Chat title timed out")), 30_000);
  const combined = AbortSignal.any([signal, failure.signal]);
  let onAbort = () => {};
  try {
    combined.throwIfAborted();
    const session = await agents.start(spec, combined);
    let dispose = () => {};
    try {
      combined.throwIfAborted();
      session.onPermission(async () => "deny");
      let response = "";
      dispose = session.onUpdate((update) => {
        if (update.type !== "message") return;
        if (response.length + update.text.length > 2_000)
          failure.abort(new Error("Chat title response is too large"));
        else response += update.text;
      });
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(combined.reason);
        combined.addEventListener("abort", onAbort, { once: true });
        if (combined.aborted) onAbort();
      });
      const reason = await Promise.race([
        session.prompt(
          `${instructions} ${CHAT_TITLE_GUARDRAIL}\n${JSON.stringify({
            user: firstMessage.slice(0, 8_000),
            assistant: reply.slice(0, 8_000),
          })}`,
        ),
        aborted,
        session.exited.then(() => {
          throw new Error("Chat title agent exited");
        }),
      ]);
      combined.throwIfAborted();
      const title = response
        .trim()
        .replace(/^["']|["']$/g, "")
        .trim();
      const shortened = [...title].slice(0, 19).join("").trimEnd();
      if (
        reason !== "end_turn" ||
        !shortened ||
        [...title].some(
          (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        )
      )
        throw new Error("Invalid chat title");
      return shortened;
    } finally {
      dispose();
      combined.removeEventListener("abort", onAbort);
      await session.stop(1_000);
    }
  } catch (error) {
    if (signal.aborted) throw new Error("Chat title cancelled");
    if (failure.signal.aborted) throw failure.signal.reason;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
