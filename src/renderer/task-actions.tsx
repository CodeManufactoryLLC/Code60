import { lazy, Suspense, useEffect, useState } from "react";
import type { DesktopApi, Review, TaskAction, TaskView } from "../bridge/index.js";
import { Modal } from "./modal.js";

const MonacoDiff = lazy(() => import("./monaco-diff.js"));

export function TaskActions({
  api,
  project,
  review,
  revisionId,
  connected,
}: {
  api: DesktopApi;
  project: string;
  review: Review;
  revisionId: string | undefined;
  connected: boolean;
}) {
  const [view, setView] = useState<TaskView>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const [file, setFile] = useState<TaskView["file"]>();
  const [fileId, setFileId] = useState("");
  const latest = review.revisions.at(-1);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Review changes can invalidate a prepared revision.
  useEffect(() => {
    let current = true;
    if (!api.taskAction || busy || preview) return;
    void api.taskAction({ type: "status", project, reviewId: review.id }).then(
      (result) => {
        if (current) setView(result);
      },
      (cause) => {
        if (current) setError(String(cause));
      },
    );
    return () => {
      current = false;
    };
  }, [api, project, review.id, review.version, busy, preview]);
  const operation = view?.operation;
  const operationId = operation?.id;
  useEffect(() => {
    let current = true;
    setFile(undefined);
    if (preview && operationId && fileId)
      void api
        .taskAction({
          type: "file",
          project,
          reviewId: review.id,
          operationId,
          fileId,
        })
        .then(
          (result) => {
            if (current) setFile(result.file);
          },
          (cause) => {
            if (current) setError(String(cause));
          },
        );
    return () => {
      current = false;
    };
  }, [api, project, review.id, operationId, fileId, preview]);
  async function act(request: TaskAction) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.taskAction(request);
      setView(result);
      if (request.type === "prepare") {
        setPreview(true);
        setFileId(result.operation?.changes[0]?.id ?? "");
      }
      if (["apply", "undo", "recover", "revise"].includes(request.type)) setPreview(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      try {
        setView(await api.taskAction({ type: "status", project, reviewId: review.id }));
      } catch {
        /* Keep the last visible state and original error. */
      }
    } finally {
      setBusy(false);
    }
  }
  if (!api.taskAction || (!view?.available && !error)) return null;
  const identity = { project, reviewId: review.id };
  const recovery = operation && ["recovery", "applying", "undoing"].includes(operation.status);
  const changed = !!latest?.files.length;
  return (
    <section aria-label="Use task changes" className="task-actions">
      <div className="review-actions">
        <span role="status">
          {busy
            ? "Preparing task changes…"
            : recovery
              ? "Recovery required"
              : operation?.status === "undone"
                ? "Undone"
                : view?.undoId
                  ? "Applied"
                  : (view?.source ?? "Current saved files")}
        </span>
        <button
          type="button"
          className="primary"
          disabled={
            busy ||
            !!recovery ||
            !view?.canPrepare ||
            !latest ||
            latest.id !== revisionId ||
            !changed
          }
          onClick={() =>
            latest && void act({ type: "prepare", ...identity, revisionId: latest.id })
          }
        >
          Use these changes…
        </button>
        {view?.undoId && (
          <button
            type="button"
            disabled={busy || !!recovery}
            onClick={() =>
              void act({ type: "undo", ...identity, operationId: view.undoId as string })
            }
          >
            Undo application
          </button>
        )}
        {recovery && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void act({ type: "recover", ...identity, operationId: operation.id })}
          >
            Recover interrupted operation
          </button>
        )}
      </div>
      {busy && !preview && (
        <button
          type="button"
          onClick={() =>
            void api
              .taskAction({ type: "cancel", ...identity })
              .catch((cause) => setError(String(cause)))
          }
        >
          Cancel operation
        </button>
      )}
      {error && !preview && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {operation?.error && <p role="status">{operation.error}</p>}
      {preview && operation && (
        <Modal title="Use these changes" wide busy={busy} onClose={() => setPreview(false)}>
          {operation.conflicts.length > 0 && (
            <p role="status">Conflicts need revision. Project files have not changed.</p>
          )}
          {operation.conflicts.map((conflict) => (
            <p key={conflict.path} role="status">
              {conflict.path}: {conflict.reason}
            </p>
          ))}
          {!operation.conflicts.length && !operation.changes.length && (
            <p role="status">No file changes to apply.</p>
          )}
          {operation.changes.length > 0 && (
            <div className="review-workspace">
              <nav className="review-files" aria-label="Files to apply">
                {operation.changes.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    aria-current={fileId === entry.id ? "true" : undefined}
                    onClick={() => setFileId(entry.id)}
                  >
                    {entry.path}
                  </button>
                ))}
              </nav>
              <div className="review-file">
                {file?.limitation ? (
                  <p>{file.limitation}</p>
                ) : file ? (
                  <Suspense fallback={<p>Loading preview…</p>}>
                    <MonacoDiff
                      path={file.path}
                      address={`apply:${operation.id}:${fileId}`}
                      original={file.original}
                      modified={file.modified}
                      onSelection={() => {}}
                    />
                  </Suspense>
                ) : (
                  !error && <p>Loading preview…</p>
                )}
              </div>
            </div>
          )}
          <div className="review-actions">
            {operation.conflicts.length ? (
              <button
                type="button"
                disabled={busy || !connected}
                onClick={() => void act({ type: "revise", ...identity, operationId: operation.id })}
              >
                Ask workers to revise
              </button>
            ) : (
              <button
                type="button"
                className="primary"
                disabled={busy || !operation.changes.length || operation.status !== "prepared"}
                onClick={() => void act({ type: "apply", ...identity, operationId: operation.id })}
              >
                Use these changes
              </button>
            )}
            <button type="button" disabled={busy} onClick={() => setPreview(false)}>
              Cancel
            </button>
          </div>
          {busy && (
            <button
              type="button"
              onClick={() =>
                void api
                  .taskAction({ type: "cancel", ...identity })
                  .catch((cause) => setError(String(cause)))
              }
            >
              Cancel operation
            </button>
          )}
          {error && <p role="alert">{error}</p>}
        </Modal>
      )}
    </section>
  );
}
