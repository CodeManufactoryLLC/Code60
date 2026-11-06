import type { DesktopRun } from "../bridge/index.js";
import type { RunEvent } from "../core/index.js";
import { messageRows } from "./messages.js";

export type SearchKind = "project" | "run" | "prompt" | "message" | "thought";
export interface SearchResult {
  id: string;
  kind: SearchKind;
  title: string;
  text: string;
  at: string;
  runId?: string;
  eventIndex?: number;
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
      title: directory.split("/").filter(Boolean).at(-1) ?? directory,
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
export function queryTerms(query: string): string[] {
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
