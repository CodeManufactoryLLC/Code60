import { Add, Renew, Search as SearchIcon } from "@carbon/icons-react";
import {
  Button,
  Dropdown,
  InlineNotification,
  Tab,
  TabList,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableExpandedRow,
  TableExpandHeader,
  TableExpandRow,
  TableHead,
  TableHeader,
  TableRow,
  TabPanel,
  TabPanels,
  Tabs,
  Tag,
  TextInput,
} from "@carbon/react";
import { type FormEvent, Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ApplicationClient,
  CodebaseIndexedRepository,
  CodebaseIndexOverview,
  CodebaseSearchResult,
} from "../bridge/index.js";
import { PageTitle } from "./page-title.js";
import { useDocumentVisible } from "./use-document-visible.js";

const LIMIT_ITEMS = [
  { id: 5, label: "5" },
  { id: 10, label: "10" },
  { id: 20, label: "20" },
] as const;

function formatNumber(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"] as const;
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  const decimals = unitIndex === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(decimals)} ${units[unitIndex]}`;
}

function formatDuration(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms)) return null;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return "Never";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusMeta(repo: CodebaseIndexedRepository): {
  label: string;
  tagType: "green" | "blue" | "red" | "gray";
} {
  switch (repo.status) {
    case "ready":
      return { label: "Ready", tagType: "green" };
    case "indexing": {
      const p = repo.progress;
      const detail =
        p && p.filesTotal > 0 ? `Indexing (${p.filesIndexed}/${p.filesTotal})` : "Indexing";
      return { label: detail, tagType: "blue" };
    }
    case "error":
      return { label: "Error", tagType: "red" };
    default:
      return { label: "Unindexed", tagType: "gray" };
  }
}

function shortCommit(commit: string | null): string {
  return commit ? commit.slice(0, 7) : "—";
}

function formatFetchStatus(status: CodebaseIndexedRepository["fetchStatus"]): string {
  switch (status) {
    case "fetched":
      return "Fetched origin";
    case "cached":
      return "Cached";
    case "no_remote":
      return "Local only";
    case "failed":
      return "Fetch failed";
    case "skipped":
      return "Skipped";
  }
}

export function VectorSearchPage({
  api,
  active,
  onNotify,
}: {
  api: Pick<
    ApplicationClient,
    | "codebaseIndexOverview"
    | "codebaseIndexReindex"
    | "codebaseIndexAdd"
    | "codebaseIndexRemove"
    | "codebaseIndexSearch"
    | "onCodebaseIndexChanged"
  >;
  active: boolean;
  onNotify?: (message: string) => void;
}) {
  const visible = useDocumentVisible();
  const [tabIndex, setTabIndex] = useState(0);
  const [overview, setOverview] = useState<CodebaseIndexOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busyKeys, setBusyKeys] = useState<Record<string, "reindex" | "remove">>({});
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const [selectedRepoKey, setSelectedRepoKey] = useState<string>("");
  const [queryText, setQueryText] = useState("");
  const [pathPrefix, setPathPrefix] = useState("");
  const [language, setLanguage] = useState("");
  const [limit, setLimit] = useState<number>(10);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResult, setSearchResult] = useState<CodebaseSearchResult | null>(null);

  const overviewSeq = useRef(0);
  const searchSeq = useRef(0);

  const loadOverview = useCallback(async () => {
    const seq = ++overviewSeq.current;
    setLoading(true);
    try {
      const next = await api.codebaseIndexOverview();
      if (seq !== overviewSeq.current) return;
      setOverview(next);
      setError(null);
    } catch (cause) {
      if (seq !== overviewSeq.current) return;
      setError(cause instanceof Error ? cause.message : "Could not load vector index status.");
    } finally {
      if (seq === overviewSeq.current) setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (!active || !visible) return;
    void loadOverview();
    const unsubscribe = api.onCodebaseIndexChanged(() => {
      void loadOverview();
    });
    return () => {
      overviewSeq.current++;
      unsubscribe();
    };
  }, [active, visible, api, loadOverview]);

  const repositories = overview?.repositories ?? [];
  const searchableRepos = useMemo(
    () => repositories.filter((repo) => repo.status === "ready" || repo.chunkCount > 0),
    [repositories],
  );

  useEffect(() => {
    if (searchableRepos.length === 0) {
      if (selectedRepoKey) setSelectedRepoKey("");
      return;
    }
    if (!searchableRepos.some((repo) => repo.repoKey === selectedRepoKey)) {
      setSelectedRepoKey(searchableRepos[0]?.repoKey ?? "");
    }
  }, [searchableRepos, selectedRepoKey]);

  const handleAddRepository = async () => {
    setAdding(true);
    setError(null);
    try {
      const result = await api.codebaseIndexAdd();
      if (result.added) {
        onNotify?.("Repository indexing started.");
        await loadOverview();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not index repository.");
    } finally {
      setAdding(false);
    }
  };

  const handleReindex = async (repo: CodebaseIndexedRepository) => {
    setBusyKeys((current) => ({ ...current, [repo.repoKey]: "reindex" }));
    setError(null);
    try {
      const result = await api.codebaseIndexReindex({ repoKey: repo.repoKey });
      if (result.started) onNotify?.(`Re-indexing ${repo.name}.`);
      await loadOverview();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not re-index ${repo.name}.`);
    } finally {
      setBusyKeys((current) => {
        const next = { ...current };
        delete next[repo.repoKey];
        return next;
      });
    }
  };

  const handleRemove = async (repo: CodebaseIndexedRepository) => {
    setBusyKeys((current) => ({ ...current, [repo.repoKey]: "remove" }));
    setError(null);
    try {
      const result = await api.codebaseIndexRemove({ repoKey: repo.repoKey });
      if (result.removed) {
        onNotify?.(`Removed index for ${repo.name}.`);
        setExpandedRows((current) => {
          const next = { ...current };
          delete next[repo.repoKey];
          return next;
        });
        await loadOverview();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not remove index for ${repo.name}.`);
    } finally {
      setBusyKeys((current) => {
        const next = { ...current };
        delete next[repo.repoKey];
        return next;
      });
    }
  };

  const handleSearch = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedQuery = queryText.trim();
    if (!selectedRepoKey || !trimmedQuery) return;
    const seq = ++searchSeq.current;
    setSearching(true);
    setSearchError(null);
    try {
      const trimmedPrefix = pathPrefix.trim();
      const trimmedLang = language.trim().toLowerCase();
      const result = await api.codebaseIndexSearch({
        repoKey: selectedRepoKey,
        query: trimmedQuery,
        limit,
        ...(trimmedPrefix ? { pathPrefix: trimmedPrefix } : {}),
        ...(trimmedLang ? { language: trimmedLang } : {}),
      });
      if (seq !== searchSeq.current) return;
      setSearchResult(result);
    } catch (cause) {
      if (seq !== searchSeq.current) return;
      setSearchError(cause instanceof Error ? cause.message : "Vector search query failed.");
      setSearchResult(null);
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  };

  const selectedRepoItem = searchableRepos.find((repo) => repo.repoKey === selectedRepoKey) ?? null;

  return (
    <section className="vector-search-page" aria-label="Vector Search">
      <div className="table-controls">
        <PageTitle page="vector-search" />
      </div>

      <Tabs selectedIndex={tabIndex} onChange={({ selectedIndex }) => setTabIndex(selectedIndex)}>
        <TabList aria-label="Vector Search views">
          <Tab>Repositories</Tab>
          <Tab>Query</Tab>
        </TabList>
        <TabPanels>
          <TabPanel>
            <div className="vector-search-section">
              <div className="vector-search-toolbar">
                <div className="vector-search-meta">
                  {overview ? (
                    <>
                      <span>{overview.model}</span>
                      {overview.storeBytes > 0 && (
                        <span> · {formatBytes(overview.storeBytes)} on disk</span>
                      )}
                    </>
                  ) : (
                    <span>Loading index state…</span>
                  )}
                </div>
                <div className="vector-search-actions">
                  <Button
                    kind="ghost"
                    size="sm"
                    renderIcon={Renew}
                    disabled={loading}
                    onClick={() => void loadOverview()}
                  >
                    Refresh
                  </Button>
                  <Button
                    kind="primary"
                    size="sm"
                    renderIcon={Add}
                    disabled={adding}
                    onClick={() => void handleAddRepository()}
                  >
                    {adding ? "Selecting…" : "Index repository"}
                  </Button>
                </div>
              </div>

              {error && (
                <InlineNotification
                  className="vector-search-banner"
                  kind="error"
                  lowContrast
                  hideCloseButton
                  title="Index error"
                  subtitle={error}
                />
              )}

              {repositories.length === 0 ? (
                <p className="vector-search-empty">
                  {loading ? "Loading indexed repositories…" : "No repositories indexed yet."}
                </p>
              ) : (
                <div className="vector-search-table-wrap">
                  <TableContainer>
                    <Table size="md" useZebraStyles={false}>
                      <TableHead>
                        <TableRow>
                          <TableExpandHeader aria-label="Expand repository details" />
                          <TableHeader>Repository</TableHeader>
                          <TableHeader>Status</TableHeader>
                          <TableHeader>Branch / Commit</TableHeader>
                          <TableHeader className="vector-search-num">Files</TableHeader>
                          <TableHeader className="vector-search-num">Chunks</TableHeader>
                          <TableHeader className="vector-search-num">Size</TableHeader>
                          <TableHeader>Last Run</TableHeader>
                          <TableHeader>Actions</TableHeader>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {repositories.map((repo) => {
                          const expanded = Boolean(expandedRows[repo.repoKey]);
                          const status = statusMeta(repo);
                          const busy = busyKeys[repo.repoKey];
                          const duration = formatDuration(repo.lastDurationMs);
                          const lastRunLabel = formatTimestamp(repo.indexedAt ?? repo.lastSyncAt);
                          return (
                            <Fragment key={repo.repoKey}>
                              <TableExpandRow
                                aria-label={`Expand details for ${repo.name}`}
                                isExpanded={expanded}
                                onExpand={() =>
                                  setExpandedRows((current) => ({
                                    ...current,
                                    [repo.repoKey]: !current[repo.repoKey],
                                  }))
                                }
                              >
                                <TableCell>
                                  <div className="vector-search-repo-cell">
                                    <span className="vector-search-repo-name">{repo.name}</span>
                                    <span className="vector-search-repo-path" title={repo.topLevel}>
                                      {repo.topLevel}
                                    </span>
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <Tag size="sm" type={status.tagType}>
                                    {status.label}
                                  </Tag>
                                </TableCell>
                                <TableCell className="vector-search-mono">
                                  {repo.branch} · {shortCommit(repo.commit)}
                                </TableCell>
                                <TableCell className="vector-search-num">
                                  {formatNumber(repo.fileCount)}
                                </TableCell>
                                <TableCell className="vector-search-num">
                                  {formatNumber(repo.chunkCount)}
                                </TableCell>
                                <TableCell className="vector-search-num">
                                  {formatBytes(repo.sizeBytes)}
                                </TableCell>
                                <TableCell>
                                  <div className="vector-search-last-run">
                                    <span>{lastRunLabel}</span>
                                    {duration && (
                                      <span className="vector-search-meta">{duration}</span>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <div className="vector-search-row-actions">
                                    <Button
                                      kind="ghost"
                                      size="sm"
                                      disabled={Boolean(busy) || repo.status === "indexing"}
                                      aria-label={`Re-index ${repo.name}`}
                                      onClick={() => void handleReindex(repo)}
                                    >
                                      {busy === "reindex" ? "Starting…" : "Re-index"}
                                    </Button>
                                    <Button
                                      kind="danger--ghost"
                                      size="sm"
                                      disabled={Boolean(busy)}
                                      aria-label={`Remove ${repo.name} index`}
                                      onClick={() => void handleRemove(repo)}
                                    >
                                      {busy === "remove" ? "Removing…" : "Remove"}
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableExpandRow>
                              {expanded && (
                                <TableExpandedRow colSpan={9}>
                                  <div className="vector-search-detail">
                                    <div className="vector-search-detail-group">
                                      <h4 className="vector-search-detail-title">Git snapshot</h4>
                                      <dl className="vector-search-detail-list">
                                        <dt>Repository</dt>
                                        <dd className="vector-search-mono">{repo.topLevel}</dd>
                                        <dt>Common Git dir</dt>
                                        <dd className="vector-search-mono">
                                          {repo.commonDir || "—"}
                                        </dd>
                                        <dt>Ref</dt>
                                        <dd className="vector-search-mono">{repo.ref}</dd>
                                        <dt>Commit</dt>
                                        <dd className="vector-search-mono">{repo.commit ?? "—"}</dd>
                                        <dt>Fetch status</dt>
                                        <dd>{formatFetchStatus(repo.fetchStatus)}</dd>
                                        {repo.fetchWarning && (
                                          <>
                                            <dt>Fetch warning</dt>
                                            <dd>{repo.fetchWarning}</dd>
                                          </>
                                        )}
                                        {repo.lastError && (
                                          <>
                                            <dt>Last error</dt>
                                            <dd>{repo.lastError}</dd>
                                          </>
                                        )}
                                      </dl>
                                    </div>
                                    <div className="vector-search-detail-group">
                                      <h4 className="vector-search-detail-title">Index details</h4>
                                      <dl className="vector-search-detail-list">
                                        <dt>Last indexed</dt>
                                        <dd>{formatTimestamp(repo.indexedAt)}</dd>
                                        <dt>Last synced</dt>
                                        <dd>{formatTimestamp(repo.lastSyncAt)}</dd>
                                        <dt>Last run duration</dt>
                                        <dd>{duration ?? "—"}</dd>
                                        <dt>Indexed size</dt>
                                        <dd>{formatBytes(repo.sizeBytes)}</dd>
                                        <dt>Languages</dt>
                                        <dd>
                                          {repo.languages.length > 0
                                            ? repo.languages
                                                .slice(0, 8)
                                                .map(
                                                  (entry) =>
                                                    `${entry.language} (${formatNumber(entry.files)} files, ${formatNumber(entry.chunks)} chunks)`,
                                                )
                                                .join(" · ")
                                            : "—"}
                                        </dd>
                                      </dl>
                                    </div>
                                  </div>
                                </TableExpandedRow>
                              )}
                            </Fragment>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </div>
              )}
            </div>
          </TabPanel>

          <TabPanel>
            <div className="vector-search-section">
              <form className="vector-search-query-form" onSubmit={(e) => void handleSearch(e)}>
                <Dropdown
                  id="vector-search-repo-select"
                  titleText="Repository"
                  label={
                    searchableRepos.length > 0 ? "Select repository" : "No indexed repositories"
                  }
                  items={searchableRepos}
                  selectedItem={selectedRepoItem}
                  itemToString={(item) => (item ? `${item.name} (${item.branch})` : "")}
                  disabled={searchableRepos.length === 0}
                  onChange={({ selectedItem }) => setSelectedRepoKey(selectedItem?.repoKey ?? "")}
                />
                <TextInput
                  id="vector-search-query-input"
                  labelText="Query"
                  placeholder="Semantic question or code symbol"
                  value={queryText}
                  onChange={(e) => setQueryText(e.target.value)}
                />
                <TextInput
                  id="vector-search-prefix-input"
                  labelText="Path prefix"
                  placeholder="src/core"
                  value={pathPrefix}
                  onChange={(e) => setPathPrefix(e.target.value)}
                />
                <TextInput
                  id="vector-search-language-input"
                  labelText="Language"
                  placeholder="typescript"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                />
                <Dropdown
                  id="vector-search-limit-select"
                  titleText="Limit"
                  label="10"
                  items={[...LIMIT_ITEMS]}
                  selectedItem={LIMIT_ITEMS.find((item) => item.id === limit) ?? LIMIT_ITEMS[1]}
                  itemToString={(item) => (item ? item.label : "")}
                  onChange={({ selectedItem }) => {
                    if (selectedItem) setLimit(selectedItem.id);
                  }}
                />
                <Button
                  type="submit"
                  kind="primary"
                  size="md"
                  renderIcon={SearchIcon}
                  disabled={searching || !selectedRepoKey || queryText.trim().length === 0}
                >
                  {searching ? "Searching…" : "Search"}
                </Button>
              </form>

              {searchError && (
                <InlineNotification
                  className="vector-search-banner"
                  kind="error"
                  lowContrast
                  hideCloseButton
                  title="Search failed"
                  subtitle={searchError}
                />
              )}

              {searchResult && searchResult.status === "indexing" && (
                <InlineNotification
                  className="vector-search-banner"
                  kind="info"
                  lowContrast
                  hideCloseButton
                  title="Indexing in progress"
                  subtitle={
                    searchResult.message ??
                    "Repository indexing is still running. Retry once indexing completes."
                  }
                />
              )}

              {searchResult && searchResult.status === "ready" && (
                <div className="vector-search-results">
                  <div className="vector-search-meta">
                    <span>
                      {searchResult.branch} · {shortCommit(searchResult.commit)} ·{" "}
                      {formatNumber(searchResult.hits.length)}{" "}
                      {searchResult.hits.length === 1 ? "match" : "matches"}
                    </span>
                    {searchResult.fetchWarning && <span> · {searchResult.fetchWarning}</span>}
                  </div>
                  {searchResult.hits.length === 0 ? (
                    <p className="vector-search-empty">No matching code chunks.</p>
                  ) : (
                    searchResult.hits.map((hit) => (
                      <article
                        key={`${hit.path}:${hit.startLine}-${hit.endLine}:${hit.score}`}
                        className="vector-search-hit"
                      >
                        <div className="vector-search-hit-header">
                          <span className="vector-search-mono">
                            {hit.path}:{hit.startLine}-{hit.endLine}
                          </span>
                          <div className="vector-search-hit-tags">
                            <Tag size="sm" type="cool-gray">
                              {hit.language}
                            </Tag>
                            {hit.lexicalMatch && (
                              <Tag size="sm" type="teal">
                                Lexical
                              </Tag>
                            )}
                            <span>cosine {hit.vectorScore.toFixed(3)}</span>
                            <span>· RRF {hit.score.toFixed(4)}</span>
                          </div>
                        </div>
                        <pre className="vector-search-hit-code">
                          <code>{hit.content}</code>
                        </pre>
                      </article>
                    ))
                  )}
                </div>
              )}
            </div>
          </TabPanel>
        </TabPanels>
      </Tabs>
    </section>
  );
}
