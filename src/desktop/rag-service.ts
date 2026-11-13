import { fork } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RagIdentity, RagQuery, RagResults, RagStatus, RagSummary } from "../bridge/index.js";
import { RagStore } from "./rag-store.js";
import type { RagConversation, RagWork } from "./rag-worker.js";

type Progress = NonNullable<RagStatus["operation"]>;
export type RagExecutor = (
  work: RagWork,
  signal: AbortSignal,
  progress: (value: Omit<Progress, "requestId">) => void,
) => Promise<unknown>;

const executeRag: RagExecutor = (work, signal, progress) =>
  new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const child = fork(fileURLToPath(new URL("./rag-worker.js", import.meta.url)), [], {
      execPath: process.execPath,
      execArgv: [],
      serialization: "advanced",
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    let result: unknown;
    let failure: Error | undefined;
    let received = false;
    const abort = () => {
      failure = new Error("RAG operation cancelled");
      child.kill();
    };
    signal.addEventListener("abort", abort, { once: true });
    const deadline = setTimeout(() => {
      failure = new Error("RAG operation exceeded 30 minutes");
      child.kill();
    }, 30 * 60_000);
    child.on(
      "message",
      (value: { progress?: Omit<Progress, "requestId">; error?: string; result?: unknown }) => {
        if (signal.aborted) return;
        if (value.progress) progress(value.progress);
        else if (value.error) failure = new Error(value.error);
        else {
          result = value.result;
          received = true;
        }
      },
    );
    child.once("error", () => {
      failure = new Error("The RAG worker could not start");
    });
    child.once("close", (code) => {
      clearTimeout(deadline);
      signal.removeEventListener("abort", abort);
      if (failure || code !== 0 || !received)
        reject(failure ?? new Error("The RAG worker stopped unexpectedly"));
      else resolve(result);
    });
    child.send(work, (error) => {
      if (error) {
        failure = new Error("The RAG worker could not receive input");
        child.kill();
      }
    });
    if (signal.aborted) abort();
  });

/** Database-scoped, single-flight operations. Cancellation IDs never target another operation. */
export class RagService {
  private store: RagStore | undefined;
  private revision = 0;
  private index: RagSummary | null = null;
  private error: string | null = null;
  private active:
    | { id: string; abort: AbortController; done: Promise<unknown>; progress: Progress }
    | undefined;
  private listeners = new Set<(status: RagStatus) => void>();
  constructor(
    private readonly modelRoot: string,
    private readonly execute: RagExecutor = executeRag,
  ) {}
  select(databasePath: string) {
    const key = createHash("sha256").update(databasePath).digest("hex");
    this.store = new RagStore(join(dirname(databasePath), ".code60_workspace", "rag", key), key);
    this.index = null;
    this.error = null;
    this.changed();
  }
  subscribe(listener: (status: RagStatus) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  snapshot(): RagStatus {
    return {
      databaseKey: this.store?.databaseKey ?? null,
      revision: this.revision,
      model: "Jina Embeddings v2 Base Code · INT8 · CPU",
      index: this.index,
      operation: this.active?.progress ?? null,
      error: this.error,
    };
  }
  private changed() {
    this.revision++;
    for (const listener of this.listeners) listener(this.snapshot());
  }
  async status() {
    const store = this.store;
    const revision = this.revision;
    if (store && !this.active) {
      try {
        const manifest = await store.manifest();
        if (store === this.store && revision === this.revision) {
          this.index = manifest?.summary ?? null;
          this.error = null;
        }
      } catch {
        if (store === this.store && revision === this.revision)
          this.error = "The saved RAG index cannot be read. Rebuild or clear it.";
      }
    }
    return this.snapshot();
  }
  private context(request: RagIdentity) {
    if (!this.store || request.databaseKey !== this.store.databaseKey)
      throw new Error("The RAG database changed. Retry in the current database.");
    if (this.active) throw new Error("Wait for the current RAG operation or cancel it");
    return this.store;
  }
  private async operation<T>(
    request: RagIdentity,
    fn: (
      store: RagStore,
      signal: AbortSignal,
      progress: (p: Omit<Progress, "requestId">) => void,
    ) => Promise<T>,
  ): Promise<T> {
    const store = this.context(request);
    const abort = new AbortController();
    const task = {
      id: request.requestId,
      abort,
      done: Promise.resolve() as Promise<unknown>,
      progress: {
        requestId: request.requestId,
        phase: "Reading conversations",
        completed: 0,
        total: 0,
      },
    };
    this.active = task;
    this.error = null;
    const progress = (p: Omit<Progress, "requestId">) => {
      if (this.active !== task || abort.signal.aborted || store !== this.store) return;
      task.progress = { ...p, requestId: task.id };
      this.changed();
    };
    task.done = Promise.resolve().then(() => fn(store, abort.signal, progress));
    this.changed();
    try {
      return (await task.done) as T;
    } catch (error) {
      if (store === this.store)
        this.error = abort.signal.aborted
          ? "RAG operation cancelled. The previous index was kept."
          : error instanceof Error
            ? error.message
            : "RAG operation failed. The previous index was kept.";
      throw error;
    } finally {
      if (this.active === task) this.active = undefined;
      this.changed();
    }
  }
  rebuild(
    request: RagIdentity,
    sources: (
      signal: AbortSignal,
      progress: (completed: number) => void,
    ) => Promise<RagConversation[]>,
  ) {
    return this.operation(request, async (store, signal, progress) => {
      const generation = randomUUID();
      let published = false;
      try {
        const conversations = await sources(signal, (completed) =>
          progress({ phase: "Reading conversations", completed, total: 0 }),
        );
        signal.throwIfAborted();
        const summary = (await this.execute(
          {
            action: "build",
            root: store.root,
            databaseKey: store.databaseKey,
            modelRoot: this.modelRoot,
            generation,
            sources: conversations,
          },
          signal,
          progress,
        )) as RagSummary;
        signal.throwIfAborted();
        if (store !== this.store) throw new Error("The RAG database changed");
        progress({ phase: "Saving index", completed: summary.chunks, total: summary.chunks });
        await store.publish(generation, summary, signal);
        published = true;
        this.index = summary;
        // Also reclaim unfinished generations left by a previous process crash.
        await store.prune(generation).catch(() => {});
      } finally {
        if (!published) await store.remove(generation);
      }
    });
  }
  retrieve(request: RagQuery) {
    return this.operation(request, async (store, signal, progress) => {
      progress({ phase: "Retrieving", completed: 0, total: 0 });
      const result = (await this.execute(
        {
          action: "retrieve",
          root: store.root,
          databaseKey: store.databaseKey,
          modelRoot: this.modelRoot,
          text: request.text,
        },
        signal,
        progress,
      )) as RagResults;
      signal.throwIfAborted();
      if (store !== this.store) throw new Error("The RAG database changed");
      return result;
    });
  }
  clear(request: RagIdentity, confirm: () => Promise<boolean>) {
    return this.operation(request, async (store, signal) => {
      if (!(await confirm())) return false;
      signal.throwIfAborted();
      await store.clear();
      this.index = null;
      return true;
    });
  }
  async cancel(id?: string) {
    const task = this.active;
    if (!task || (id !== undefined && task.id !== id)) return;
    task.abort.abort();
    await task.done.catch(() => {});
  }
}
