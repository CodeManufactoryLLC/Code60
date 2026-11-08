import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { DiffReads } from "./diff-reads.js";

const request = () => ({ requestId: randomUUID(), id: "run-1" });
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe("diff read lifetime", () => {
  it("bounds admission and cancels only the requested read, waiting for cleanup", async () => {
    const reads = new DiffReads();
    const first = request();
    const second = request();
    const cleanup = deferred<string>();
    const secondResult = deferred<string>();
    let signal: AbortSignal | undefined;
    const a = reads.read(
      first,
      async () => null,
      async (_, value) => {
        signal = value;
        return cleanup.promise;
      },
    );
    const rejected = expect(a).rejects.toThrow("cancelled");
    const b = reads.read(
      second,
      async () => null,
      () => secondResult.promise,
    );
    await vi.waitFor(() => expect(signal).toBeDefined());
    await expect(
      reads.read(
        request(),
        async () => null,
        async () => "",
      ),
    ).rejects.toThrow(/busy.*retry/);
    await expect(
      reads.read(
        first,
        async () => null,
        async () => "",
      ),
    ).rejects.toThrow("already in progress");
    let settled = false;
    const cancelled = reads.cancel(first.requestId).then(() => {
      settled = true;
    });
    expect(signal?.aborted).toBe(true);
    await Promise.resolve();
    expect(settled).toBe(false);
    cleanup.resolve("late result");
    await cancelled;
    await rejected;
    secondResult.resolve("other diff");
    expect(await b).toBe("other diff");
    expect(
      await reads.read(
        request(),
        async () => null,
        async () => "new diff",
      ),
    ).toBe("new diff");
  });

  it("cancels a queued preparation without deadlocking its control queue", async () => {
    const reads = new DiffReads();
    const preparation = deferred<null>();
    const execute = vi.fn(async () => "must not run");
    const result = reads.read(request(), () => preparation.promise, execute);
    const rejected = expect(result).rejects.toThrow("cancelled");
    await reads.cancel();
    await rejected;
    preparation.resolve(null);
    await Promise.resolve();
    expect(execute).not.toHaveBeenCalled();
  });

  it("preserves preparation and execution errors and releases capacity", async () => {
    const reads = new DiffReads();
    await expect(
      reads.read(
        request(),
        async () => {
          throw new Error("discarded");
        },
        async () => "",
      ),
    ).rejects.toThrow("discarded");
    await expect(
      reads.read(
        request(),
        async () => null,
        async () => {
          throw new Error("git failed");
        },
      ),
    ).rejects.toThrow("git failed");
    expect(
      await reads.read(
        request(),
        async () => null,
        async () => "",
      ),
    ).toBe("");
  });
});
