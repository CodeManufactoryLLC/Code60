import { useEffect, useRef, useState } from "react";
import {
  type DesktopApi,
  type DesktopRun,
  SEARCH_QUERY_LIMIT,
  type SearchSummarySource,
} from "../bridge/index.js";
import { Icon } from "./icons.js";
import {
  highlights,
  type SearchKind,
  type SearchResult,
  searchContext,
  searchExcerpt,
  searchIndex,
  searchResults,
  sourceResult,
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

const typeLabels = {
  all: "All types",
  file: "File",
  project: "Project",
  run: "Run",
  prompt: "Prompt",
  message: "Message",
  thought: "Thought",
} satisfies Record<SearchKind | "all", string>;
const sortLabels = { relevance: "Relevance", newest: "Newest" };
const unappliedLabel = "Unapplied Search Changes";

type SearchCriteria = {
  query: string;
  kind: keyof typeof typeLabels;
  sort: keyof typeof sortLabels;
};
type SubmittedSearch = SearchCriteria & {
  results: SearchResult[] | null;
  evidence: SearchResult[];
};
type Overview =
  | { status: "generating" }
  | { status: "complete"; text: string; sources: SearchSummarySource[] }
  | { status: "error"; error: string };

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
  const [kind, setKind] = useState<SearchCriteria["kind"]>("all");
  const [sort, setSort] = useState<SearchCriteria["sort"]>("relevance");
  const [submitted, setSubmitted] = useState<SubmittedSearch | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const active = useRef<string | undefined>(undefined);
  const list = useRef<HTMLUListElement>(null);
  const expanded = submitted !== null;
  const loading = submitted?.results === null || overview?.status === "generating";
  const unapplied =
    submitted !== null &&
    (query.trim() !== submitted.query || kind !== submitted.kind || sort !== submitted.sort);

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

  async function generate(id: string, search: SubmittedSearch) {
    if (!directory || active.current !== id) return;
    setOverview({ status: "generating" });
    try {
      const result = await api.summarizeSearch({
        requestId: id,
        directory,
        query: search.query,
        sources: summarySources(search.evidence, search.query),
        includeFiles: search.kind === "all" || search.kind === "file",
      });
      if (active.current === id && result.requestId === id) {
        setOverview({ status: "complete", text: result.text, sources: result.sources });
        setSubmitted((current) => {
          if (!current) return current;
          const rows = current.results ?? [];
          const seen = new Set(rows.map((row) => row.id));
          return {
            ...current,
            results: [
              ...rows,
              ...result.sources.filter((source) => !seen.has(source.id)).map(sourceResult),
            ],
          };
        });
      }
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
    const criteria = { query: query.trim(), kind, sort };
    if (!directory || !criteria.query) return;
    cancel();
    const id = crypto.randomUUID();
    active.current = id;
    setSubmitted({ ...criteria, results: null, evidence: [] });
    setOverview(null);
    try {
      const events = await data.read();
      if (active.current !== id) return;
      const index = searchIndex(directory, runs, events);
      const results = searchResults(index, criteria.query, criteria.kind, criteria.sort);
      const search = {
        ...criteria,
        results,
        evidence: results.length ? results : searchContext(index, criteria.query, criteria.kind),
      };
      setSubmitted(search);
      await generate(id, search);
    } catch (error) {
      if (active.current === id) {
        setSubmitted({ ...criteria, results: [], evidence: [] });
        setOverview({
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        });
        active.current = undefined;
      }
    }
  }

  function retry() {
    if (!submitted) return;
    cancel();
    const id = crypto.randomUUID();
    active.current = id;
    void generate(id, submitted);
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
          <div className="search-query-row">
            <div className="search-query-action">
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
            <div className="search-controls">
              <select
                aria-label="Type"
                value={kind}
                onChange={(event) => setKind(event.target.value as SearchCriteria["kind"])}
              >
                {Object.entries(typeLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <select
                aria-label="Sort"
                value={sort}
                onChange={(event) => setSort(event.target.value as SearchCriteria["sort"])}
              >
                {Object.entries(sortLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              {unapplied && (
                <span
                  className="search-unapplied"
                  role="img"
                  aria-label={unappliedLabel}
                  data-tooltip={unappliedLabel}
                  // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard access exposes the status tooltip.
                  tabIndex={0}
                >
                  <Icon name="information" />
                </span>
              )}
              <p className="sr-only" role="status">
                {unapplied ? unappliedLabel : ""}
              </p>
            </div>
          </div>
        </form>
      </search>
      <div className="search-content" hidden={!expanded && !!directory}>
        {!directory && <p>Open a project to search.</p>}
        {expanded && (
          <div className="search-pending" hidden={!loading} inert={!loading}>
            <div className="search-loading" role="status">
              <span className="search-loading-art" aria-hidden="true">
                <Icon name="search" />
              </span>
              <span className="search-loading-label">Searching...</span>
            </div>
          </div>
        )}
        {expanded && <TranscriptNotice data={data} />}
        {expanded && (
          <div className="search-pending search-placeholders" hidden={!loading} aria-hidden="true">
            <div className="search-overview search-summary-skeleton">
              <span className="search-skeleton-title" />
              <div className="search-skeleton-paragraph">
                <span />
                <span />
                <span />
              </div>
              <div className="search-skeleton-paragraph">
                <span />
                <span />
              </div>
            </div>
            <ul className="search-skeleton">
              {[1, 2].map((row) => (
                <li key={row}>
                  <span className="search-skeleton-timestamp" />
                  <span className="search-skeleton-title" />
                  <span className="search-skeleton-snippet" />
                </li>
              ))}
            </ul>
          </div>
        )}
        {submitted?.results && (
          <div className="search-body">
            {!loading && (
              <section className="search-overview" aria-labelledby="search-overview-heading">
                <div className="search-overview-heading">
                  <h2 id="search-overview-heading">AI overview</h2>
                  {overview?.status !== "complete" && (
                    <button type="button" onClick={retry}>
                      Retry overview
                    </button>
                  )}
                </div>
                {overview?.status === "complete" ? (
                  <div className="search-overview-text">
                    {summaryParts(overview.text, overview.sources.length).map((part) =>
                      part.source === undefined ? (
                        part.text
                      ) : (
                        <button
                          type="button"
                          className="search-citation"
                          key={part.start}
                          aria-label={`Source ${part.source + 1}: ${overview.sources[part.source]?.title}`}
                          onClick={() => {
                            const source = overview.sources[part.source as number];
                            if (source) onOpen(sourceResult(source));
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
                  <p role="status">Overview unavailable.</p>
                )}
              </section>
            )}
            {!submitted.results.length && !loading && <p role="status">No matching results.</p>}
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
              {submitted.results.map((result, i) => {
                const type = typeLabels[result.kind];
                const showType = !result.title.startsWith(`${type} / `);
                return (
                  <li key={result.id}>
                    {(showType || result.at) && (
                      <div className="search-result-meta">
                        {showType && <span>{type}</span>}
                        {result.at && (
                          <time dateTime={result.at}>{new Date(result.at).toLocaleString()}</time>
                        )}
                      </div>
                    )}
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
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </main>
  );
}
