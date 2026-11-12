import { lazy, Suspense, useEffect, useState } from "react";
import type { DesktopApi, ProjectRequestIdentity, ReviewContent } from "../bridge/index.js";
import type { PreviewViewState } from "./monaco-preview.js";

const MonacoPreview = lazy(() => import("./monaco-preview.js"));
export interface ReviewAddress extends ProjectRequestIdentity {
  reviewId: string;
  revisionId: string;
  fileKey: string;
  label: string;
  relay?: { conversationId: string; generation: number; targetId: string };
}
export function useReviewFile(
  api: DesktopApi,
  project: string,
  address: ReviewAddress | undefined,
) {
  const { reviewId, revisionId, fileKey, projectId, databaseEpoch } = address ?? {};
  const { conversationId, generation, targetId } = address?.relay ?? {};
  const [attempt, retry] = useState(0);
  const key = reviewId
    ? `${project}:${projectId}:${databaseEpoch}:${conversationId}:${generation}:${targetId}:${reviewId}:${revisionId}:${fileKey}:${attempt}`
    : "";
  const [result, setResult] = useState<{ key: string; content?: ReviewContent; error?: string }>();
  useEffect(() => {
    if (!reviewId || !revisionId || !fileKey) return;
    let current = true;
    const requestId = crypto.randomUUID();
    setResult(undefined);
    const read =
      conversationId && generation !== undefined && targetId
        ? api
            .relayReview({
              type: "file",
              conversationId,
              generation,
              targetId,
              reviewId,
              requestId,
              revisionId,
              fileKey,
            })
            .then((result) => {
              if (result.type !== "file") throw new Error("Unexpected Relay review file response");
              return result.content;
            })
        : api.readReviewFile({
            requestId,
            project,
            projectId,
            databaseEpoch,
            reviewId,
            revisionId,
            fileKey,
          });
    void read.then(
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
      const cancel =
        conversationId && generation !== undefined && targetId
          ? api.relayReview({
              type: "cancel",
              conversationId,
              generation,
              targetId,
              reviewId,
              requestId,
            })
          : api.cancelDiff({ requestId });
      void cancel.catch(() => {});
    };
  }, [
    api,
    project,
    projectId,
    databaseEpoch,
    conversationId,
    generation,
    targetId,
    reviewId,
    revisionId,
    fileKey,
    key,
  ]);
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
