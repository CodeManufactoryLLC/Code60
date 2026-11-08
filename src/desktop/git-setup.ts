import { randomUUID } from "node:crypto";
import type {
  GitSetupCommit,
  GitSetupIdentity,
  GitSetupOutcome,
  GitSetupSession,
} from "../bridge/index.js";
import type { GitSetupFile, GitSetupOps } from "../core/index.js";
import { readFiles } from "./files.js";

/** One explicit, project-bound setup transaction; never retries or launches workers. */
export class GitSetup {
  private session: { value: GitSetupSession; files: Map<string, GitSetupFile> } | undefined;
  private pending: { project: string; abort: AbortController; done: Promise<unknown> } | undefined;
  constructor(
    private readonly git: GitSetupOps,
    private readonly excludedPaths: string[] = [],
  ) {}
  get busy() {
    return this.pending !== undefined;
  }
  private run<T>(project: string, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.pending) return Promise.reject(new Error("Git setup is already in progress"));
    const abort = new AbortController();
    const done = Promise.resolve().then(() => work(abort.signal));
    this.pending = { project, abort, done };
    void done
      .finally(() => {
        if (this.pending?.done === done) this.pending = undefined;
      })
      .catch(() => {});
    return done;
  }
  async cancel(project?: string, sessionId?: string): Promise<void> {
    if (sessionId && this.session?.value.sessionId !== sessionId) return;
    if (project && this.pending?.project !== project && this.session?.value.project !== project)
      return;
    this.pending?.abort.abort(new Error("Git setup cancelled"));
    await this.pending?.done.catch(() => {});
    this.session = undefined;
  }
  begin(project: string): Promise<GitSetupSession> {
    return this.run(project, async (signal) => {
      this.session = undefined;
      const preview = await this.git.preview(project, signal, this.excludedPaths);
      signal.throwIfAborted();
      const files = new Map(preview.files.map((file) => [randomUUID(), file]));
      const value = {
        project,
        sessionId: randomUUID(),
        readiness: preview.readiness,
        files: [...files].map(([id, file]) => ({ id, path: file.path, size: file.size })),
        excluded: preview.excluded,
        author: preview.author,
      };
      this.session = { value, files };
      return value;
    });
  }
  private current(identity: GitSetupIdentity) {
    if (
      this.session?.value.sessionId !== identity.sessionId ||
      this.session.value.project !== identity.project
    )
      throw new Error("Git setup has changed. Refresh its preview.");
    return this.session;
  }
  async previewFile(identity: GitSetupIdentity & { fileId: string }) {
    const session = this.current(identity);
    const file = session.files.get(identity.fileId);
    if (!file) throw new Error("Unknown setup file");
    const result = await readFiles(
      { project: identity.project, root: identity.project, directories: [""], preview: file.path },
      () => this.session === session,
    );
    this.current(identity);
    return result.preview;
  }
  initialize(identity: GitSetupIdentity): Promise<GitSetupOutcome> {
    this.current(identity);
    return this.run(identity.project, async (signal) => {
      let error: string | undefined;
      try {
        await this.git.initialize(identity.project, signal);
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause);
      }
      const readiness = await this.git.readiness(identity.project);
      return { readiness, ...(error ? { error } : {}) };
    });
  }
  commit(request: GitSetupCommit): Promise<GitSetupOutcome> {
    const session = this.current(request);
    if (!request.fileIds.length && (session.files.size || session.value.excluded.length))
      throw new Error(
        "Select files for the initial commit, or use your Git tool for excluded files.",
      );
    const files = [...new Set(request.fileIds)].map((id) => {
      const file = session.files.get(id);
      if (!file) throw new Error("Unknown setup file");
      return file;
    });
    return this.run(request.project, async (signal) => {
      let error: string | undefined;
      try {
        if (!files.length) {
          const latest = await this.git.preview(request.project, signal, this.excludedPaths);
          if (latest.files.length || latest.excluded.length)
            throw new Error("Project files changed. Refresh the setup preview before committing.");
        }
        await this.git.initialize(request.project, signal);
        await this.git.commit(
          request.project,
          files,
          { name: request.name, email: request.email },
          signal,
        );
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause);
      }
      // Commit may have succeeded even when the caller saw an error/cancellation. Never replay it.
      const readiness = await this.git.readiness(request.project);
      if (error) {
        const completed =
          readiness.status === "ready"
            ? "An initial commit now exists. The commit will not be retried automatically."
            : readiness.status === "no_commits"
              ? "Git is initialized, but no initial commit exists. Selected files may be staged."
              : readiness.status === "not_repository"
                ? "No Git repository was created."
                : "Repository state could not be verified. Check Git before retrying.";
        error = `${error} ${completed} Nothing was discarded.`;
      }
      this.session = undefined;
      return { readiness, ...(error ? { error } : {}) };
    });
  }
}
