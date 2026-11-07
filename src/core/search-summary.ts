import type { AgentSpec, Agents } from "../agents/index.js";
import {
  renderSearchSummaryPrompt,
  SEARCH_EXCERPT_LIMIT,
  SEARCH_QUERY_LIMIT,
  SEARCH_SOURCE_LIMIT,
  SEARCH_SUMMARY_LIMIT,
  type SearchSummarySource,
} from "../contracts/index.js";

/** One background ACP turn; no run records, worktrees, gateway, or conversation state. */
export async function summarizeSearch(
  agents: Agents,
  spec: AgentSpec,
  query: string,
  sources: readonly SearchSummarySource[],
  signal: AbortSignal,
  timeoutMs = 300_000,
): Promise<string> {
  if (!query.trim() || query.length > SEARCH_QUERY_LIMIT) throw new Error("Invalid search query");
  if (
    sources.length > SEARCH_SOURCE_LIMIT ||
    sources.some((source) => source.text.length > SEARCH_EXCERPT_LIMIT)
  )
    throw new Error("Invalid search evidence");
  const failure = new AbortController();
  const timer = setTimeout(
    () => failure.abort(new Error("Overview timed out after five minutes")),
    timeoutMs,
  );
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
        if (response.length + update.text.length > SEARCH_SUMMARY_LIMIT)
          failure.abort(new Error("Overview response is too large"));
        else response += update.text;
      });
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(combined.reason);
        combined.addEventListener("abort", onAbort, { once: true });
        if (combined.aborted) onAbort();
      });
      const reason = await Promise.race([
        session.prompt(renderSearchSummaryPrompt(query, sources)),
        aborted,
        session.exited.then(() => {
          throw new Error("Overview worker exited unexpectedly");
        }),
      ]);
      combined.throwIfAborted();
      if (reason !== "end_turn")
        throw new Error(`Overview ended without a complete result (${reason})`);
      if (!response.trim()) throw new Error("The provider returned an empty overview");
      return response.trim();
    } finally {
      dispose();
      combined.removeEventListener("abort", onAbort);
      await session.stop(1_000);
    }
  } catch (error) {
    if (signal.aborted) throw new Error("Overview cancelled");
    if (failure.signal.aborted) throw failure.signal.reason;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
