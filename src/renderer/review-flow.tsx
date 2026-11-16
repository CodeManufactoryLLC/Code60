import { useEffect, useState } from "react";
import type { DesktopApi, Review, TaskView } from "../bridge/index.js";
import { type ReviewPreview, type ReviewScope, reviewRequest } from "./review-actions.js";
import { ReviewPanel } from "./review-panel.js";
import { reviewSession } from "./review-session.js";

/** Changes is read-only history. Only interrupted legacy writes expose recovery. */
export function ReviewFlow(props: {
  api: DesktopApi;
  scope: ReviewScope;
  active: boolean;
  hint: number;
  pinnedRevision?: string;
  onPreview?: ((preview: ReviewPreview) => void) | undefined;
  initialAction?: "prepare" | "feedback" | "review";
}) {
  return <SavedChanges key={JSON.stringify(props.scope)} {...props} />;
}
function SavedChanges({
  api,
  scope,
  active,
  hint,
  pinnedRevision,
  onPreview,
}: Parameters<typeof ReviewFlow>[0]) {
  const [loaded, setLoaded] = useState<{ review: Review; task: TaskView }>();
  const [revisionId, select] = useState(pinnedRevision ?? "");
  const [error, setError] = useState("");
  const [attempt, retry] = useState(0);
  const [busy, setBusy] = useState(false);
  const owner = JSON.stringify(scope);
  // biome-ignore lint/correctness/useExhaustiveDependencies: The canonical owner and pushed hint scope this evidence read.
  useEffect(() => {
    if (!active) return;
    let current = true;
    const requestId = crypto.randomUUID();
    void (async () => {
      const review = await reviewRequest(api, scope, { type: "read", requestId });
      const task = await reviewRequest(api, scope, { type: "task", action: { type: "status" } });
      if (current && review.type === "review" && task.type === "task") {
        setLoaded({ review: review.review, task: task.task });
        select((value) => value || review.review.revisions.at(-1)?.id || "");
        setError("");
      }
    })().catch((cause: unknown) => {
      if (current) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => {
      current = false;
      void reviewRequest(api, scope, { type: "cancel", requestId }).catch(() => {});
    };
  }, [api, owner, active, hint, attempt]);
  return (
    <section className="relay-review" aria-label="Saved changes">
      {error && (
        <p role="alert">
          {error}
          <button type="button" onClick={() => retry((value) => value + 1)}>
            Retry changes
          </button>
        </p>
      )}
      {!loaded && !error && <p role="status">Loading changes…</p>}
      {loaded && (
        <>
          <label>
            Snapshot
            <select value={revisionId} onChange={(event) => select(event.target.value)}>
              {loaded.review.revisions.map((revision, index) => (
                <option key={revision.id} value={revision.id}>
                  Snapshot {index + 1}
                </option>
              ))}
            </select>
          </label>
          {onPreview && revisionId && (
            <button
              type="button"
              onClick={() =>
                onPreview({
                  scope,
                  revisionId,
                  title: loaded.review.title,
                })
              }
            >
              View diff
            </button>
          )}
          {loaded.task.operation &&
            ["applying", "undoing", "recovery"].includes(loaded.task.operation.status) && (
              <div role="alert">
                A legacy file operation was interrupted. Recover it before starting another file
                operation.
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    const operationId = loaded.task.operation?.id;
                    if (!operationId) return;
                    setBusy(true);
                    void reviewSession(api, scope)
                      .run(() =>
                        reviewRequest(api, scope, {
                          type: "task",
                          action: { type: "recover", operationId },
                        }),
                      )
                      .then(
                        () => retry((value) => value + 1),
                        (cause: unknown) =>
                          setError(cause instanceof Error ? cause.message : String(cause)),
                      )
                      .finally(() => setBusy(false));
                  }}
                >
                  Recover interrupted operation
                </button>
              </div>
            )}
          {revisionId && (
            <ReviewPanel
              api={api}
              review={loaded.review}
              revisionId={revisionId}
              project={scope.kind === "relay" ? scope.conversationId : scope.project}
              {...(scope.kind === "relay" ? { relay: scope } : {})}
            />
          )}
        </>
      )}
    </section>
  );
}
