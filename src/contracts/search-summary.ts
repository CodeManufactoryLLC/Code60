import { DEFAULT_PROMPT_TEMPLATES, SEARCH_OVERVIEW_GUARDRAIL } from "./prompts.js";

export const SEARCH_SOURCE_LIMIT = 20;
export const SEARCH_EXCERPT_LIMIT = 4_000;
export const SEARCH_QUERY_LIMIT = 2_048;
export const SEARCH_SUMMARY_LIMIT = 16_000;

const queryStopWords = new Set(
  "a about an and are as at be can do does for how i in is it me of on or please project tell that the this to was what when where which who why with you".split(
    " ",
  ),
);
export function searchKeywords(query: string): string[] {
  return [...new Set(query.toLocaleLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [])].filter(
    (word) => !queryStopWords.has(word),
  );
}

export function searchEvidenceExcerpt(text: string, query: string): string {
  if (text.length <= SEARCH_EXCERPT_LIMIT) return text;
  const lower = text.toLocaleLowerCase();
  const positions = searchKeywords(query)
    .map((term) => lower.indexOf(term))
    .filter((at) => at >= 0);
  const match = positions.length ? Math.min(...positions) : 0;
  const start = Math.max(0, match - Math.floor(SEARCH_EXCERPT_LIMIT / 3));
  return `${start ? "…" : ""}${text.slice(start, start + SEARCH_EXCERPT_LIMIT - 2)}…`;
}

export interface SearchSummarySource {
  id: string;
  kind: "project" | "run" | "prompt" | "message" | "thought" | "file";
  title: string;
  text: string;
  runId?: string | undefined;
  eventIndex?: number | undefined;
  path?: string;
}

export function renderSearchSummaryPrompt(
  query: string,
  sources: readonly SearchSummarySource[],
  instructions: string = DEFAULT_PROMPT_TEMPLATES["utility.search-overview"],
): string {
  return [
    instructions,
    SEARCH_OVERVIEW_GUARDRAIL,
    "Search data (JSON):",
    JSON.stringify({ query, results: sources }),
  ].join("\n\n");
}
