import { useEffect, useRef, useState } from "react";
import type {
  DesktopApi,
  DesktopRun,
  OrchestrationChat,
  RelayReviewEntry,
  ReviewSummary,
} from "../bridge/index.js";
import { type ReviewPreview, type ReviewScope, reviewRequest } from "./review-actions.js";
import { statusSpec } from "./session-presentation.js";

type Entry = { summary: ReviewSummary; entry?: RelayReviewEntry | undefined };
const explain = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

export function revisionCards(entries: readonly Entry[]) {
  return [...new Map(entries.map((item) => [item.summary.id, item])).values()]
    .flatMap(({ summary, entry }) =>
      [...new Map(summary.revisions.map((revision) => [revision.id, revision])).values()].map(
        (revision, index) => ({
          key: `${summary.id}:${revision.id}`,
          at: revision.at,
          revision,
          number: index + 1,
          summary,
          entry,
        }),
      ),
    )
    .sort((a, b) => a.at.localeCompare(b.at) || a.key.localeCompare(b.key));
}
export function revisionSlot(
  at: string,
  originChatId: string | null,
  chatId: string | undefined,
  messageTimes: readonly (string | undefined)[],
): number {
  if (originChatId !== chatId || !Number.isFinite(Date.parse(at))) return messageTimes.length;
  const found = messageTimes.findIndex(
    (time) => time !== undefined && Date.parse(time) > Date.parse(at),
  );
  return found < 0 ? messageTimes.length : found;
}

