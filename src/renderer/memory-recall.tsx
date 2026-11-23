import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ApplicationClient } from "../bridge/index.js";
import type { RunEvent } from "../core/index.js";
import { type RecallTurn, recallHistory } from "./memory-recall-history.js";
import { RECALL_PAGE_SIZE, type RecallRecord, RecallRecords } from "./memory-recall-model.js";

export interface RecallSource {
  owner: string;
  runId: string;
  events: readonly RunEvent[];
  loading?: boolean;
  error?: boolean;
  retry?(): void;
}

export function RecallMemory({ value, at }: { value: RecallRecord | undefined; at: string }) {
  if (!value) return <p role="status">Loading memory…</p>;
  if ("unavailable" in value)
    return <p>Memory unavailable. It may have been forgotten, removed, or could not be read.</p>;
  const { record, incomplete } = value.detail;
  const recalled = Date.parse(at);
  const updated = Date.parse(record.updatedAt);
  return (
    <>
      {Number.isFinite(recalled) && Number.isFinite(updated) ? (
        updated > recalled && <p className="memory-recall-meta">Changed since recall</p>
      ) : (
        <p className="memory-recall-meta">Recall time unavailable; changes since recall unknown.</p>
      )}
      <p className="memory-recall-text">{record.text}</p>
      <dl>
        <dt>Type</dt>
        <dd>{record.type}</dd>
        <dt>Scope</dt>
        <dd>{record.scope}</dd>
        <dt>Applies when</dt>
        <dd>{record.condition || "No conditions recorded."}</dd>
      </dl>
      <details>
        <summary>Evidence quotes</summary>
        {record.citations.map((citation) => (
          <blockquote key={`${citation.sourceId}:${citation.start}:${citation.end}`}>
            {citation.quote}
          </blockquote>
        ))}
        {incomplete && <p>Some source evidence is unavailable.</p>}
      </details>
    </>
  );
}

export function RecallGroup({
  turn,
  records,
}: {
  turn: RecallTurn;
  records: ReadonlyMap<string, RecallRecord>;
}) {
  return (
    <section
      className="memory-recall-turn"
      data-current={turn.current}
      aria-label={`Turn ${turn.turn}`}
    >
      <h3>
        Turn {turn.turn} {turn.current && <span className="memory-recall-badge">Current turn</span>}
      </h3>
      {turn.malformed && (
        <p role="status">Recall details are incomplete or malformed for this turn.</p>
      )}
      {!turn.ids.length && !turn.malformed && <p>No memories recalled for this turn.</p>}
      {turn.ids.map(({ id, at }) => (
        <article className="memory-recall-record" key={id} data-memory-id={id}>
          <RecallMemory value={records.get(id)} at={at} />
        </article>
      ))}
    </section>
  );
}

/** Mounted only for the selected, visible tab; owner keys prevent cross-chat state reuse. */
export function MemoryRecall({ api, source }: { api: ApplicationClient; source: RecallSource }) {
  const [model] = useState(() => new RecallRecords(api));
  const records = useSyncExternalStore(model.subscribe, model.snapshot, model.snapshot);
  const history = useMemo(
    () => recallHistory(source.events, source.runId),
    [source.events, source.runId],
  );
  const [before, setBefore] = useState<string | null>(null);
  const start = before
    ? Math.max(
        0,
        history.turns.findIndex((turn) => turn.key === before),
      )
    : 0;
  const turns = history.turns.slice(start, start + RECALL_PAGE_SIZE);
  const ids = JSON.stringify(turns.flatMap((turn) => turn.ids.map(({ id }) => id)));
  useLayoutEffect(() => () => model.stop(), [model]);
  useEffect(() => {
    void model.load(JSON.parse(ids) as string[]);
  }, [model, ids]);
  useLayoutEffect(
    () =>
      api.onMemoryChanged(() => {
        void model.load(JSON.parse(ids) as string[], true);
      }),
    [api, model, ids],
  );
  const unavailable = [...records.values()].some((value) => "unavailable" in value);
  return (
    <section className="memory-recall" aria-label="Memory Recall">
      {source.loading && <p role="status">Loading recall history…</p>}
      {source.error && <p role="alert">Recall source history could not be read.</p>}
      {(source.error || unavailable) && (
        <div role="alert">
          {unavailable && <p>Some recalled memories are unavailable.</p>}
          <button
            type="button"
            onClick={() => {
              source.retry?.();
              void model.load(JSON.parse(ids) as string[], true);
            }}
          >
            Retry
          </button>
        </div>
      )}
      {!source.loading && !source.error && !turns.length && (
        <p>No recorded recalls in the available history.</p>
      )}
      {turns.map((turn) => (
        <RecallGroup key={turn.key} turn={turn} records={records} />
      ))}
      <nav className="memory-recall-pager" aria-label="Recall turns">
        {start > 0 && (
          <button
            type="button"
            onClick={() =>
              setBefore(
                start <= RECALL_PAGE_SIZE
                  ? null
                  : (history.turns[start - RECALL_PAGE_SIZE]?.key ?? null),
              )
            }
          >
            Newer turns
          </button>
        )}
        {start + RECALL_PAGE_SIZE < history.turns.length && (
          <button
            type="button"
            onClick={() => setBefore(history.turns[start + RECALL_PAGE_SIZE]?.key ?? null)}
          >
            Older turns
          </button>
        )}
      </nav>
    </section>
  );
}
