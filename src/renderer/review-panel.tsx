import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type {
  DesktopApi,
  Review,
  ReviewAction,
  ReviewAnchor,
  ReviewSummary,
} from "../bridge/index.js";
import { reviewAnchorSchema } from "../bridge/index.js";
import { type ReviewAddress, useReviewFile } from "./review-content.js";
import { TaskActions } from "./task-actions.js";

const MonacoDiff = lazy(() => import("./monaco-diff.js"));

export function ReviewPanel({
  api,
  review,
  project,
  currentChat,
  chatIds,
  onOpenFile,
  unisolated = [],
  onBrowseProject,
  onSetupGit,
}: {
  api: DesktopApi;
  review: Review;
  project: string;
  currentChat: string | undefined;
  chatIds: string[];
  onOpenFile(path: string, source: ReviewAddress): void;
  unisolated?: string[];
  onBrowseProject?: (() => void) | undefined;
  onSetupGit?: (() => void) | undefined;
}) {
  const storageKey = `code60.review:${project}:${review.id}`;
  const latest = review.revisions.at(-1);
  const missingBaseline = review.workers.some((worker) => unisolated.includes(worker.runId));
  const noBaseline =
    review.workers.length > 0 &&
    review.workers.every((worker) => unisolated.includes(worker.runId));
  const [selected, setSelected] = useState(
    () => sessionStorage.getItem(`${storageKey}:revision`) ?? "",
  );
  const revision = review.revisions.find((item) => item.id === selected) ?? latest;
  const [fileKey, setFileKey] = useState(() => sessionStorage.getItem(`${storageKey}:file`) ?? "");
  const [worker, setWorker] = useState("");
  const [sinceFeedback, setSinceFeedback] = useState(
    () => sessionStorage.getItem(`${storageKey}:compare`) === "feedback",
  );
  useEffect(() => {
    sessionStorage.setItem(`${storageKey}:compare`, sinceFeedback ? "feedback" : "all");
  }, [sinceFeedback, storageKey]);
  const [expanded, setExpanded] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [anchor, setAnchor] = useState<ReviewAnchor | undefined>(() => {
    try {
      return reviewAnchorSchema.parse(
        JSON.parse(sessionStorage.getItem(`${storageKey}:anchor`) ?? "null"),
        { jitless: true },
      );
    } catch {
      return undefined;
    }
  });
  const [selection, setSelection] = useState<ReviewAnchor>();
  const [reveal, setReveal] = useState<ReviewAnchor>();
  const [draft, setDraft] = useState(() => sessionStorage.getItem(`${storageKey}:draft`) ?? "");
  const [editing, setEditing] = useState<string | undefined>(
    () => sessionStorage.getItem(`${storageKey}:editing`) ?? undefined,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    sessionStorage.setItem(`${storageKey}:anchor`, JSON.stringify(anchor ?? null));
  }, [anchor, storageKey]);
  useEffect(() => {
    if (editing) sessionStorage.setItem(`${storageKey}:editing`, editing);
    else sessionStorage.removeItem(`${storageKey}:editing`);
  }, [editing, storageKey]);
  const refreshRequest = useRef<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (refreshRequest.current)
        void api.cancelDiff({ requestId: refreshRequest.current }).catch(() => {});
    };
  }, [api]);
  const revisionId = revision?.id;
  useEffect(() => {
    if (revisionId) {
      setSelected(revisionId);
      sessionStorage.setItem(`${storageKey}:revision`, revisionId);
    }
  }, [revisionId, storageKey]);
  useEffect(() => {
    sessionStorage.setItem(`${storageKey}:file`, fileKey);
  }, [fileKey, storageKey]);
  useEffect(() => {
    sessionStorage.setItem(`${storageKey}:draft`, draft);
  }, [draft, storageKey]);
  const submitted = review.submissions.findLast((batch) => batch.state === "delivered");
  const baseline = sinceFeedback
    ? review.revisions.find((item) => item.id === submitted?.revisionId)
    : undefined;
  const files = [...(revision?.files ?? [])];
  if (baseline)
    for (const file of baseline.files)
      if (!files.some((entry) => entry.key === file.key)) files.push(file);
  const visible = files.filter(
    (file) =>
      (!worker || file.runId === worker) &&
      (!baseline ||
        baseline.files.find((old) => old.key === file.key)?.fingerprint !==
          revision?.files.find((current) => current.key === file.key)?.fingerprint),
  );
  const file = visible.find((file) => file.key === fileKey) ?? visible[0];
  const currentFile = revision?.files.find((entry) => entry.key === file?.key);
  const oldFile = baseline?.files.find((entry) => entry.key === file?.key);
  const comparisonError =
    baseline && file
      ? [...baseline.errors, ...(revision?.errors ?? [])].find(
          (entry) => entry.runId === file.runId,
        )?.message
      : undefined;
  const label = (runId: string) =>
    review.workers.find((worker) => worker.runId === runId)?.label ?? runId;
  const address =
    file && revision
      ? {
          reviewId: review.id,
          revisionId: currentFile ? revision.id : (baseline?.id ?? revision.id),
          fileKey: file.key,
          label: `${label(file.runId)} · Revision ${review.revisions.findIndex((item) => item.id === (currentFile ? revision.id : baseline?.id)) + 1}`,
        }
      : undefined;
  const content = useReviewFile(api, project, address);
  const before = useReviewFile(
    api,
    project,
    oldFile && baseline
      ? {
          reviewId: review.id,
          revisionId: baseline.id,
          fileKey: oldFile.key,
          label: label(oldFile.runId),
        }
      : undefined,
  );
  const connected = review.chatId !== null && chatIds.includes(review.chatId);
  const draftComments = review.comments.filter((comment) => comment.state === "draft");
  async function action(request: ReviewAction) {
    if (busy) return false;
    setBusy(true);
    setError("");
    try {
      await api.reviewAction(request);
      return true;
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function refresh() {
    if (refreshRequest.current) return;
    const requestId = crypto.randomUUID();
    refreshRequest.current = requestId;
    setLoading(true);
    setError("");
    try {
      await api.captureReview({ project, reviewId: review.id, requestId });
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      refreshRequest.current = null;
      if (mounted.current) setLoading(false);
    }
  }
  const identity = { project, reviewId: review.id };
  const outdated = (value: ReviewAnchor) => {
    const original = review.revisions
      .find((revision) => revision.id === value.revisionId)
      ?.files.find((file) => file.key === value.fileKey);
    return (
      latest?.files.find((file) => file.key === value.fileKey)?.fingerprint !==
      original?.fingerprint
    );
  };
  return (
    <section
      className="review-panel"
      data-expanded={expanded}
      aria-label={`Changes: ${review.title}`}
    >
      <header className="review-heading">
        <h2>{review.title}</h2>
        <div className="review-actions">
          <button type="button" disabled={loading || noBaseline} onClick={() => void refresh()}>
            {loading ? "Refreshing…" : "Refresh changes"}
          </button>
          <button type="button" onClick={() => setExpanded((value) => !value)}>
            {expanded ? "Return to chat" : "Expand review"}
          </button>
        </div>
      </header>
      {(error || review.error) && (
        <div role="alert" className="error-banner">
          {error || review.error}
          {!noBaseline && (
            <button type="button" disabled={loading} onClick={() => void refresh()}>
              Retry capture
            </button>
          )}
        </div>
      )}
      {!connected && (
        <div className="warning-banner" role="status">
          <span>Saved review · conversation disconnected</span>
          <button
            type="button"
            disabled={!currentChat || busy}
            onClick={() =>
              currentChat && void action({ type: "reconnect", ...identity, chatId: currentChat })
            }
          >
            Reconnect to this chat
          </button>
        </div>
      )}
      {latest && revision && latest.id !== revision.id && (
        <button
          className="review-update"
          type="button"
          onClick={() => {
            setSelected(latest.id);
            setSelection(undefined);
          }}
        >
          New changes available · Review updates
        </button>
      )}
      <TaskActions
        key={`${project}:${review.id}`}
        api={api}
        project={project}
        review={review}
        revisionId={revision?.id}
        connected={connected}
      />
      {revision && (
        <div className="review-controls">
          <label>
            Revision{" "}
            <select
              value={revision.id}
              onChange={(event) => {
                setSelected(event.target.value);
                setSelection(undefined);
              }}
            >
              {review.revisions.map((item, index) => (
                <option key={item.id} value={item.id}>
                  Revision {index + 1} · {new Date(item.at).toLocaleTimeString()}
                </option>
              ))}
            </select>
          </label>
          <label>
            Worker{" "}
            <select value={worker} onChange={(event) => setWorker(event.target.value)}>
              <option value="">All workers</option>
              {review.workers.map((worker) => (
                <option key={worker.runId} value={worker.runId}>
                  {worker.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Compare{" "}
            <select
              value={sinceFeedback ? "feedback" : "all"}
              onChange={(event) => {
                setSinceFeedback(event.target.value === "feedback");
                setSelection(undefined);
              }}
            >
              <option value="all">All changes</option>
              <option value="feedback" disabled={!submitted}>
                Since my feedback
              </option>
            </select>
          </label>
        </div>
      )}
      {!revision && <p role="status">{loading ? "Loading changes…" : "No captured revision"}</p>}
      {missingBaseline && (
        <section className="git-readiness" aria-label="Review baseline unavailable">
          <p>No baseline was captured for this run</p>
          <p>
            Git setup establishes a baseline for future workers; it cannot reconstruct this run's
            original changes.
          </p>
          <div className="review-actions">
            {onBrowseProject && (
              <button type="button" onClick={onBrowseProject}>
                Browse project files
              </button>
            )}
            {onSetupGit && (
              <button type="button" onClick={onSetupGit}>
                Set up Git
              </button>
            )}
          </div>
        </section>
      )}
      {revision?.errors.map((entry) => (
        <p className="error-banner" role="alert" key={entry.runId}>
          {label(entry.runId)} ·{" "}
          {unisolated.includes(entry.runId)
            ? "No baseline was captured for this run"
            : `Review unavailable: ${entry.message}`}
        </p>
      ))}
      {revision &&
        visible.length === 0 &&
        revision.errors.length === 0 &&
        !review.error &&
        !error &&
        !loading &&
        !noBaseline && (
          <p role="status">{sinceFeedback ? "No changes since your feedback." : "No changes."}</p>
        )}
      {visible.length > 0 && (
        <div className="review-workspace">
          <nav className="review-files" aria-label="Changed files">
            {visible.map((entry) => (
              <button
                key={entry.key}
                type="button"
                aria-current={entry.key === file?.key ? "true" : undefined}
                onClick={() => {
                  setFileKey(entry.key);
                  setSelection(undefined);
                  setCollapsed(false);
                }}
              >
                <span>{entry.path}</span>
                <span>
                  {label(entry.runId)} · {entry.status}
                  {files.some((other) => other.key !== entry.key && other.path === entry.path)
                    ? " · Overlapping path"
                    : ""}
                </span>
                <span>
                  {!revision?.files.some((file) => file.key === entry.key)
                    ? "Absent from this capture"
                    : review.reviewed[entry.key] === entry.fingerprint
                      ? "Reviewed"
                      : review.reviewed[entry.key]
                        ? "Updated · unreviewed"
                        : "Unreviewed"}
                  {entry.limitation ? ` · ${entry.limitation}` : ""}
                </span>
              </button>
            ))}
          </nav>
          <div className="review-file">
            {file && (
              <div className="review-file-heading">
                <h3>{file.path}</h3>
                <span>{label(file.runId)}</span>
                <div className="review-actions">
                  <button type="button" onClick={() => setCollapsed((value) => !value)}>
                    {collapsed ? "Expand diff" : "Collapse diff"}
                  </button>
                  <button
                    type="button"
                    disabled={!address || !currentFile}
                    onClick={() => address && onOpenFile(file.path, address)}
                  >
                    Open file
                  </button>
                  <button
                    type="button"
                    disabled={busy || !currentFile}
                    onClick={() =>
                      revision &&
                      void action({
                        type: "reviewed",
                        ...identity,
                        revisionId: revision.id,
                        fileKey: file.key,
                        reviewed: review.reviewed[file.key] !== file.fingerprint,
                      })
                    }
                  >
                    {review.reviewed[file.key] === file.fingerprint
                      ? "Mark unreviewed"
                      : "Mark file reviewed"}
                  </button>
                </div>
              </div>
            )}
            {!collapsed &&
              (comparisonError ? (
                <p role="alert">Comparison unavailable: {comparisonError}</p>
              ) : content.error || before.error ? (
                <div role="alert">
                  {content.error || before.error}
                  <button
                    type="button"
                    onClick={() => {
                      content.retry();
                      before.retry();
                    }}
                  >
                    Retry file
                  </button>
                </div>
              ) : !content.content || (oldFile && !before.content) ? (
                <p role="status">Loading file…</p>
              ) : content.content.file.limitation || before.content?.file.limitation ? (
                <p role="status">
                  {content.content.file.limitation || before.content?.file.limitation}
                </p>
              ) : (
                <Suspense fallback={<p role="status">Loading diff editor…</p>}>
                  <MonacoDiff
                    address={`${revision?.id}:${baseline?.id ?? "base"}:${file?.key}`}
                    reveal={
                      reveal?.revisionId === revision?.id && reveal?.fileKey === file?.key
                        ? reveal
                        : undefined
                    }
                    path={content.content.file.path}
                    original={
                      baseline
                        ? (before.content?.modified ?? content.content.original)
                        : content.content.original
                    }
                    modified={currentFile ? content.content.modified : content.content.original}
                    onSelection={(side, start, end) => {
                      if (!file || !revision) return;
                      if (side === "modified" && !currentFile) return;
                      if (baseline && side === "original" && !oldFile) return;
                      setSelection({
                        fileKey: file.key,
                        revisionId: side === "original" && baseline ? baseline.id : revision.id,
                        side: side === "original" && baseline ? "modified" : side,
                        start,
                        end: Math.min(end, start + 200),
                      });
                    }}
                  />
                </Suspense>
              ))}
          </div>
        </div>
      )}
      <section className="review-feedback" aria-label="Review feedback">
        <h3>Feedback</h3>
        {selection && (
          <button
            type="button"
            disabled={!!draft.trim() || !!editing}
            onClick={() => {
              setAnchor(selection);
              document.getElementById(`feedback-${review.id}`)?.focus();
            }}
          >
            Comment on {selection.side} lines {selection.start}–{selection.end}
          </button>
        )}
        {revision && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void action({
                type: "comment",
                ...identity,
                id: editing ?? crypto.randomUUID(),
                revisionId: anchor?.revisionId ?? revision.id,
                text: draft,
                ...(anchor ? { anchor } : {}),
              }).then((saved) => {
                if (saved && mounted.current) {
                  setDraft("");
                  setEditing(undefined);
                  setAnchor(undefined);
                  setSelection(undefined);
                }
              });
            }}
          >
            <label htmlFor={`feedback-${review.id}`}>
              {anchor
                ? `${files.find((file) => file.key === anchor.fileKey)?.path ?? "File"} · ${anchor.side} lines ${anchor.start}–${anchor.end}`
                : "General feedback"}
            </label>
            {anchor && (
              <button type="button" onClick={() => setAnchor(undefined)}>
                Use general feedback
              </button>
            )}
            <textarea
              id={`feedback-${review.id}`}
              value={draft}
              maxLength={8_000}
              onChange={(event) => setDraft(event.target.value)}
            />
            <button type="submit" disabled={busy || !draft.trim()}>
              {editing ? "Save feedback" : "Add feedback"}
            </button>
          </form>
        )}
        {review.comments.map((comment) => {
          const locked = review.submissions.some(
            (batch) =>
              ["pending", "delivering", "failed"].includes(batch.state) &&
              batch.commentIds.includes(comment.id),
          );
          const location = comment.anchor;
          return (
            <article key={comment.id} className="review-comment">
              <div className="review-actions">
                <span>
                  {comment.state}
                  {location && outdated(location) ? " · Outdated" : ""}
                </span>
                {location && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(location.revisionId);
                      setFileKey(location.fileKey);
                      setSinceFeedback(false);
                      setWorker("");
                      setCollapsed(false);
                      setReveal({ ...location });
                    }}
                  >
                    {
                      review.revisions
                        .find((revision) => revision.id === location.revisionId)
                        ?.files.find((file) => file.key === location.fileKey)?.path
                    }{" "}
                    · {location.side} {location.start}–{location.end}
                  </button>
                )}
                {comment.state === "draft" && !locked && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(comment.id);
                        setDraft(comment.text);
                        setAnchor(comment.anchor);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void action({ type: "delete-comment", ...identity, id: comment.id })
                      }
                    >
                      Delete
                    </button>
                  </>
                )}
                {comment.state !== "draft" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void action({
                        type: "resolve",
                        ...identity,
                        id: comment.id,
                        resolved: comment.state !== "resolved",
                      })
                    }
                  >
                    {comment.state === "resolved" ? "Reopen" : "Resolve"}
                  </button>
                )}
              </div>
              <p>{comment.text}</p>
              {comment.addressed && <p>Agent reports addressed: {comment.addressed}</p>}
            </article>
          );
        })}
        {review.submissions.map((batch) => (
          <div className="review-submission" key={batch.id} role="status">
            <span>
              {batch.state === "pending"
                ? "Feedback waiting for the orchestrator"
                : batch.state === "delivering"
                  ? "Delivering feedback…"
                  : batch.state === "delivered"
                    ? "Feedback delivered"
                    : batch.state === "failed"
                      ? "Feedback delivery failed"
                      : "Feedback withdrawn"}
              {batch.error ? ` · ${batch.error}` : ""}
            </span>
            {(batch.state === "pending" || batch.state === "failed") && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void action({ type: "withdraw", ...identity, id: batch.id })}
              >
                Withdraw
              </button>
            )}
            {batch.state === "failed" && (
              <button
                type="button"
                disabled={busy || !connected}
                onClick={() => void action({ type: "retry", ...identity, id: batch.id })}
              >
                Retry feedback
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          className="primary"
          disabled={
            !connected ||
            busy ||
            !revision ||
            !draftComments.some(
              (comment) =>
                !review.submissions.some(
                  (batch) =>
                    ["pending", "delivering", "failed"].includes(batch.state) &&
                    batch.commentIds.includes(comment.id),
                ),
            )
          }
          onClick={() =>
            revision &&
            void action({
              type: "submit",
              ...identity,
              id: crypto.randomUUID(),
              revisionId: revision.id,
            })
          }
        >
          Send feedback
        </button>
      </section>
    </section>
  );
}

export function ReviewPanelLoader({
  review: summary,
  ...props
}: Omit<Parameters<typeof ReviewPanel>[0], "review"> & { review: ReviewSummary }) {
  const [review, setReview] = useState<Review>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const version = `${summary.id}:${summary.version}:${attempt}`;
  useEffect(() => {
    let current = true;
    if (!version) return;
    setError("");
    void props.api
      .readReview({ project: props.project, reviewId: summary.id, requestId: crypto.randomUUID() })
      .then(
        (review) => {
          if (current) setReview(review);
        },
        (cause: unknown) => {
          if (current) setError(cause instanceof Error ? cause.message : String(cause));
        },
      );
    return () => {
      current = false;
    };
  }, [props.api, props.project, summary.id, version]);
  if (error)
    return (
      <div role="alert">
        {error}
        <button type="button" onClick={() => setAttempt((value) => value + 1)}>
          Retry review
        </button>
      </div>
    );
  if (!review || review.id !== summary.id) return <p role="status">Loading review…</p>;
  return <ReviewPanel {...props} review={review} />;
}
