/** Timing only; the caller owns single-flight reads, state and error reporting. */
export function observeServiceStatusPolling(
  read: () => Promise<void>,
  delay: () => number,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let generation = 0;
  const clear = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const check = async (owner: number) => {
    if (disposed || document.hidden || owner !== generation) return;
    // Status reads report their errors; a rejected read must not stop retry timing.
    await read().catch(() => {});
    if (!disposed && !document.hidden && owner === generation)
      timer = setTimeout(() => void check(owner), delay());
  };
  const sync = () => {
    clear();
    const owner = ++generation;
    if (!document.hidden) void check(owner);
  };
  document.addEventListener("visibilitychange", sync);
  sync();
  return () => {
    disposed = true;
    generation++;
    clear();
    document.removeEventListener("visibilitychange", sync);
  };
}
