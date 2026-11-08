import { lazy, Suspense, useEffect, useState } from "react";
import type { DesktopApi, ReviewContent } from "../bridge/index.js";
import type { PreviewViewState } from "./monaco-preview.js";

const MonacoPreview = lazy(() => import("./monaco-preview.js"));
export interface ReviewAddress {
  reviewId: string;
  revisionId: string;
  fileKey: string;
  label: string;
}
export function useReviewFile(
  api: DesktopApi,
  project: string,
  address: ReviewAddress | undefined,
) {
  const { reviewId, revisionId, fileKey } = address ?? {};
  const [attempt, retry] = useState(0);
  const key = reviewId ? `${project}:${reviewId}:${revisionId}:${fileKey}:${attempt}` : "";
  const [result, setResult] = useState<{ key: string; content?: ReviewContent; error?: string }>();
  useEffect(() => {
    if (!reviewId || !revisionId || !fileKey) return;
    let current = true;
    const requestId = crypto.randomUUID();
    setResult(undefined);
    void api
      .readReviewFile({
        requestId,
        project,
        reviewId,
        revisionId,
        fileKey,
      })
      .then(
        (content) => {
          if (current) setResult({ key, content });
        },
        (cause: unknown) => {
          if (current)
            setResult({ key, error: cause instanceof Error ? cause.message : String(cause) });
        },
      );
    return () => {
      current = false;
      void api.cancelDiff({ requestId }).catch(() => {});
    };
  }, [api, project, reviewId, revisionId, fileKey, key]);
  return { ...(result?.key === key ? result : {}), retry: () => retry((value) => value + 1) };
}
export function ReviewFilePreview({
  api,
  project,
  address,
  viewState,
}: {
  api: DesktopApi;
  project: string;
  address: ReviewAddress;
  viewState?: { current: PreviewViewState | null } | undefined;
}) {
  const result = useReviewFile(api, project, address);
  if (result.error)
    return (
      <div role="alert">
        {result.error}
        <button type="button" onClick={result.retry}>
          Retry
        </button>
      </div>
    );
  if (!result.content) return <p role="status">Loading…</p>;
  if (result.content.file.limitation) return <p role="status">{result.content.file.limitation}</p>;
  return (
    <section className="review-file-preview" aria-label="Reviewed file version">
      <p>
        {address.label} · {result.content.file.path}
      </p>
      <Suspense fallback={<p role="status">Loading editor…</p>}>
        <MonacoPreview
          text={
            result.content.file.status === "deleted"
              ? result.content.original
              : result.content.modified
          }
          path={result.content.file.path}
          viewState={viewState}
        />
      </Suspense>
    </section>
  );
}
