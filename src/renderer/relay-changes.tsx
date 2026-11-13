import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type {
  DesktopApi,
  RelayReviewEntry,
  RelayReviewRequest,
  RelayReviewResponse,
  Review,
  Snapshot,
  TaskView,
} from "../bridge/index.js";
import { ReviewPanel } from "./review-panel.js";

const MonacoDiff = lazy(() => import("./monaco-diff.js"));
const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
type Scope = { conversationId: string; generation: number; targetId: string; reviewId: string };
type FeedbackAction = Extract<RelayReviewRequest, { type: "action" }>["action"];
type TaskAction = Extract<RelayReviewRequest, { type: "task" }>["action"];

/** One bounded page, bounded current links and one requested review, independent of navigation. */
export function RelayChanges({
  api,
  snapshot,
  active,
}: {
  api: DesktopApi;
  snapshot: Snapshot | undefined;
  active: boolean;
}) {
  const chat = snapshot?.chats.find((chat) => chat.kind === "relay");
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
        <button type="button" onClick={latest}>
          Latest changes
        </button>
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
              <button
                type="button"
                key={entry.id}
                aria-current={selected?.id === entry.id ? "true" : undefined}
                onClick={() => setSelected(entry)}
              >
                {entry.title} ·{" "}
                {entry.generation === generation ? "Current generation" : "Historical evidence"}
              </button>
            ))}
          </section>
        ))}
      </nav>
      {!cursor && links.length > 32 && (
        <nav aria-label="Current worker review links">
          <button
            type="button"
            disabled={linkPage === 0}
            onClick={() => setLinkPage((page) => page - 1)}
          >
            Previous worker links
          </button>
          <button
            type="button"
            disabled={(linkPage + 1) * 32 >= links.length}
            onClick={() => setLinkPage((page) => page + 1)}
          >
            More worker links
          </button>
        </nav>
      )}
      {[...direct].map(([id, cwd]) => (
        <section key={id} role="note">
          <h3>{cwd}</h3>
          <p>
            Direct edits, not isolated or reversible. Open the worker chat in Relay navigation for
            its transcript.
          </p>
        </section>
      ))}
      {!available.length && !direct.size && <p>No changes yet. Saved reviews remain on disk.</p>}
      <nav aria-label="Review pages">
        <button
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
        </button>
        <button
          type="button"
          disabled={!page?.cursor || page.owner !== owner}
          onClick={() => {
            if (!page?.cursor) return;
            setPaging({ owner, cursor: page.cursor, back: [...back, cursor].slice(-64) });
          }}
        >
          Older reviews
        </button>
      </nav>
      {selected && conversationId && generation !== undefined && (
        <RelayReview
          key={`${owner}:${selected.targetId}:${selected.id}`}
          api={api}
          scope={{ conversationId, generation, targetId: selected.targetId, reviewId: selected.id }}
          active={active}
          hint={chat?.reviewRevision ?? 0}
        />
      )}
    </section>
  );
}

