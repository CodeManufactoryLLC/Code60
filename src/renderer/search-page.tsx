import { InlineLoading, Search } from "@carbon/react";
import { useEffect, useRef, useState } from "react";
import {
  type ApplicationClient,
  type ProjectSearchOpened,
  type ProjectSearchSource,
  SEARCH_QUERY_LIMIT,
} from "../bridge/index.js";
import { randomId } from "./browser-platform.js";
import { Button as AppButton } from "./carbon/button.js";
import { Select as CarbonSelect } from "./carbon/fields.js";
import { Icon } from "./icons.js";
import { Modal } from "./modal.js";
import { PageTitle } from "./page-title.js";
import { highlights, type SearchKind, searchExcerpt, summaryParts } from "./search.js";

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
// Carbon forwards native input attributes to its search field.
const searchInput = { type: "search", maxLength: SEARCH_QUERY_LIMIT };
const sortLabels = { relevance: "Relevance", newest: "Newest" };
const unappliedLabel = "Unapplied Search Changes";

type SearchCriteria = {
  query: string;
  kind: keyof typeof typeLabels;
  sort: keyof typeof sortLabels;
};
type SubmittedSearch = SearchCriteria & {
  results: ProjectSearchSource[] | null;
  nextCursor: string | null;
  warnings: string[];
  error?: string;
};
type Overview =
  | { status: "generating" }
  | { status: "complete"; text: string; sources: ProjectSearchSource[] }
  | { status: "error"; error: string };

