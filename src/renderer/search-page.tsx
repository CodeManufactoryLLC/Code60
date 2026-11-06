import { useEffect, useMemo, useRef, useState } from "react";
import type { DesktopRun } from "../bridge/index.js";
import {
  highlights,
  type SearchKind,
  type SearchResult,
  searchExcerpt,
  searchIndex,
  searchResults,
} from "./search.js";
import { TranscriptNotice, type Transcripts } from "./transcripts.js";

function Highlight({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlights(text, query).map((part) =>
        part.match ? <mark key={part.start}>{part.text}</mark> : part.text,
      )}
    </>
  );
}
export function SearchPage({
  directory,
  runs,
  data,
  onOpen,
}: {
  directory: string | null;
  runs: readonly DesktopRun[];
  data: Transcripts;
  onOpen(result: SearchResult): void;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<SearchKind | "all">("all");
  const [sort, setSort] = useState<"relevance" | "newest">("relevance");
  const expanded = query.trim().length > 0;
  const [selection, setSelection] = useState<string>();
  const list = useRef<HTMLDivElement>(null);
  const preview = useRef<HTMLElement>(null);
  const index = useMemo(
    () => (directory ? searchIndex(directory, runs, data.events) : []),
    [directory, runs, data.events],
  );
  const results = useMemo(
    () => searchResults(index, query, kind, sort),
    [index, query, kind, sort],
  );
  const selected = results.find((row) => row.id === selection) ?? results[0];
  const selectedIndex = selected ? results.indexOf(selected) : -1;
  useEffect(() => {
    if (selected)
      list.current
        ?.querySelector(`[data-result-index="${selectedIndex}"]`)
        ?.scrollIntoView({ block: "nearest" });
  }, [selected, selectedIndex]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-scroll the preview after its text and marks change.
  useEffect(() => {
    if (!preview.current) return;
    const first = preview.current.querySelector("mark");
    if (first) first.scrollIntoView({ block: "nearest" });
    else preview.current.scrollTop = 0;
  }, [selected, query]);
  return (
    <main className="search-page" aria-label="Search" data-expanded={expanded}>
      <div className="search-lead-space" aria-hidden="true" />
      <div className="search-entry">
        <div className="search-wordmark" aria-hidden={expanded}>
          <span className="wordmark">
            Code<b>60</b>
          </span>
        </div>
        <div className="search-controls">
          <input
            className="search-query"
            aria-label="Query"
            type="search"
            value={query}
            placeholder="Search this project"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                list.current?.focus();
              }
              if (event.key === "Enter" && selected) onOpen(selected);
            }}
          />
          <label hidden={!expanded}>
            Type
            <select
              aria-label="Type"
              value={kind}
              onChange={(event) => setKind(event.target.value as SearchKind | "all")}
            >
              {(["all", "project", "run", "prompt", "message", "thought"] as const).map((value) => (
                <option key={value} value={value}>
                  {value === "all" ? "All types" : value[0]?.toUpperCase() + value.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <label hidden={!expanded}>
            Sort
            <select
              aria-label="Sort"
              value={sort}
              onChange={(event) => setSort(event.target.value as typeof sort)}
            >
              <option value="relevance">Relevance</option>
              <option value="newest">Newest</option>
            </select>
          </label>
        </div>
      </div>
      <div className="search-content" hidden={!expanded && !!directory}>
        <TranscriptNotice data={data} />
        {!directory ? (
          <p>Open a project to search.</p>
        ) : !query.trim() ? null : !results.length ? (
          <p role="status">
            {data.pending ? "Searching saved transcripts…" : "No matching results."}
          </p>
        ) : (
          <div className="search-body">
            <div
              className="search-results"
              role="listbox"
              aria-label="Search results"
              tabIndex={0}
              ref={list}
              aria-activedescendant={selected ? `search-result-${selectedIndex}` : undefined}
              onKeyDown={(event) => {
                const next =
                  event.key === "ArrowDown"
                    ? Math.min(results.length - 1, selectedIndex + 1)
                    : event.key === "ArrowUp"
                      ? Math.max(0, selectedIndex - 1)
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? results.length - 1
                          : undefined;
                if (next !== undefined) {
                  event.preventDefault();
                  setSelection(results[next]?.id);
                }
                if (event.key === "Enter" && selected) {
                  event.preventDefault();
                  onOpen(selected);
                }
              }}
            >
              {results.map((result, i) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={result.id === selected?.id}
                  tabIndex={-1}
                  id={`search-result-${i}`}
                  data-result-index={i}
                  key={result.id}
                  onClick={() => setSelection(result.id)}
                  onDoubleClick={() => onOpen(result)}
                >
                  <strong>
                    <Highlight text={result.title} query={query} />
                  </strong>
                  <span className="result-excerpt">
                    <Highlight text={searchExcerpt(result.text, query)} query={query} />
                  </span>
                  {result.at && (
                    <time dateTime={result.at}>{new Date(result.at).toLocaleString()}</time>
                  )}
                </button>
              ))}
            </div>
            {selected && (
              <section className="search-preview" aria-label="Result preview" ref={preview}>
                <header>
                  <h2>{selected.title}</h2>
                  <button type="button" onClick={() => onOpen(selected)}>
                    {selected.kind === "project" ? "Open project" : "Open chat"}
                  </button>
                </header>
                <pre>
                  <Highlight text={selected.text} query={query} />
                </pre>
              </section>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
