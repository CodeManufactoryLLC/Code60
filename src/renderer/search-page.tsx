import { useEffect, useRef, useState } from "react";
import {
  type DesktopApi,
  type DesktopRun,
  SEARCH_QUERY_LIMIT,
  SEARCH_SOURCE_LIMIT,
} from "../bridge/index.js";
import { Icon } from "./icons.js";
import {
  highlights,
  type SearchKind,
  type SearchResult,
  searchExcerpt,
  searchIndex,
  searchResults,
  summaryParts,
  summarySources,
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

type SubmittedSearch = { query: string; results: SearchResult[] | null };
type Overview =
  | { status: "generating" }
  | { status: "complete"; text: string }
  | { status: "error"; error: string }
  | { status: "stopped" };

export function SearchPage({
  api,
  provider,
  directory,
  runs,
  data,
  onOpen,
}: {
  api: Pick<DesktopApi, "summarizeSearch" | "cancelSearchSummary">;
  provider: string | null;
  directory: string | null;
  runs: readonly DesktopRun[];
  data: Transcripts;
  onOpen(result: SearchResult): void;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<SearchKind | "all">("all");
  const [sort, setSort] = useState<"relevance" | "newest">("relevance");
  const [submitted, setSubmitted] = useState<SubmittedSearch | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const active = useRef<string | undefined>(undefined);
  const list = useRef<HTMLUListElement>(null);
  const expanded = submitted !== null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: provider changes invalidate an in-flight helper even though the provider is resolved in main.
  useEffect(() => {
    setOverview(null);
    setSubmitted((current) => (current?.results === null ? null : current));
    return () => {
      const id = active.current;
      active.current = undefined;
      if (id) void api.cancelSearchSummary(id).catch(() => {});
    };
  }, [api, provider]);

  function cancel() {
    const id = active.current;
    active.current = undefined;
    if (id) void api.cancelSearchSummary(id).catch(() => {});
  }

  async function generate(id: string, searchQuery: string, results: SearchResult[]) {
    if (!directory || active.current !== id) return;
    setOverview({ status: "generating" });
    try {
      const result = await api.summarizeSearch({
        requestId: id,
        directory,
        query: searchQuery,
        sources: summarySources(results, searchQuery),
      });
      if (active.current === id && result.requestId === id)
        setOverview({ status: "complete", text: result.text });
    } catch (error) {
      if (active.current === id)
        setOverview({
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        });
    } finally {
      if (active.current === id) active.current = undefined;
    }
  }

  async function submit() {
    if (!directory || !query.trim()) return;
    cancel();
    const id = crypto.randomUUID();
    active.current = id;
    const searchQuery = query.trim();
    setSubmitted({ query: searchQuery, results: null });
    setOverview(null);
    try {
      const events = await data.read();
      if (active.current !== id) return;
      const results = searchResults(searchIndex(directory, runs, events), searchQuery, kind, sort);
      setSubmitted({ query: searchQuery, results });
      if (results.length) await generate(id, searchQuery, results);
      else active.current = undefined;
    } catch (error) {
      if (active.current === id) {
        setSubmitted({ query: searchQuery, results: [] });
        setOverview({
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        });
        active.current = undefined;
      }
    }
  }

  function retry() {
    if (!submitted?.results?.length) return;
    cancel();
    const id = crypto.randomUUID();
    active.current = id;
    void generate(id, submitted.query, submitted.results);
  }

  return (
    <main className="search-page" aria-label="Search" data-expanded={expanded}>
      <div className="search-lead-space" aria-hidden="true" />
      <search className="search-entry">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="search-wordmark" aria-hidden={expanded}>
            <span className="wordmark">
              Code<b>60</b>
            </span>
          </div>
          <div className="search-query-row">
            <input
              className="search-query"
              aria-label="Query"
              type="search"
              value={query}
              maxLength={SEARCH_QUERY_LIMIT}
              placeholder="Search this project"
              onChange={(event) => {
                const value = event.target.value;
                setQuery(value);
                if (!value.trim()) {
                  cancel();
                  setSubmitted(null);
                  setOverview(null);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" && submitted?.results?.length) {
                  event.preventDefault();
                  list.current?.querySelector("button")?.focus();
                }
              }}
            />
            <button
              className="primary search-submit"
              type="submit"
              disabled={!directory || !query.trim()}
            >
              <Icon name="search" />
              Search
            </button>
          </div>
          <div className="search-controls" hidden={!expanded}>
            <label>
              Type
              <select
                aria-label="Type"
                value={kind}
                onChange={(event) => setKind(event.target.value as SearchKind | "all")}
              >
                {(["all", "project", "run", "prompt", "message", "thought"] as const).map(
                  (value) => (
                    <option key={value} value={value}>
                      {value === "all" ? "All types" : value[0]?.toUpperCase() + value.slice(1)}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label>
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
        </form>
      </search>
      <div className="search-content" hidden={!expanded && !!directory}>
        {expanded && <TranscriptNotice data={data} />}
        {!directory ? (
          <p>Open a project to search.</p>
        ) : submitted?.results === null ? (
          <p role="status">Searching saved transcripts…</p>
        ) : submitted && !submitted.results?.length ? (
          <p role="status">No matching results.</p>
        ) : (
          submitted?.results && (
            <div className="search-body">
              <section
                className="search-overview"
                aria-labelledby="search-overview-heading"
                aria-busy={overview?.status === "generating"}
              >
                <div className="search-overview-heading">
                  <h2 id="search-overview-heading">AI overview</h2>
                  {overview?.status === "generating" ? (
                    <button
                      type="button"
                      onClick={() => {
                        cancel();
                        setOverview({ status: "stopped" });
                      }}
                    >
                      Stop
                    </button>
                  ) : (
                    overview?.status !== "complete" && (
                      <button type="button" onClick={retry}>
                        Retry overview
                      </button>
                    )
                  )}
                </div>
                {overview?.status === "generating" ? (
                  <p role="status">Generating overview…</p>
                ) : overview?.status === "complete" ? (
                  <div className="search-overview-text">
                    {summaryParts(
                      overview.text,
                      Math.min(SEARCH_SOURCE_LIMIT, submitted.results.length),
                    ).map((part) =>
                      part.source === undefined ? (
                        part.text
                      ) : (
                        <button
                          type="button"
                          className="search-citation"
                          key={part.start}
                          aria-label={`Source ${part.source + 1}: ${submitted.results?.[part.source]?.title}`}
                          onClick={() => {
                            const source = submitted.results?.[part.source as number];
                            if (source) onOpen(source);
                          }}
                        >
                          {part.text}
                        </button>
                      ),
                    )}
                  </div>
                ) : overview?.status === "error" ? (
                  <p role="alert">{overview.error}</p>
                ) : (
                  <p role="status">
                    {overview?.status === "stopped" ? "Overview stopped." : "Overview unavailable."}
                  </p>
                )}
              </section>
              <ul
                className="search-results"
                aria-label="Search results"
                ref={list}
                onKeyDown={(event) => {
                  const buttons = [
                    ...(list.current?.querySelectorAll<HTMLButtonElement>(
                      "button[data-result-index]",
                    ) ?? []),
                  ];
                  const index = buttons.indexOf(event.target as HTMLButtonElement);
                  const next =
                    event.key === "ArrowDown"
                      ? Math.min(buttons.length - 1, index + 1)
                      : event.key === "ArrowUp"
                        ? Math.max(0, index - 1)
                        : event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? buttons.length - 1
                            : undefined;
                  if (next !== undefined) {
                    event.preventDefault();
                    buttons[next]?.focus();
                  }
                }}
              >
                {submitted.results.map((result, i) => (
                  <li key={result.id}>
                    <div className="search-result-meta">
                      <span>
                        {result.kind[0]?.toUpperCase()}
                        {result.kind.slice(1)}
                      </span>
                      {result.at && (
                        <time dateTime={result.at}>{new Date(result.at).toLocaleString()}</time>
                      )}
                    </div>
                    <h2>
                      <button
                        type="button"
                        className="search-result-title"
                        data-result-index={i}
                        onClick={() => onOpen(result)}
                      >
                        <Highlight text={result.title} query={submitted.query} />
                      </button>
                    </h2>
                    <p className="result-excerpt">
                      <Highlight
                        text={searchExcerpt(result.text, submitted.query)}
                        query={submitted.query}
                      />
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )
        )}
      </div>
    </main>
  );
}
