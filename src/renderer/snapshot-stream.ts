/** One bounded subscribe-before-read protocol for app and owner-scoped streams. */
export function startSnapshotStream<Frame, State>(options: {
  subscribe(listener: (frame: Frame) => void): () => void;
  read(): Promise<Frame>;
  current(): State | undefined;
  merge(state: State | undefined, frame: Frame): State;
  hasGap(state: State, frame: Frame): boolean;
  stale?(state: State): boolean;
  resynchronize?(refresh: () => void): () => void;
  publish(state: State): void;
  fail(message: string): void;
}): () => void {
  let disposed = false;
  let initialized = false;
  let overflow = false;
  const buffered: Frame[] = [];
  const buffer = (frame: Frame) => {
    if (buffered.length === 32) {
      buffered.length = 0;
      overflow = true;
    }
    buffered.push(frame);
  };
  const failure = (cause: unknown) => {
    if (disposed) return;
    disposed = true;
    buffered.length = 0;
    off();
    offResynchronize?.();
    options.fail(cause instanceof Error ? cause.message : String(cause));
  };
  const read = async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) {
        buffered.length = 0;
        overflow = false;
      }
      const initial = await options.read();
      if (disposed) return;
      if (overflow) continue;
      let next = options.merge(options.current(), initial);
      let gap = false;
      for (const frame of buffered) {
        if (options.hasGap(next, frame)) {
          gap = true;
          break;
        }
        next = options.merge(next, frame);
      }
      if (gap || options.stale?.(next)) continue;
      buffered.length = 0;
      initialized = true;
      options.publish(next);
      return;
    }
    throw new Error("Live updates fell behind. Reload the application to resynchronize.");
  };
  const off = options.subscribe((frame) => {
    if (disposed) return;
    if (!initialized) buffer(frame);
    else {
      const current = options.current();
      if (current && options.hasGap(current, frame)) {
        initialized = false;
        buffer(frame);
        void read().catch(failure);
      } else options.publish(options.merge(current, frame));
    }
  });
  const offResynchronize = options.resynchronize?.(() => {
    if (disposed || !initialized) return;
    initialized = false;
    void read().catch(failure);
  });
  void read().catch(failure);
  return () => {
    if (!disposed) {
      off();
      offResynchronize?.();
    }
    disposed = true;
    buffered.length = 0;
  };
}
