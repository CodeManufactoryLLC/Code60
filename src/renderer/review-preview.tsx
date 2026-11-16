import { lazy, Suspense, useEffect, useState } from "react";
import type { DesktopApi, Review, TaskView } from "../bridge/index.js";
import { type ReviewPreview, reviewRequest } from "./review-actions.js";
import { ReviewPanel } from "./review-panel.js";

const MonacoDiff = lazy(() => import("./monaco-diff.js"));

/** Reads only the pinned capture/proposal. Opening a tab never prepares or applies it. */
export function ReviewPreviewPanel({ api, preview }: { api: DesktopApi; preview: ReviewPreview }) {
  const [selected, select] = useState(0);
  const choice = preview.related?.[selected] ?? preview;
  return (
    <>
      {preview.related && (
        <nav aria-label="Changed targets">
          {preview.related.map((item, index) => (
            <button
              type="button"
              key={JSON.stringify([item.scope, item.revisionId])}
              aria-current={selected === index ? "true" : undefined}
              onClick={() => select(index)}
            >
              Target {index + 1}
            </button>
          ))}
        </nav>
      )}
      <PinnedReviewPreview key={JSON.stringify(choice)} api={api} preview={choice} />
    </>
  );
}
function PinnedReviewPreview({ api, preview }: { api: DesktopApi; preview: ReviewPreview }) {
  const [attempt, retry] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    review?: Review;
    file?: TaskView["file"];
    error?: string;
  }>();
  const key = JSON.stringify([preview, attempt]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: The canonical key includes all preview fields and explicit Retry.
  useEffect(() => {
    let current = true;
    const requestId = crypto.randomUUID();
    const read = preview.application
      ? reviewRequest(api, preview.scope, {
          type: "task",
          action: {
            type: "file",
            operationId: preview.application.operationId,
            fileId: preview.application.fileId,
          },
        })
      : reviewRequest(api, preview.scope, {
          type: "read",
          requestId,
          revisionId: preview.revisionId,
        });
    void read.then(
      (value) => {
        if (current)
          setResult({
            key,
            ...(value.type === "review"
              ? { review: value.review }
              : value.type === "task"
                ? { file: value.task.file }
                : {}),
          });
      },
      (cause: unknown) => {
        if (current)
          setResult({ key, error: cause instanceof Error ? cause.message : String(cause) });
      },
    );
    return () => {
      current = false;
      void reviewRequest(api, preview.scope, { type: "cancel", requestId }).catch(() => {});
    };
  }, [api, key]);
  const value = result?.key === key ? result : undefined;
  if (value?.error)
    return (
      <div role="alert">
        {value.error}
        <button type="button" onClick={() => retry((count) => count + 1)}>
          Retry preview
        </button>
      </div>
    );
  if (value?.review)
    return (
      <ReviewPanel
        api={api}
        review={value.review}
        project={
          preview.scope.kind === "relay" ? preview.scope.conversationId : preview.scope.project
        }
        revisionId={preview.revisionId}
        {...(preview.scope.kind === "relay" ? { relay: preview.scope } : {})}
      />
    );
  if (!value?.file) return <p role="status">Loading preview…</p>;
  if (value.file.limitation) return <p role="note">{value.file.limitation}</p>;
  return (
    <Suspense fallback={<p role="status">Loading diff editor…</p>}>
      <MonacoDiff
        address={key}
        path={value.file.path}
        original={value.file.original}
        modified={value.file.modified}
      />
    </Suspense>
  );
}
