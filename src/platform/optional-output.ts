import type { Writable } from "node:stream";

/** A GUI may outlive its terminal. Preserve existing handling for other errors. */
export function guardOptionalOutput(
  stream: Pick<Writable, "prependListener" | "off" | "listenerCount">,
): () => void {
  const onError = (error: NodeJS.ErrnoException) => {
    // Keep explicit error owners (including Console's handler) authoritative.
    if (error.code !== "EPIPE" && stream.listenerCount("error") === 1) throw error;
  };
  stream.prependListener("error", onError);
  return () => {
    stream.off("error", onError);
  };
}
