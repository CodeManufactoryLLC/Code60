import { useEffect, useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import type { DesktopApi, DesktopRun } from "../bridge/index.js";
import type { RunEvent } from "../core/index.js";
import { ScopeLifetime } from "./scope-lifetime.js";

export interface TranscriptState {
  events: Readonly<Record<string, readonly RunEvent[]>>;
  errors: Readonly<Record<string, string>>;
  pending: number;
}

/** One project owns its cache. Disposing it prevents queued reads and stale publications. */
export class TranscriptCache extends ScopeLifetime {
  private state: TranscriptState = { events: {}, errors: {}, pending: 0 };
  private listeners = new Set<() => void>();
  private requests = new Map<string, Promise<void>>();
  private versions = new Map<string, string>();
  private batch: Promise<void> = Promise.resolve();
  constructor(
    private api: Pick<DesktopApi, "action">,
    identity = "transcripts",
  ) {
    super(identity);
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(next: TranscriptState) {
    if (!this.capture()()) return;
    this.state = next;
    for (const listener of this.listeners) listener();
  }
  override dispose() {
    super.dispose();
    this.requests.clear();
    this.versions.clear();
    this.state = { ...this.state, pending: 0 };
  }
  load(runs: readonly { id: string; version: string }[], retry = false): Promise<void> {
    // Snapshot updates can request another manifest while a read batch is running.
    // Serialize batches so all callers share the same four-request limit.
    const current = this.capture();
    const next = this.batch.then(() =>
      current() ? this.loadBatch(runs, retry, current) : undefined,
    );
    this.batch = next.catch(() => {});
    return next;
  }
  private async loadBatch(
    runs: readonly { id: string; version: string }[],
    retry: boolean,
    current: () => boolean,
  ) {
    const queue = [...runs];
    const worker = async () => {
      while (current() && queue.length) {
        const run = queue.shift();
        if (!run) return;
        await this.read(run.id, run.version, retry, current);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
  }
  private read(id: string, version: string, retry: boolean, current: () => boolean): Promise<void> {
    const pending = this.requests.get(id);
    if (pending)
      return pending.then(() =>
        current() && this.versions.get(id) !== version
          ? this.read(id, version, retry, current)
          : undefined,
      );
    if (this.versions.get(id) === version && (!retry || !this.state.errors[id]))
      return Promise.resolve();
    this.versions.set(id, version);
    const errors = { ...this.state.errors };
    delete errors[id];
    this.publish({ ...this.state, errors, pending: this.state.pending + 1 });
    const request = this.api
      .action({ type: "events", id })
      .then((result) => {
        if (!current()) return;
        if (!Array.isArray(result)) throw new Error("Saved transcript is unavailable.");
        this.publish({ ...this.state, events: { ...this.state.events, [id]: result } });
      })
      .catch(() => {
        if (!current()) return;
        this.publish({
          ...this.state,
          errors: {
            ...this.state.errors,
            [id]: "Saved transcript could not be read. It may be missing or corrupt.",
          },
        });
      })
      .finally(() => {
        if (!current()) return;
        this.requests.delete(id);
        this.publish({ ...this.state, pending: Math.max(0, this.state.pending - 1) });
      });
    this.requests.set(id, request);
    return request;
  }
}

const emptyEvents: Readonly<Record<string, readonly RunEvent[]>> = {};
const emptyRuns: DesktopRun[] = [];
const emptyIds: string[] = [];
export function useTranscripts(
  api: Pick<DesktopApi, "action">,
  scope: string,
  active: boolean,
  runs: readonly DesktopRun[] = emptyRuns,
  liveIds: readonly string[] = emptyIds,
  streamed: Readonly<Record<string, readonly RunEvent[]>> = emptyEvents,
  ownerCache?: TranscriptCache,
) {
  const cache = useMemo(
    () => ownerCache ?? new TranscriptCache(api, scope),
    [api, scope, ownerCache],
  );
  const state = useSyncExternalStore(cache.subscribe, cache.snapshot);
  // The log changes when a recorded run advances a turn, ends, or resumes.
  const manifest = JSON.stringify(
    runs
      .filter((run) => !liveIds.includes(run.record.id))
      .map(({ record }) => ({
        id: record.id,
        version: `${record.status}:${record.turns}:${record.endedAt ?? ""}`,
      })),
  );
  useLayoutEffect(() => {
    cache.activate();
    return ownerCache ? undefined : () => cache.dispose();
  }, [cache, ownerCache]);
  useEffect(() => {
    if (active) void cache.load(JSON.parse(manifest));
  }, [cache, manifest, active]);
  const events = useMemo(
    () => ({
      ...streamed,
      ...state.events,
      ...Object.fromEntries(liveIds.map((id) => [id, streamed[id] ?? []])),
    }),
    [streamed, state.events, liveIds],
  );
  return {
    ...state,
    events,
    read: async () => {
      await cache.load(JSON.parse(manifest));
      return {
        ...streamed,
        ...cache.snapshot().events,
        ...Object.fromEntries(liveIds.map((id) => [id, streamed[id] ?? []])),
      };
    },
    retry: () => {
      void cache.load(JSON.parse(manifest), true);
    },
  };
}
export type Transcripts = ReturnType<typeof useTranscripts>;

export function TranscriptNotice({ data }: { data: Transcripts }) {
  const failures = Object.entries(data.errors);
  return (
    <>
      {data.pending > 0 && <p role="status">Loading saved transcripts…</p>}
      {failures.length > 0 && (
        <div className="transcript-errors" role="alert">
          <details>
            <summary>{failures.length} transcripts unavailable. Results are incomplete.</summary>
            <ul>
              {failures.map(([id, error]) => (
                <li key={id}>
                  <code>{id}</code>: {error}
                </li>
              ))}
            </ul>
          </details>
          <button type="button" onClick={data.retry}>
            Retry reads
          </button>
        </div>
      )}
    </>
  );
}