/** One quiet working-changes link per request. Immutable snapshots stay in Changes. */
export function useConversationRevisions({
  api,
  chat,
  reviews,
  runs,
  active,
  onPreview,
}: {
  api: DesktopApi;
  chat: OrchestrationChat | undefined;
  reviews: ReviewSummary[];
  runs: readonly DesktopRun[];
  active: boolean;
  onPreview?: ((preview: ReviewPreview) => void) | undefined;
}) {
  const relay = chat?.kind === "relay";
  const conversationId = chat?.conversationId;
  const generation = chat?.generation;
  const owner = JSON.stringify([conversationId, generation, chat?.run?.id, chat?.projectId]);
  const [loaded, setLoaded] = useState<{ owner: string; entries: Entry[]; errors: string[] }>();
  const [error, setError] = useState("");
  const [attempt, retry] = useState(0);
  const [visible, setVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState === "visible",
  );
  useEffect(() => {
    const changed = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);
  const hint = chat?.reviewRevision;
  // biome-ignore lint/correctness/useExhaustiveDependencies: Pushed hints refresh one bounded page, never lifetime history.
  useEffect(() => {
    if (!relay || !active || !visible || !conversationId || generation === undefined) return;
    let current = true;
    void api.relayReview({ type: "timeline", conversationId, generation }).then(
      (result) => {
        if (!current || result.type !== "timeline") return;
        setLoaded({
          owner,
          entries: result.entries.flatMap(({ summary, entry }) =>
            summary ? [{ summary, entry }] : [],
          ),
          errors: result.entries.flatMap(({ error }) => (error ? [error] : [])),
        });
        setError("");
      },
      (cause: unknown) => {
        if (current) setError(explain(cause));
      },
    );
    return () => {
      current = false;
    };
  }, [api, relay, active, visible, conversationId, generation, owner, hint, attempt]);
  const entries: Entry[] = relay
    ? loaded?.owner === owner
      ? loaded.entries
      : []
    : reviews.filter((review) => review.chatId === chat?.run?.id).map((summary) => ({ summary }));
  const scopeFor = ({ summary, entry }: Entry): ReviewScope | undefined =>
    relay
      ? conversationId && generation !== undefined && entry
        ? {
            kind: "relay",
            conversationId,
            generation,
            targetId: entry.targetId,
            reviewId: summary.id,
          }
        : undefined
      : {
          kind: "project",
          project: summary.project,
          projectId: summary.projectId,
          databaseEpoch: summary.databaseEpoch,
          reviewId: summary.id,
          chatId: chat?.run?.id ?? "",
          live: !chat?.restored,
        };
  const requestKey = (card: ReturnType<typeof revisionCards>[number]) => {
    const request = card.revision.request;
    const chatId = request?.chatId ?? card.summary.originChatId;
    return chatId ? `${chatId}:${request?.turn ?? card.summary.turn}` : card.summary.id;
  };
  const latestCaptures = [
    ...new Map(
      revisionCards(entries).map((card) => [`${card.summary.id}:${requestKey(card)}`, card]),
    ).values(),
  ];
  const latest = latestCaptures.filter((card) => (card.revision.fileCount ?? 0) > 0);
  const groups = new Map<string, typeof latest>();
  for (const card of latest) {
    const key = requestKey(card);
    groups.set(key, [...(groups.get(key) ?? []), card]);
  }
  const cards = [...groups].slice(-30).map(([key, group]) => {
    const card = group.at(-1);
    if (!card) throw new Error("Empty changes group");
    const count = group.reduce((total, item) => total + (item.revision.fileCount ?? 0), 0);
    const previews = group.flatMap((item) => {
      const scope = scopeFor(item);
      return scope ? [{ scope, revisionId: item.revision.id, title: item.summary.title }] : [];
    });
    const first = previews[0];
    return {
      ...card,
      summary: {
        ...card.summary,
        originChatId: card.revision.request?.chatId ?? card.summary.originChatId,
      },
      key,
      content: (
        <div className="conversation-changes" key={key}>
          <button
            type="button"
            className="conversation-changes-link"
            disabled={!first || !onPreview}
            onClick={() =>
              first &&
              onPreview?.({ ...first, ...(previews.length > 1 ? { related: previews } : {}) })
            }
          >
            {count} {count === 1 ? "file" : "files"} changed
          </button>
          {group.some((item) => item.revision.incomplete) && <span>Partial capture</span>}
        </div>
      ),
    };
  });
  const failures = [
    ...new Set(
      [
        error,
        ...(loaded?.owner === owner ? loaded.errors : []),
        ...entries.map((item) => item.summary.error ?? ""),
      ].filter(Boolean),
    ),
  ];
  const failedOutcomes = latestCaptures.flatMap(
    (card) =>
      card.revision.outcomes
        ?.filter((outcome) =>
          ["failed", "cancelled", "timed_out", "interrupted"].includes(outcome.status),
        )
        .map(
          (outcome) =>
            `${card.summary.workers.find((worker) => worker.runId === outcome.runId)?.label ?? "Worker"}: ${statusSpec[outcome.status].label}`,
        ) ?? [],
  );
  const current = useRef(onPreview);
  current.current = onPreview;
  const [retrying, setRetrying] = useState(false);
  async function retryChanges() {
    setRetrying(true);
    try {
      const failed = entries
        .filter((item) => item.summary.error || item.summary.revisions.at(-1)?.incomplete)
        .slice(-30);
      for (const item of failed) {
        const scope = scopeFor(item);
        if (scope)
          await reviewRequest(api, scope, { type: "capture", requestId: crypto.randomUUID() });
      }
      retry((value) => value + 1);
      setError("");
    } catch (cause) {
      setError(explain(cause));
    } finally {
      setRetrying(false);
    }
  }
  return {
    cards,
    summaries: entries.map((item) => item.summary),
    showFeedback(reviewId: string, revisionId: string) {
      const item = entries.find((item) => item.summary.id === reviewId);
      const scope = item && scopeFor(item);
      if (!scope || !item) return false;
      current.current?.({ scope, revisionId, title: item.summary.title });
      return true;
    },
    footer: (
      <>
        {failures.map((failure) => (
          <p role="alert" key={failure}>
            {failure}
          </p>
        ))}
        {!!failures.length && (
          <button type="button" disabled={retrying} onClick={() => void retryChanges()}>
            Retry changes
          </button>
        )}
        {latestCaptures
          .filter((card) => card.revision.incomplete && !(card.revision.fileCount ?? 0))
          .map((card) => (
            <p role="note" key={card.key}>
              Partial capture
            </p>
          ))}
        {[...new Set(failedOutcomes)].map((outcome) => (
          <p role="note" key={outcome}>
            {outcome}
          </p>
        ))}
        {relay &&
          runs
            .filter(
              (run) =>
                run.relay?.conversationId === conversationId &&
                run.relay?.generation === generation &&
                run.relay?.workspaceMode === "direct",
            )
            .map((run) => (
              <p role="note" key={run.record.id}>
                Direct edits · {run.relay?.cwd} ·{" "}
                {statusSpec[run.view?.status ?? run.record.status].label}
                {" · Undo also rewinds manual edits since the checkpoint."}
              </p>
            ))}
      </>
    ),
  };
}