function RelayReview({
  api,
  scope,
  active,
  hint,
}: {
  api: DesktopApi;
  scope: Scope;
  active: boolean;
  hint: number;
}) {
  const [loaded, setLoaded] = useState<{ review: Review; live: boolean }>();
  const [task, setTask] = useState<TaskView>();
  const [revisionId, setRevision] = useState("");
  const [fileKey, setFile] = useState("");
  const [reviewedIntent, setReviewedIntent] = useState<{ key: string; checked: boolean }>();
  const [draft, setDraft] = useState("");
  const [anchor, setAnchor] = useState(false);
  const [side, setSide] = useState<"original" | "modified">("modified");
  const [start, setStart] = useState(1);
  const [end, setEnd] = useState(1);
  const [attempt, retry] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const acting = useRef(false);
  const alive = useRef(true);
  const draftId = useRef<string>(crypto.randomUUID());
  const { conversationId, generation, targetId, reviewId } = scope;
  const address = useMemo(
    () => ({ conversationId, generation, targetId, reviewId }),
    [conversationId, generation, targetId, reviewId],
  );
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const install = (result: RelayReviewResponse) => {
    if (!alive.current) return;
    if (result.type === "review") {
      setLoaded(result);
      setRevision((selected) => selected || result.review.revisions.at(-1)?.id || "");
    } else if (result.type === "task") setTask(result.task);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: Revision hints and explicit Retry refresh this selected review.
  useEffect(() => {
    if (!active || busy) return;
    let current = true;
    const requestId = crypto.randomUUID();
    void (async () => {
      const result = await api.relayReview({ type: "read", ...address, requestId });
      if (!current) return;
      const status = await api.relayReview({
        type: "task",
        ...address,
        action: { type: "status" },
      });
      if (!current) return;
      if (result.type === "review") {
        setLoaded(result);
        setRevision((selected) => selected || result.review.revisions.at(-1)?.id || "");
      }
      if (status.type === "task")
        setTask((previous) => ({
          ...status.task,
          ...(previous?.file && previous.operation?.id === status.task.operation?.id
            ? { file: previous.file }
            : {}),
        }));
    })().catch((cause: unknown) => {
      if (current) setError(message(cause));
    });
    return () => {
      current = false;
      void api.relayReview({ type: "cancel", ...address, requestId }).catch(() => {});
    };
  }, [api, address, active, busy, hint, attempt]);
  const run = async (operation: () => Promise<RelayReviewResponse>) => {
    if (acting.current) return;
    acting.current = true;
    setBusy(true);
    setError("");
    try {
      install(await operation());
    } catch (cause) {
      if (alive.current) setError(message(cause));
    } finally {
      acting.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const action = (action: FeedbackAction) =>
    run(() => api.relayReview({ type: "action", ...address, action }));
  const taskAction = (action: TaskAction) =>
    run(() => api.relayReview({ type: "task", ...address, action }));
  const review = loaded?.review;
  const revision = review?.revisions.find((revision) => revision.id === revisionId);
  const file = revision?.files.find((file) => file.key === fileKey) ?? revision?.files[0];
  // Background refreshes rerun after every action and revision hint. An action
  // cancels them, so disabling controls here would only drop clicks mid-refresh.
  const disabled = busy;
  if (!review)
    return (
      <section aria-label="Selected Relay review">
        {error ? <p role="alert">{error}</p> : <p role="status">Loading review…</p>}
        <button type="button" onClick={() => retry((value) => value + 1)}>
          Retry review
        </button>
      </section>
    );
  const operation = task?.operation;
  return (
    <section className="relay-review" aria-label="Selected Relay review">
      <h3>{review.title}</h3>
      <p>{review.relay?.cwd}</p>
      {!loaded.live && (
        <p role="note">Historical evidence only. Feedback cannot reconnect saved workers.</p>
      )}
      {error && <p role="alert">{error}</p>}
      <button
        type="button"
        disabled={disabled}
        onClick={() =>
          void run(() =>
            api.relayReview({ type: "capture", ...address, requestId: crypto.randomUUID() }),
          )
        }
      >
        Refresh changes
      </button>
      <label>
        Revision{" "}
        <select
          aria-label="Revision"
          value={revisionId}
          disabled={disabled}
          onChange={(event) => {
            setRevision(event.target.value);
            setAnchor(false);
            setFile("");
          }}
        >
          {!review.revisions.length && <option value="">No capture yet</option>}
          {review.revisions.map((revision, index) => (
            <option key={revision.id} value={revision.id}>
              Revision {index + 1}
            </option>
          ))}
        </select>
      </label>
      {revisionId && revisionId !== review.revisions.at(-1)?.id && (
        <p>Newer changes are available. This revision stays pinned.</p>
      )}
      {active && revision && (
        <ReviewPanel
          api={api}
          review={review}
          project={conversationId}
          revisionId={revision.id}
          relay={address}
          onFile={setFile}
        />
      )}
      {file && (
        <label>
          <input
            type="checkbox"
            disabled={disabled}
            checked={
              reviewedIntent?.key === file.fingerprint
                ? reviewedIntent.checked
                : review.reviewed[file.key] === file.fingerprint
            }
            onChange={(event) => {
              const checked = event.target.checked;
              setReviewedIntent({ key: file.fingerprint, checked });
              void run(async () => {
                try {
                  return await api.relayReview({
                    type: "action",
                    ...address,
                    action: { type: "reviewed", revisionId, fileKey: file.key, reviewed: checked },
                  });
                } finally {
                  if (alive.current) setReviewedIntent(undefined);
                }
              });
            }}
          />
          Mark file reviewed
        </label>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!draft.trim() || !revision || !loaded.live) return;
          void run(async () => {
            const result = await api.relayReview({
              type: "action",
              ...address,
              action: {
                type: "comment",
                id: draftId.current,
                revisionId,
                text: draft,
                ...(anchor && file
                  ? { anchor: { revisionId, fileKey: file.key, side, start, end } }
                  : {}),
              },
            });
            install(result);
            if (!alive.current) return result;
            setDraft("");
            draftId.current = crypto.randomUUID();
            return api.relayReview({
              type: "action",
              ...address,
              action: {
                type: "submit",
                id: crypto.randomUUID(),
                revisionId,
              },
            });
          });
        }}
      >
        <label>
          Feedback
          <textarea
            value={draft}
            maxLength={8_000}
            disabled={disabled || !loaded.live}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        {file && (
          <label>
            <input
              type="checkbox"
              checked={anchor}
              disabled={disabled || !loaded.live}
              onChange={(event) => setAnchor(event.target.checked)}
            />
            Attach to lines in {file.path}
          </label>
        )}
        {anchor && (
          <fieldset disabled={disabled || !loaded.live}>
            <label>
              Side
              <select value={side} onChange={(event) => setSide(event.target.value as typeof side)}>
                <option value="original">Original</option>
                <option value="modified">Modified</option>
              </select>
            </label>
            <label>
              First line
              <input
                type="number"
                min={1}
                value={start}
                onChange={(event) => setStart(Number(event.target.value))}
              />
            </label>
            <label>
              Last line
              <input
                type="number"
                min={start}
                value={end}
                onChange={(event) => setEnd(Number(event.target.value))}
              />
            </label>
          </fieldset>
        )}
        <button type="submit" disabled={disabled || !loaded.live || !revision || !draft.trim()}>
          Send feedback
        </button>
      </form>
      <ul aria-label="Review feedback">
        {review.comments.map((comment) => (
          <li key={comment.id}>
            <p>{comment.text}</p>
            <span>
              {comment.state}
              {comment.revisionId !== revisionId ? " · Earlier revision" : ""}
            </span>
            {comment.state === "draft" ? (
              <button
                type="button"
                disabled={disabled}
                onClick={() => void action({ type: "delete-comment", id: comment.id })}
              >
                Delete draft
              </button>
            ) : (
              <button
                type="button"
                disabled={disabled}
                onClick={() =>
                  void action({
                    type: "resolve",
                    id: comment.id,
                    resolved: comment.state !== "resolved",
                  })
                }
              >
                {comment.state === "resolved" ? "Reopen feedback" : "Resolve feedback"}
              </button>
            )}
            {comment.state === "draft" && (
              <button
                type="button"
                disabled={
                  disabled ||
                  !loaded.live ||
                  review.submissions.some(
                    (batch) =>
                      ["pending", "delivering", "failed"].includes(batch.state) &&
                      batch.commentIds.includes(comment.id),
                  )
                }
                onClick={() => {
                  draftId.current = comment.id;
                  setDraft(comment.text);
                  setRevision(comment.revisionId);
                  setAnchor(!!comment.anchor);
                  setFile(comment.anchor?.fileKey ?? "");
                  setSide(comment.anchor?.side ?? "modified");
                  setStart(comment.anchor?.start ?? 1);
                  setEnd(comment.anchor?.end ?? 1);
                }}
              >
                Edit draft
              </button>
            )}
          </li>
        ))}
      </ul>
      <ul aria-label="Feedback delivery">
        {review.submissions.map((batch) => (
          <li key={batch.id}>
            <span>{batch.state}</span>
            {batch.error && <p role="alert">{batch.error}</p>}
            {batch.state === "failed" && (
              <button
                type="button"
                disabled={disabled || !loaded.live}
                onClick={() => void action({ type: "retry", id: batch.id })}
              >
                Retry feedback
              </button>
            )}
            {["pending", "failed"].includes(batch.state) && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => void action({ type: "withdraw", id: batch.id })}
              >
                Withdraw feedback
              </button>
            )}
          </li>
        ))}
      </ul>
      {task?.available && (
        <section aria-label="Checkout-local application">
          <h4>Apply to this checkout</h4>
          <p>Base: {task.source}. Worker worktrees are retained.</p>
          <button
            type="button"
            disabled={
              disabled ||
              !task.canPrepare ||
              !revision ||
              revisionId !== review.revisions.at(-1)?.id
            }
            onClick={() =>
              void taskAction({
                type: "prepare",
                revisionId,
              })
            }
          >
            Use these changes…
          </button>
          {operation && (
            <>
              <p role="status">{operation.status}</p>
              {operation.error && <p role="alert">{operation.error}</p>}
              <ul>
                {operation.conflicts.map((conflict) => (
                  <li key={conflict.path}>
                    {conflict.path}: {conflict.reason}
                  </li>
                ))}
              </ul>
              <ul aria-label="Application files">
                {operation.changes.map((file) => (
                  <li key={file.id}>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() =>
                        void taskAction({
                          type: "file",
                          operationId: operation.id,
                          fileId: file.id,
                        })
                      }
                    >
                      {file.path}
                    </button>
                  </li>
                ))}
              </ul>
              {task.file &&
                (task.file.limitation ? (
                  <p role="note">{task.file.limitation}</p>
                ) : (
                  <Suspense fallback={<p role="status">Loading application preview…</p>}>
                    <MonacoDiff
                      address={`${conversationId}:${generation}:${reviewId}:${operation.id}:${task.file.path}`}
                      path={task.file.path}
                      original={task.file.original}
                      modified={task.file.modified}
                    />
                  </Suspense>
                ))}
              {operation.status === "prepared" && (
                <>
                  <button
                    type="button"
                    disabled={disabled || !!operation.conflicts.length}
                    onClick={() => void taskAction({ type: "apply", operationId: operation.id })}
                  >
                    Apply changes…
                  </button>
                  {!!operation.conflicts.length && (
                    <button
                      type="button"
                      disabled={disabled || !loaded.live}
                      onClick={() => void taskAction({ type: "revise", operationId: operation.id })}
                    >
                      Ask workers to revise
                    </button>
                  )}
                </>
              )}
              {operation.status === "recovery" && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => void taskAction({ type: "recover", operationId: operation.id })}
                >
                  Recover interrupted changes…
                </button>
              )}
            </>
          )}
          {task.undoId && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => void taskAction({ type: "undo", operationId: task.undoId as string })}
            >
              Undo application…
            </button>
          )}
          {busy && (
            <button
              type="button"
              onClick={() => {
                void api
                  .relayReview({ type: "task", ...address, action: { type: "cancel" } })
                  .catch((cause: unknown) => setError(message(cause)));
              }}
            >
              Cancel review operation
            </button>
          )}
        </section>
      )}
    </section>
  );
}
