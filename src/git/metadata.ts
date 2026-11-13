import { realpath, stat } from "node:fs/promises";
import { runGit } from "./exec.js";

const tails = new Map<string, Promise<void>>();
let pending = 0;

async function commonDirectory(directory: string, signal?: AbortSignal): Promise<string> {
  const output = await runGit(
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    directory,
    { signal },
  );
  return realpath(output.endsWith("\n") ? output.slice(0, -1) : output);
}

/** Git locks still arbitrate other processes. File application has its own checkout lock. */
export async function coordinateMetadata<T>(
  directory: string,
  work: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  const common = await commonDirectory(directory, signal);
  const original = await stat(common, { bigint: true });
  const cwd = await realpath(directory);
  const checkout = await stat(cwd, { bigint: true });
  if (!original.isDirectory()) throw new Error("Git common directory is unavailable.");
  signal?.throwIfAborted();
  if (pending >= 4096) throw new Error("Git metadata operation capacity reached.");
  pending++;
  let started = false;
  let rejectQueued: (cause: unknown) => void = () => {};
  const cancelled = new Promise<never>((_resolve, reject) => {
    rejectQueued = reject;
  });
  const abort = () => {
    if (!started) rejectQueued(signal?.reason ?? new Error("Git metadata operation cancelled."));
  };
  signal?.addEventListener("abort", abort, { once: true });
  const result = (tails.get(common) ?? Promise.resolve()).then(async () => {
    started = true;
    signal?.throwIfAborted();
    const current = await stat(common, { bigint: true });
    const currentCwd = await realpath(directory);
    const currentCheckout = await stat(currentCwd, { bigint: true });
    if (
      current.dev !== original.dev ||
      current.ino !== original.ino ||
      !current.isDirectory() ||
      currentCwd !== cwd ||
      currentCheckout.dev !== checkout.dev ||
      currentCheckout.ino !== checkout.ino ||
      (await commonDirectory(directory, signal)) !== common
    )
      throw new Error("Git common directory changed while waiting.");
    signal?.throwIfAborted();
    return work();
  });
  const tail = result.then(
    () => {},
    () => {},
  );
  tails.set(common, tail);
  void tail.then(() => {
    pending--;
    if (tails.get(common) === tail) tails.delete(common);
  });
  try {
    // Only queued cancellation returns immediately. Started work must finish its
    // subprocess/finally cleanup before its caller can clean up the checkout.
    return await Promise.race([result, cancelled]);
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}
