import type { DiffRequest } from "../bridge/index.js";

interface Read {
  id: string;
  owner: string | undefined;
  abort: AbortController;
  done: Promise<unknown>;
}

/** Cancellation can release a queued preparation without waiting on the control queue. */
export function prepareUnlessAborted<T>(preparation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    preparation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** Owns only in-flight reads, never agent controls or a pending-work queue. */
export class DiffReads {
  private readonly reads = new Map<string, Read>();

  read<T, R>(
    request: DiffRequest,
    prepare: (signal: AbortSignal) => Promise<T>,
    execute: (target: T, signal: AbortSignal) => Promise<R>,
    owner?: string,
  ): Promise<R> {
    if (this.reads.has(request.requestId))
      return Promise.reject(new Error("This diff request is already in progress"));
    if (this.reads.size >= 2)
      return Promise.reject(new Error("Diff reads are busy. Wait for a read to finish and retry."));
    const abort = new AbortController();
    const entry: Read = { id: request.id, owner, abort, done: Promise.resolve("") };
    this.reads.set(request.requestId, entry);
    const done = (async () => {
      try {
        const target = await prepareUnlessAborted(prepare(abort.signal), abort.signal);
        abort.signal.throwIfAborted();
        const result = await execute(target, abort.signal);
        abort.signal.throwIfAborted();
        return result;
      } finally {
        this.reads.delete(request.requestId);
      }
    })();
    entry.done = done;
    // Callers still receive the rejection, including when cancellation beats IPC delivery.
    void entry.done.catch(() => {});
    return done;
  }

  async cancel(requestId?: string, runId?: string, owner?: string): Promise<void> {
    const reads = [...this.reads].filter(
      ([key, read]) =>
        (requestId === undefined || key === requestId) &&
        (runId === undefined || read.id === runId) &&
        (owner === undefined || read.owner === owner),
    );
    for (const [, read] of reads) read.abort.abort(new Error("Diff read cancelled"));
    await Promise.allSettled(reads.map(([, read]) => read.done));
  }
}
