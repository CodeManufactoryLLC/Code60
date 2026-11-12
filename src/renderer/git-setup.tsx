import { useEffect, useRef, useState } from "react";
import type {
  DesktopApi,
  FilePreview,
  GitReadiness,
  GitSetupSession,
  ProjectRequestIdentity,
} from "../bridge/index.js";
import { Modal } from "./modal.js";

export function GitReadinessNotice({
  state,
  onSetup,
  onCheck,
}: {
  state: GitReadiness;
  onSetup(): void;
  onCheck(): void;
}) {
  if (state.status === "ready") return null;
  return (
    <section className="git-readiness" aria-label="Project Git setup">
      <p>Set up Git to enable workers and change review</p>
      <p>{state.message}</p>
      {state.status === "missing" ? (
        <p>Install Git using your system tools, then check again.</p>
      ) : null}
      <div className="review-actions">
        <button
          type="button"
          disabled={!["not_repository", "no_commits"].includes(state.status)}
          onClick={onSetup}
        >
          Set up Git
        </button>
        <button type="button" onClick={onCheck}>
          Check again
        </button>
      </div>
    </section>
  );
}

export function GitSetupDialog({
  api,
  project,
  projectId,
  databaseEpoch,
  onClose,
}: ProjectRequestIdentity & {
  api: DesktopApi;
  project: string;
  onClose(): void;
}) {
  const [session, setSession] = useState<GitSetupSession>();
  const [selected, setSelected] = useState<string[]>([]);
  const [fileId, setFileId] = useState<string>();
  const [preview, setPreview] = useState<FilePreview | null>();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void api.cancelGitSetup({ project, projectId, databaseEpoch }).catch(() => {});
    };
  }, [api, project, projectId, databaseEpoch]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: The explicit retry counter requests a fresh main-process preview.
  useEffect(() => {
    let current = true;
    setBusy(true);
    setError("");
    setSession(undefined);
    setFileId(undefined);
    void api
      .beginGitSetup({ project, projectId, databaseEpoch })
      .then(
        (session) => {
          if (!current) return;
          setSession(session);
          setSelected(session.files.map((file) => file.id));
          setName(session.author.name);
          setEmail(session.author.email);
        },
        (cause: unknown) => {
          if (current) setError(cause instanceof Error ? cause.message : String(cause));
        },
      )
      .finally(() => {
        if (current) setBusy(false);
      });
    return () => {
      current = false;
    };
  }, [api, project, projectId, databaseEpoch, attempt]);
  useEffect(() => {
    let current = true;
    setPreview(undefined);
    if (session && fileId)
      void api
        .previewGitSetupFile({
          project,
          projectId,
          databaseEpoch,
          sessionId: session.sessionId,
          fileId,
        })
        .then(
          (preview) => {
            if (current) setPreview(preview);
          },
          (cause: unknown) => {
            if (current)
              setPreview({
                path: "",
                text: null,
                size: null,
                modifiedAt: null,
                error: cause instanceof Error ? cause.message : String(cause),
              });
          },
        );
    return () => {
      current = false;
    };
  }, [api, project, projectId, databaseEpoch, session, fileId]);
  async function commit() {
    if (!session || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.commitGitSetup({
        project,
        projectId,
        databaseEpoch,
        sessionId: session.sessionId,
        fileIds: selected,
        name,
        email,
      });
      if (!mounted.current) return;
      setReady(result.readiness.status === "ready");
      setError(
        result.error ?? (result.readiness.status === "ready" ? "" : result.readiness.message),
      );
      setSession(undefined);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function cancel() {
    await api.cancelGitSetup({ project, projectId, databaseEpoch }).catch((cause) => {
      if (mounted.current) setError(String(cause));
    });
    if (mounted.current) setBusy(false);
  }
  return (
    <Modal title="Set up Git" busy={busy} wide onClose={onClose}>
      <div className="git-setup-body">
        <p>
          Workers start from committed files. Review the files to include in the initial commit.
          Existing files and unrelated staged changes will be kept.
        </p>
        {error && (
          <p className="error-banner" role="alert">
            {error}
          </p>
        )}
        {busy && (
          <p role="status">{session ? "Creating initial commit…" : "Checking project files…"}</p>
        )}
        {ready ? (
          <>
            <p>
              Return to Chat and continue your request. Previous dispatches will not run
              automatically.
            </p>
            <button type="button" onClick={onClose}>
              Return to Chat
            </button>
          </>
        ) : (
          <>
            {!busy && (
              <button type="button" onClick={() => setAttempt((value) => value + 1)}>
                Refresh setup preview
              </button>
            )}
            {session && (
              <>
                <div className="review-actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setSelected(session.files.map((file) => file.id))}
                  >
                    Select all files
                  </button>
                  <button type="button" disabled={busy} onClick={() => setSelected([])}>
                    Clear selection
                  </button>
                  <span>
                    {selected.length} {selected.length === 1 ? "file" : "files"} selected
                  </span>
                </div>
                <div className="git-setup-files">
                  <fieldset disabled={busy}>
                    <legend>Files for the initial commit</legend>
                    {session.files.map((file) => (
                      <div className="git-setup-file" key={file.id}>
                        <label>
                          <input
                            type="checkbox"
                            checked={selected.includes(file.id)}
                            onChange={(event) =>
                              setSelected((ids) =>
                                event.target.checked
                                  ? [...ids, file.id]
                                  : ids.filter((id) => id !== file.id),
                              )
                            }
                          />
                          {file.path}
                        </label>
                        <button
                          type="button"
                          onClick={() => setFileId(file.id)}
                          aria-label={`Preview ${file.path}`}
                        >
                          Preview
                        </button>
                      </div>
                    ))}
                  </fieldset>
                  {fileId && (
                    <section aria-label="Git setup file preview">
                      <h3>{session.files.find((file) => file.id === fileId)?.path}</h3>
                      {!preview ? (
                        <p>Loading preview…</p>
                      ) : preview.error ? (
                        <p>{preview.error}</p>
                      ) : (
                        <pre>{preview.text}</pre>
                      )}
                    </section>
                  )}
                </div>
                {session.excluded.length > 0 && (
                  <details>
                    <summary>Files not included</summary>
                    <ul>
                      {session.excluded.map((entry) => (
                        <li key={entry}>{entry}</li>
                      ))}
                    </ul>
                  </details>
                )}
                <div className="git-setup-author">
                  <label>
                    Git author name
                    <input
                      value={name}
                      disabled={busy || !!session.author.name}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </label>
                  <label>
                    Git author email
                    <input
                      value={email}
                      disabled={busy || !!session.author.email}
                      onChange={(event) => setEmail(event.target.value)}
                    />
                  </label>
                </div>
                <p>Missing author settings are saved only in this repository.</p>
                <button
                  type="button"
                  className="primary"
                  disabled={
                    busy ||
                    !name.trim() ||
                    !email.trim() ||
                    (!selected.length && (session.files.length > 0 || session.excluded.length > 0))
                  }
                  onClick={() => void commit()}
                >
                  {session.files.length === 0 && session.excluded.length === 0
                    ? "Create empty initial commit"
                    : "Create initial commit"}
                </button>
              </>
            )}
            {busy ? (
              <button type="button" onClick={() => void cancel()}>
                Cancel Git setup
              </button>
            ) : (
              <button type="button" onClick={onClose}>
                Close
              </button>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
