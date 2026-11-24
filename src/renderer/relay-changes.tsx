import { useEffect, useState } from "react";
import type { ApplicationClient, RelayReviewEntry, Snapshot } from "../bridge/index.js";
import { Button as AppButton } from "./carbon/button.js";
import { ReviewFlow } from "./review-flow.js";

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/** One bounded page, bounded current links and one requested review, independent of navigation. */
export function RelayChanges({
  api,
  snapshot,
  active,
}: {
  api: ApplicationClient;
  snapshot: Snapshot | undefined;
  active: boolean;
}) {
  const chat = snapshot?.chat.kind === "relay" ? snapshot.chat : undefined;
  const conversationId = chat?.conversationId;
  const generation = chat?.generation;
  const owner = JSON.stringify([conversationId, generation]);
  const [paging, setPaging] = useState<{
    owner: string;
    cursor?: string;
    back: (string | undefined)[];
  }>({ owner, back: [] });
  const cursor = paging.owner === owner ? paging.cursor : undefined;
  const back = paging.owner === owner ? paging.back : [];
  const [linkPage, setLinkPage] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState<{
    owner: string;
    entries: RelayReviewEntry[];
    cursor: string | null;
  }>();
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<RelayReviewEntry>();
  const version = cursor ? 0 : chat?.reviewRevision;
  // biome-ignore lint/correctness/useExhaustiveDependencies: Revision hints and explicit Retry refresh only this bounded page.
  useEffect(() => {
    if (!active || !conversationId || generation === undefined) return;
    let current = true;
    setError("");
    void api
      .relayReview({ type: "list", conversationId, generation, ...(cursor ? { cursor } : {}) })
      .then(
        (result) => {
          if (current && result.type === "list")
            setPage({ owner, entries: result.entries, cursor: result.cursor });
        },
        (cause: unknown) => {
          if (current) setError(message(cause));
        },
      );
    return () => {
      current = false;
    };
  }, [api, active, conversationId, generation, owner, cursor, version, attempt]);
  const entries = page?.owner === owner ? page.entries : [];
  const groups = new Map<string, RelayReviewEntry[]>();
  const workers = (snapshot?.runs ?? []).filter(
    (run) => run.relay?.conversationId === conversationId && run.relay?.generation === generation,
  );
  const available = [...entries];
  const known = new Set(entries.map((entry) => entry.id));
  const links = workers.filter(
    (worker) => worker.relay?.reviewId && !known.has(worker.relay.reviewId),
  );
  if (!cursor)
    for (const worker of links.slice(linkPage * 32, (linkPage + 1) * 32)) {
      const source = worker.relay;
      if (!source?.reviewId || available.some((entry) => entry.id === source.reviewId)) continue;
      available.push({
        id: source.reviewId,
        targetId: source.targetId,
        taskId: source.taskId,
        generation: source.generation,
        title: `${worker.record.agent} changes`,
        targetLabel: source.cwd,
        labelTruncated: false,
        workspaceMode: source.workspaceMode,
        at: worker.record.startedAt,
      });
    }
  for (const entry of available) {
    const group = groups.get(entry.targetId) ?? [];
    group.push(entry);
    groups.set(entry.targetId, group);
  }
  const direct = new Map(
    workers
      .filter((worker) => worker.relay?.workspaceMode === "direct")
      .map((worker) => [worker.relay?.targetId, worker.relay?.cwd]),
  );
  const latest = () => {
    setPaging({ owner, back: [] });
    setLinkPage(0);
    setAttempt((value) => value + 1);
  };
  return (
    <section className="relay-changes" aria-label="Relay changes by target">
      <header>
        <h2>Changes by target</h2>
        <AppButton type="button" onClick={latest}>
          Latest changes
        </AppButton>
      </header>
      {error && <p role="alert">{error}</p>}
      <nav className="revision-list" aria-label="Relay target reviews">
        {[...groups].map(([targetId, reviews]) => (
          <section key={targetId}>
            <h3 title={reviews[0]?.targetLabel}>
              {reviews[0]?.targetLabel}
              {reviews[0]?.labelTruncated ? "…" : ""}
            </h3>
            {reviews.map((entry) => (
              <AppButton
                type="button"
                key={entry.id}
                aria-current={selected?.id === entry.id ? "true" : undefined}
                onClick={() => setSelected(entry)}
              >
                {entry.title} ·{" "}
                {entry.generation === generation ? "Current generation" : "Historical evidence"}
              </AppButton>
            ))}
          </section>
        ))}
      </nav>
      {!cursor && links.length > 32 && (
        <nav aria-label="Current worker review links">
          <AppButton
            type="button"
            disabled={linkPage === 0}
            onClick={() => setLinkPage((page) => page - 1)}
          >
            Previous worker links
          </AppButton>
          <AppButton
            type="button"
            disabled={(linkPage + 1) * 32 >= links.length}
            onClick={() => setLinkPage((page) => page + 1)}
          >
            More worker links
          </AppButton>
        </nav>
      )}
      {[...direct].map(([id, cwd]) => (
        <section key={id} role="note">
          <h3>{cwd}</h3>
          <p>Undo in Relay also rewinds manual edits since the checkpoint.</p>
        </section>
      ))}
      {!available.length && !direct.size && <p>No changes yet. Saved reviews remain on disk.</p>}
      <nav aria-label="Review pages">
        <AppButton
          type="button"
          disabled={!back.length}
          onClick={() => {
            const previous = back.at(-1);
            setPaging({
              owner,
              ...(previous ? { cursor: previous } : {}),
              back: back.slice(0, -1),
            });
          }}
        >
          Newer reviews
        </AppButton>
        <AppButton
          type="button"
          disabled={!page?.cursor || page.owner !== owner}
          onClick={() => {
            if (!page?.cursor) return;
            setPaging({ owner, cursor: page.cursor, back: [...back, cursor].slice(-64) });
          }}
        >
          Older reviews
        </AppButton>
      </nav>
      {selected && conversationId && generation !== undefined && (
        <ReviewFlow
          key={`${owner}:${selected.targetId}:${selected.id}`}
          api={api}
          scope={{
            kind: "relay",
            conversationId,
            generation,
            targetId: selected.targetId,
            reviewId: selected.id,
          }}
          active={active}
          hint={chat?.reviewRevision ?? 0}
        />
      )}
    </section>
  );
}