export function SearchPage({
  api,
  provider,
  database,
  databaseEpoch,
  hasProjects,
  onProjects,
  onOpen,
}: {
  api: Pick<
    ApplicationClient,
    | "searchProjects"
    | "searchProjectsPage"
    | "cancelProjectSearch"
    | "openSearchSource"
    | "summarizeSearch"
    | "cancelSearchSummary"
  >;
  provider: string | null;
  database: string | null;
  databaseEpoch: number;
  hasProjects: boolean;
  onProjects(): void;
  onOpen(result: ProjectSearchOpened): void;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<SearchCriteria["kind"]>("all");
  const [sort, setSort] = useState<SearchCriteria["sort"]>("relevance");
  const [submitted, setSubmitted] = useState<SubmittedSearch | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const [sourceError, setSourceError] = useState("");
  const [opening, setOpening] = useState(false);
  const [selectedSource, setSelectedSource] = useState<string>();
  const [preview, setPreview] = useState<ProjectSearchSource | null>(null);
  const active = useRef<string | undefined>(undefined);
  const summaryActive = useRef<string | undefined>(undefined);
  const providerRef = useRef(provider);
  providerRef.current = provider;
  const list = useRef<HTMLUListElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const expanded = submitted !== null;
  const loading =
    (!submitted?.error && submitted?.results === null) || overview?.status === "generating";
  const related =
    submitted?.results?.length === 0 && overview?.status === "complete" ? overview.sources : [];
  const displayed = submitted?.results?.length ? submitted.results : related;
  const unapplied =
    submitted !== null &&
    (query.trim() !== submitted.query || kind !== submitted.kind || sort !== submitted.sort);

  useEffect(
    () => () => {
      const id = active.current;
      active.current = undefined;
      if (id) void api.cancelProjectSearch({ requestId: id, databaseEpoch }).catch(() => {});
      const summary = summaryActive.current;
      summaryActive.current = undefined;
      if (summary) void api.cancelSearchSummary(summary).catch(() => {});
    },
    [api, databaseEpoch],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: Provider changes retire only the overview; submitted literal results remain usable.
  useEffect(() => {
    setOverview(null);
    const id = summaryActive.current;
    summaryActive.current = undefined;
    if (id) void api.cancelSearchSummary(id).catch(() => {});
  }, [api, provider]);

  function cancel() {
    setSelectedSource(undefined);
    setPreview(null);
    setOpening(false);
    const id = active.current;
    active.current = undefined;
    if (id) void api.cancelProjectSearch({ requestId: id, databaseEpoch }).catch(() => {});
    const summary = summaryActive.current;
    summaryActive.current = undefined;
    if (summary) void api.cancelSearchSummary(summary).catch(() => {});
    setPageLoading(false);
  }

  async function generate(searchId: string) {
    if (active.current !== searchId) return;
    const previous = summaryActive.current;
    if (previous) void api.cancelSearchSummary(previous).catch(() => {});
    if (!providerRef.current) {
      setOverview({
        status: "error",
        error: "Select an available orchestration provider in Settings for an overview.",
      });
      return;
    }
    const id = randomId();
    summaryActive.current = id;
    setOverview({ status: "generating" });
    try {
      const result = await api.summarizeSearch({ requestId: id, searchId, databaseEpoch });
      if (active.current === searchId && summaryActive.current === id && result.requestId === id) {
        setOverview({ status: "complete", text: result.text, sources: result.sources });
      }
    } catch (error) {
      if (active.current === searchId && summaryActive.current === id)
        setOverview({
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        });
    } finally {
      if (summaryActive.current === id) summaryActive.current = undefined;
    }
  }

  async function submit() {
    const criteria = { query: query.trim(), kind, sort };
    if (!database || !criteria.query) return;
    cancel();
    const id = randomId();
    active.current = id;
    setSubmitted({ ...criteria, results: null, nextCursor: null, warnings: [] });
    setOverview(null);
    setSourceError("");
    content.current?.scrollTo({ top: 0, behavior: "instant" });
    try {
      const page = await api.searchProjects({ requestId: id, databaseEpoch, ...criteria });
      if (active.current !== id || page.requestId !== id) return;
      setSubmitted({
        ...criteria,
        results: page.results,
        nextCursor: page.nextCursor,
        warnings: page.warnings,
      });
      await generate(id);
    } catch (error) {
      if (active.current === id) {
        setSubmitted({
          ...criteria,
          results: null,
          nextCursor: null,
          warnings: [],
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  function retry() {
    if (active.current) void generate(active.current);
  }
  async function loadMore() {
    const id = active.current;
    const cursor = submitted?.nextCursor;
    if (!id || !cursor || pageLoading) return;
    setPageLoading(true);
    try {
      const page = await api.searchProjectsPage({ requestId: id, databaseEpoch, cursor });
      if (active.current !== id) return;
      setSubmitted((current) => {
        if (!current) return current;
        const rows = current.results ?? [];
        const seen = new Set(rows.map((row) => row.id));
        return {
          ...current,
          results: [...rows, ...page.results.filter((row) => !seen.has(row.id))],
          nextCursor: page.nextCursor,
        };
      });
    } catch (error) {
      if (active.current === id)
        setSourceError(error instanceof Error ? error.message : String(error));
    } finally {
      if (active.current === id) setPageLoading(false);
    }
  }
  async function openSource(source: ProjectSearchSource) {
    const id = active.current;
    if (!id || opening) return;
    setOpening(true);
    setSourceError("");
    try {
      const target = await api.openSearchSource({
        requestId: id,
        databaseEpoch,
        sourceId: source.id,
      });
      if (active.current !== id || !target) return;
      if (target.archived) setPreview(source);
      else onOpen(target);
    } catch (error) {
      if (active.current === id)
        setSourceError(error instanceof Error ? error.message : String(error));
    } finally {
      if (active.current === id) setOpening(false);
    }
  }

  return (
    <main className="search-page" aria-label="Search" data-expanded={expanded}>
      <PageTitle page="search" className="table-title" />
      <div className="search-entry">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="search-query-row">
            <div className="search-query-action">
              <Search
                size="lg"
                className="search-query"
                labelText="Query"
                {...searchInput}
                value={query}
                placeholder="Search all projects"
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
              <AppButton
                className="primary search-submit"
                type="submit"
                disabled={!database || !hasProjects || !query.trim()}
              >
                <Icon name="search" />
                Search
              </AppButton>
            </div>
            <div className="search-controls">
              <CarbonSelect
                labelText="Record type"
                value={kind}
                onChange={(event) => setKind(event.target.value as SearchCriteria["kind"])}
              >
                {Object.entries(typeLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </CarbonSelect>
              <CarbonSelect
                labelText="Sort by"
                value={sort}
                onChange={(event) => setSort(event.target.value as SearchCriteria["sort"])}
              >
                {Object.entries(sortLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </CarbonSelect>
              {unapplied && <span className="search-unapplied">{unappliedLabel}</span>}
              <p className="sr-only" role="status">
                {unapplied ? unappliedLabel : ""}
              </p>
            </div>
          </div>
        </form>
      </div>
      <div ref={content} className="search-content" hidden={!expanded && !!database && hasProjects}>
        {!database && <p>Connect to a database to search.</p>}
        {database && !hasProjects && (
          <section>
            <h2>No projects in this database</h2>
            <AppButton onClick={onProjects}>Open projects</AppButton>
          </section>
        )}
        {submitted?.error && (
          <section>
            <p role="alert">Search unavailable. {submitted.error}</p>
            <AppButton onClick={() => void submit()}>Retry search</AppButton>
          </section>
        )}
        {loading && (
          <InlineLoading
            description={submitted?.results === null ? "Searching…" : "Generating overview…"}
          />
        )}
        {sourceError && <p role="alert">{sourceError}</p>}
        {!!submitted?.warnings.length && (
          <details className="search-warnings">
            <summary>Some sources could not be searched</summary>
            <ul>
              {submitted.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </details>
        )}

        {submitted?.results && (
          <div className="search-body">
            {!loading && (
              <section className="search-overview" aria-labelledby="search-overview-heading">
                <div className="search-overview-heading">
                  <h2 id="search-overview-heading">AI overview</h2>
                  {overview?.status !== "complete" && (
                    <AppButton type="button" onClick={retry}>
                      Retry overview
                    </AppButton>
                  )}
                </div>
                {overview?.status === "complete" ? (
                  <div className="search-overview-text">
                    {summaryParts(overview.text, overview.sources.length).map((part) =>
                      part.source === undefined ? (
                        part.text
                      ) : (
                        <AppButton
                          type="button"
                          className="search-citation"
                          key={part.start}
                          aria-label={`Source ${part.source + 1}: ${overview.sources[part.source]?.title} · ${overview.sources[part.source]?.project.name}`}
                          data-tooltip={overview.sources[part.source]?.project.name}
                          onClick={() => {
                            const source = overview.sources[part.source as number];
                            if (source) void openSource(source);
                          }}
                        >
                          {part.text}
                        </AppButton>
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
            {!submitted.results.length && !loading && !sourceError && (
              <section>
                <p role="status">No matching results.</p>
                <AppButton
                  onClick={() => {
                    cancel();
                    setQuery("");
                    setSubmitted(null);
                    setOverview(null);
                    list.current?.closest("main")?.querySelector("input")?.focus();
                  }}
                >
                  Clear search
                </AppButton>
              </section>
            )}
            {related.length > 0 && <h2>Related sources</h2>}
            <ul
              className="search-results"
              aria-label={related.length ? "Related sources" : "Search results"}
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
              {displayed.map((result, i) => {
                const type = typeLabels[result.kind];
                const showType = !result.title.startsWith(`${type} / `);
                return (
                  <li key={result.id}>
                    {(result.project || showType || result.at) && (
                      <div className="search-result-meta">
                        <span>{result.project.name}</span>
                        {showType && <span>{type}</span>}
                        {result.at && (
                          <time dateTime={result.at}>{new Date(result.at).toLocaleString()}</time>
                        )}
                      </div>
                    )}
                    <h2>
                      <AppButton
                        type="button"
                        className="search-result-title"
                        variant="quiet"
                        data-result-index={i}
                        aria-expanded={selectedSource === result.id}
                        onClick={() =>
                          setSelectedSource(selectedSource === result.id ? undefined : result.id)
                        }
                      >
                        <Highlight text={result.title} query={submitted.query} />
                      </AppButton>
                    </h2>
                    {selectedSource === result.id ? (
                      <section className="search-source-detail" aria-label="Selected record">
                        <pre>{result.text}</pre>
                        <AppButton
                          type="button"
                          disabled={opening}
                          onClick={() => void openSource(result)}
                        >
                          Open source
                        </AppButton>
                      </section>
                    ) : (
                      <p className="result-excerpt">
                        <Highlight
                          text={searchExcerpt(result.text, submitted.query)}
                          query={submitted.query}
                        />
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
            {submitted.nextCursor && (
              <AppButton type="button" disabled={pageLoading} onClick={() => void loadMore()}>
                {pageLoading ? "Loading…" : "Load more"}
              </AppButton>
            )}
          </div>
        )}
      </div>
      {preview && (
        <Modal title={preview.title} busy={false} onClose={() => setPreview(null)}>
          <p>{preview.project.name} · Archived conversation</p>
          <pre>{preview.text}</pre>
        </Modal>
      )}
    </main>
  );
}
