import { useEffect, useRef, useState } from "react";
import {
  type DesktopApi,
  RAG_QUERY_LIMIT,
  type RagResults,
  type RagStatus,
} from "../bridge/index.js";
import { SettingsCard, SettingsHeader } from "./settings-layout.js";

export function RagPage({
  api,
  database,
  databaseEpoch,
}: {
  api: Pick<
    DesktopApi,
    "ragStatus" | "onRagStatus" | "rebuildRag" | "retrieveRag" | "cancelRag" | "clearRag"
  >;
  database: string | null;
  databaseEpoch: number | undefined;
}) {
  const [status, setStatus] = useState<RagStatus>();
  const [text, setText] = useState("");
  const [results, setResults] = useState<RagResults>();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const alive = useRef(true);
  const current = useRef<string | undefined>(undefined);
  useEffect(() => {
    alive.current = true;
    const apply = (next: RagStatus) => {
      if (alive.current)
        setStatus((previous) =>
          !previous || next.revision >= previous.revision ? next : previous,
        );
    };
    const dispose = api.onRagStatus(apply);
    void api
      .ragStatus()
      .then(apply)
      .catch(() => {
        if (alive.current) setError("RAG status is unavailable. Reload the application to retry.");
      });
    return () => {
      alive.current = false;
      dispose();
      if (current.current) void api.cancelRag(current.current).catch(() => {});
    };
  }, [api]);
  const databaseKey = status?.databaseKey;
  const busy = pending || !!status?.operation;
  async function run(action: "build" | "retrieve" | "clear") {
    if (!databaseKey || busy) return;
    if (action === "retrieve" && text.length > RAG_QUERY_LIMIT) {
      setError(`RAG queries support at most ${RAG_QUERY_LIMIT.toLocaleString()} characters.`);
      return;
    }
    const requestId = crypto.randomUUID();
    current.current = requestId;
    setPending(true);
    setError("");
    try {
      const identity = { databaseKey, requestId, databaseEpoch };
      if (action === "retrieve") {
        const next = await api.retrieveRag({ ...identity, text });
        if (alive.current && current.current === requestId && next.databaseKey === databaseKey)
          setResults(next);
      } else if (action === "build") {
        await api.rebuildRag(identity);
        if (alive.current) setResults(undefined);
      } else {
        const cleared = await api.clearRag(identity);
        if (alive.current && cleared) setResults(undefined);
      }
    } catch (cause) {
      if (alive.current && current.current === requestId)
        setError(cause instanceof Error ? cause.message : "RAG operation failed");
    } finally {
      if (alive.current && current.current === requestId) {
        current.current = undefined;
        setPending(false);
      }
    }
  }
  return (
    <main className="rag-page" aria-label="RAG">
      <SettingsHeader
        title="RAG"
        tip="This is a manual snapshot of project and legacy orchestration chats and worker conversations in the connected database, including archived chats and registered projects. The application-owned Relay is independent of this database and is not indexed. New messages are included only when you rebuild. Retrieval returns matching text, not generated answers. Scores are cosine similarities, not confidence percentages."
      >
        <div className="button-group">
          <button
            type="button"
            disabled={!database || !databaseKey || busy}
            onClick={() => void run("build")}
          >
            {status?.index ? "Rebuild index" : "Index conversations"}
          </button>
          {busy && (
            <button
              type="button"
              onClick={() => {
                const id = status?.operation?.requestId ?? current.current;
                if (id)
                  void api.cancelRag(id).catch(() => setError("Cancellation failed. Try again."));
              }}
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            disabled={!database || !databaseKey || busy}
            onClick={() => void run("clear")}
          >
            Clear index
          </button>
        </div>
      </SettingsHeader>
      <SettingsCard>
        <dl className="rag-summary">
          <div>
            <dt>Bundled model</dt>
            <dd>{status?.model ?? "Jina Embeddings v2 Base Code · INT8 · CPU"}</dd>
          </div>
          <div>
            <dt>Last successful build</dt>
            <dd>
              {status?.index ? new Date(status.index.builtAt).toLocaleString() : "Not indexed"}
            </dd>
          </div>
          <div>
            <dt>Conversations / chunks</dt>
            <dd>
              {status?.index ? `${status.index.conversations} / ${status.index.chunks}` : "0 / 0"}
            </dd>
          </div>
        </dl>
        <div role="status">
          {status?.operation
            ? `${status.operation.phase}: ${status.operation.completed}${status.operation.total ? ` / ${status.operation.total}` : ""}`
            : !database
              ? "Connect to a database to use RAG."
              : ""}
        </div>
        {(error || status?.error) && <p role="alert">{error || status?.error}</p>}
      </SettingsCard>
      <SettingsCard title="Retrieve chunks">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run("retrieve");
          }}
        >
          <div className="rag-query">
            <input
              className="rag-query-input"
              id="rag-message"
              aria-label="Retrieval query"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
            <button type="submit" disabled={!database || !status?.index || busy || !text.trim()}>
              Retrieve
            </button>
          </div>
        </form>
      </SettingsCard>
      {results && (
        <section aria-label="Retrieved chunks">
          {results.hits.length === 0 && <p>No indexed chunks.</p>}
          <ol className="rag-results">
            {results.hits.map((hit) => (
              <li key={JSON.stringify([results.generation, hit.source, hit.message, hit.start])}>
                <h3>{hit.source.title}</h3>
                <div className="rag-metadata">
                  <span>Similarity {hit.score.toFixed(4)}</span>
                  <span>
                    {hit.source.conversation} · {hit.source.runId}
                  </span>
                  {hit.source.project && <span>Project: {hit.source.project}</span>}
                  <span>
                    {hit.role} · {hit.at}
                  </span>
                </div>
                <pre>{hit.text}</pre>
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}
