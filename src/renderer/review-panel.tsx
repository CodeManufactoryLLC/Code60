import { lazy, Suspense, useEffect, useState } from "react";
import type { DesktopApi, Review, ReviewSummary } from "../bridge/index.js";
import { useReviewFile } from "./review-content.js";

const MonacoDiff = lazy(() => import("./monaco-diff.js"));

export function ReviewPanel({
  api,
  review,
  project,
  revisionId,
  relay,
  onFile,
}: {
  api: DesktopApi;
  review: Review;
  project: string;
  revisionId: string;
  relay?: { conversationId: string; generation: number; targetId: string };
  onFile?(key: string): void;
}) {
  const owner = review.projectId ? `${review.projectId}:${review.databaseEpoch}:` : "";
  const storageKey = `code60.review:${project}:${owner}${review.id}:${revisionId}`;
  const [fileKey, setFileKey] = useState(() => sessionStorage.getItem(`${storageKey}:file`) ?? "");
  const revision = review.revisions.find((item) => item.id === revisionId);
  useEffect(() => {
    sessionStorage.setItem(`${storageKey}:file`, fileKey);
  }, [fileKey, storageKey]);
  const files = revision?.files ?? [];
  const file = files.find((entry) => entry.key === fileKey) ?? files[0];
  useEffect(() => {
    if (file) onFile?.(file.key);
  }, [file, onFile]);
  const label = (runId: string) =>
    review.workers.find((worker) => worker.runId === runId)?.label ?? runId;
  const content = useReviewFile(
    api,
    project,
    file && revision
      ? {
          reviewId: review.id,
          ...(review.projectId
            ? {
                projectId: review.projectId,
                databaseEpoch: review.databaseEpoch,
              }
            : {}),
          revisionId: revision.id,
          fileKey: file.key,
          label: label(file.runId),
          ...(relay ? { relay } : {}),
        }
      : undefined,
  );

  return (
    <section className="review-panel" aria-label="Revision diff">
      {!revision && <p role="status">Revision unavailable.</p>}
      {review.error && <p role="alert">{review.error}</p>}
      {revision?.errors.map((entry) => (
        <p role="alert" key={entry.runId}>
          {label(entry.runId)} · Diff unavailable: {entry.message}
        </p>
      ))}
      {file && (
        <div className="review-workspace">
          <nav className="review-files" aria-label="Changed files">
            {files.map((entry) => (
              <button
                key={entry.key}
                type="button"
                aria-current={entry.key === file.key ? "true" : undefined}
                onClick={() => setFileKey(entry.key)}
              >
                <span>{entry.path}</span>
                <span>
                  {label(entry.runId)} · {entry.status}
                </span>
              </button>
            ))}
          </nav>
          <div className="review-file">
            {content.error ? (
              <div role="alert">
                {content.error}
                <button type="button" onClick={content.retry}>
                  Retry file
                </button>
              </div>
            ) : !content.content ? (
              <p role="status">Loading file…</p>
            ) : content.content.file.limitation ? (
              <p role="status">{content.content.file.limitation}</p>
            ) : (
              <Suspense fallback={<p role="status">Loading diff editor…</p>}>
                <MonacoDiff
                  address={`${storageKey}:${file.key}`}
                  path={content.content.file.path}
                  original={content.content.original}
                  modified={content.content.modified}
                />
              </Suspense>
            )}
          </div>
        </div>
      )}
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
  const version = `${summary.projectId}:${summary.databaseEpoch}:${summary.id}:${summary.version}:${attempt}`;
  useEffect(() => {
    let current = true;
    if (!version) return;
    setError("");
    void props.api
      .readReview({
        project: props.project,
        projectId: summary.projectId,
        databaseEpoch: summary.databaseEpoch,
        reviewId: summary.id,
        requestId: crypto.randomUUID(),
      })
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
  }, [props.api, props.project, summary.projectId, summary.databaseEpoch, summary.id, version]);
  if (error)
    return (
      <div role="alert">
        {error}
        <button type="button" onClick={() => setAttempt((value) => value + 1)}>
          Retry review
        </button>
      </div>
    );
  if (
    !review ||
    review.id !== summary.id ||
    review.projectId !== summary.projectId ||
    review.databaseEpoch !== summary.databaseEpoch
  )
    return <p role="status">Loading review…</p>;
  return <ReviewPanel {...props} review={review} />;
}
