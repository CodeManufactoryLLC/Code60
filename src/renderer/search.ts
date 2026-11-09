import {
  type DesktopRun,
  SEARCH_SOURCE_LIMIT,
  type SearchSummaryRequest,
  type SearchSummarySource,
  searchEvidenceExcerpt,
  searchKeywords,
} from "../bridge/index.js";
import type { RunEvent } from "../core/index.js";
import { messageRows } from "./messages.js";
import { pathLabel } from "./path-label.js";

export type SearchKind = "project" | "run" | "prompt" | "message" | "thought" | "file";
export interface SearchResult {
  id: string;
  kind: SearchKind;
  title: string;
  text: string;
  at: string;
  runId?: string;
  eventIndex?: number;
  path?: string;
}
export function searchIndex(
  directory: string,
  runs: readonly DesktopRun[],
  events: Readonly<Record<string, readonly RunEvent[]>>,
): SearchResult[] {
  return [
    {
      id: directory,
      kind: "project",
      title: pathLabel(directory),
      text: directory,
      at: "",
    },
    ...runs.map(
      ({ record }): SearchResult => ({
        id: record.id,
        kind: "run",
        title: `${record.agent} / ${record.id}`,
        text: [record.firstPrompt, record.status, record.branch, record.worktree]
          .filter(Boolean)
          .join("\n"),
        at: record.startedAt,
        runId: record.id,
      }),
    ),
    ...messageRows(runs, events).map((row): SearchResult => {
      const colon = row.id.lastIndexOf(":");
      const runId = row.id.slice(0, colon);
      return {
        id: row.id,
        kind: row.kind.toLowerCase() as SearchKind,
        title: `${row.kind} / ${row.agent} / ${row.session}`,
        text: row.text,
        at: row.at,
        runId,
        eventIndex: Number(row.id.slice(colon + 1)),
      };
    }),
  ];
}
function queryTerms(query: string): string[] {
  return [...new Set(query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean))];
}
export function searchResults(
  index: readonly SearchResult[],
  query: string,
  kind: SearchKind | "all" = "all",
  sort: "relevance" | "newest" = "relevance",
): SearchResult[] {
  const terms = queryTerms(query);
  if (!terms.length) return [];
  const score = (row: SearchResult) => {
    const title = row.title.toLocaleLowerCase();
    return (
      (row.id.toLocaleLowerCase() === query.trim().toLocaleLowerCase()
        ? 2000
        : row.runId?.toLocaleLowerCase() === query.trim().toLocaleLowerCase()
          ? 500
          : 0) +
      terms.filter((term) => title.includes(term)).length * 10
    );
  };
  return index
    .filter(
      (row) =>
        (kind === "all" || row.kind === kind) &&
        terms.every((term) =>
          `${row.title}\n${row.text}\n${row.runId ?? ""}`.toLocaleLowerCase().includes(term),
        ),
    )
    .sort(
      (a, b) =>
        (sort === "relevance" ? score(b) - score(a) : 0) ||
        (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0) ||
        a.id.localeCompare(b.id),
    );
}
/** Text-only highlight segments; no HTML from transcripts is interpreted. */
export function highlights(
  text: string,
  query: string,
): { text: string; match: boolean; start: number }[] {
  const terms = queryTerms(query);
  const lower = text.toLocaleLowerCase();
  const ranges: [number, number][] = [];
  for (const term of terms) {
    let start = lower.indexOf(term);
    while (start >= 0) {
      ranges.push([start, start + term.length]);
      start = lower.indexOf(term, start + term.length);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  const result: { text: string; match: boolean; start: number }[] = [];
  let end = 0;
  for (const [a, b] of merged) {
    if (a > end) result.push({ text: text.slice(end, a), match: false, start: end });
    result.push({ text: text.slice(a, b), match: true, start: a });
    end = b;
  }
  if (end < text.length) result.push({ text: text.slice(end), match: false, start: end });
  return result;
}

/** Show the matching line rather than repeating an entire run's metadata in each row. */
export function searchExcerpt(text: string, query: string, limit = 220): string {
  const lower = text.toLocaleLowerCase();
  const offsets = queryTerms(query)
    .map((term) => lower.indexOf(term))
    .filter((offset) => offset >= 0);
  const match = offsets.length ? Math.min(...offsets) : 0;
  const lineStart = text.lastIndexOf("\n", match) + 1;
  const lineEnd = text.indexOf("\n", match);
  const start = Math.max(lineStart, match - 60);
  const end = Math.min(lineEnd < 0 ? text.length : lineEnd, start + limit);
  return `${start > lineStart ? "…" : ""}${text.slice(start, end)}${end < (lineEnd < 0 ? text.length : lineEnd) ? "…" : ""}`;
}

/** A bounded, multiline window around the first matching term, in submitted order. */
export function summarySources(
  results: readonly SearchResult[],
  query: string,
): SearchSummaryRequest["sources"] {
  return results
    .filter((result) => result.kind !== "file")
    .slice(0, SEARCH_SOURCE_LIMIT)
    .map((result) => {
      const text = searchEvidenceExcerpt(result.text, query);
      return {
        id: result.id,
        kind: result.kind as Exclude<SearchKind, "file">,
        title: result.title.slice(0, 512),
        text,
        ...(result.runId === undefined ? {} : { runId: result.runId }),
        ...(result.eventIndex === undefined ? {} : { eventIndex: result.eventIndex }),
      };
    });
}

/** Natural-language questions can use relevant saved context even without an exact phrase match. */
export function searchContext(
  index: readonly SearchResult[],
  query: string,
  kind: SearchKind | "all",
): SearchResult[] {
  const terms = searchKeywords(query);
  return index
    .filter((row) => kind === "all" || row.kind === kind)
    .map((row) => ({
      row,
      score: terms.filter((term) => `${row.title}\n${row.text}`.toLocaleLowerCase().includes(term))
        .length,
    }))
    .sort((a, b) => b.score - a.score || (Date.parse(b.row.at) || 0) - (Date.parse(a.row.at) || 0))
    .slice(0, 10)
    .map(({ row }) => row);
}

export function sourceResult(source: SearchSummarySource): SearchResult {
  const { runId, eventIndex, ...rest } = source;
  return {
    ...rest,
    at: "",
    ...(runId === undefined ? {} : { runId }),
    ...(eventIndex === undefined ? {} : { eventIndex }),
  };
}

/** Only in-range numeric references become local actions; everything else stays literal text. */
export function summaryParts(
  text: string,
  sourceCount: number,
): { text: string; source?: number; start?: number }[] {
  const parts: { text: string; source?: number; start?: number }[] = [];
  let end = 0;
  for (const match of text.matchAll(/\[([1-9]\d*)\]/g)) {
    const number = Number(match[1]);
    if (!Number.isSafeInteger(number) || number > sourceCount) continue;
    const start = match.index;
    if (start > end) parts.push({ text: text.slice(end, start) });
    parts.push({ text: match[0], source: number - 1, start });
    end = start + match[0].length;
  }
  if (end < text.length) parts.push({ text: text.slice(end) });
  return parts;
}
