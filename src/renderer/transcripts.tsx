import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { DesktopApi, DesktopRun } from "../bridge/index.js";
import type { RunEvent } from "../core/index.js";

export interface TranscriptState {
  events: Readonly<Record<string, readonly RunEvent[]>>;
  errors: Readonly<Record<string, string>>;
  pending: number;
}

/** One project owns its cache. Disposing it prevents queued reads and stale publications. */
export class TranscriptCache {
  private state: TranscriptState = { events: {}, errors: {}, pending: 0 };
  private listeners = new Set<() => void>();
  private requests = new Map<string, Promise<void>>();
  private versions = new Map<string, string>();
  private alive = true;
  private batch: Promise<void> = Promise.resolve();
  constructor(private api: Pick<DesktopApi, "action">) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(next: TranscriptState) {
    if (!this.alive) return;
    this.state = next;
    for (const listener of this.listeners) listener();
  }
  dispose() {
    this.alive = false;
  }
  activate() {
    this.alive = true;
  }
  load(runs: readonly { id: string; version: string }[], retry = false): Promise<void> {
    // Snapshot updates can request another manifest while a read batch is running.
    // Serialize batches so all callers share the same four-request limit.
    const next = this.batch.then(() => this.loadBatch(runs, retry));
    this.batch = next.catch(() => {});
    return next;
  }
  private async loadBatch(runs: readonly { id: string; version: string }[], retry: boolean) {
    const queue = [...runs];
    const worker = async () => {
      while (this.alive && queue.length) {
        const run = queue.shift();
        if (!run) return;
        await this.read(run.id, run.version, retry);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
  }
  private read(id: string, version: string, retry: boolean): Promise<void> {
    const pending = this.requests.get(id);
    if (pending)
      return pending.then(() =>
        this.alive && this.versions.get(id) !== version ? this.read(id, version, retry) : undefined,
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
        if (!Array.isArray(result)) throw new Error("Saved transcript is unavailable.");
        this.publish({ ...this.state, events: { ...this.state.events, [id]: result } });
      })
      .catch(() => {
        this.publish({
          ...this.state,
          errors: {
            ...this.state.errors,
            [id]: "Saved transcript could not be read. It may be missing or corrupt.",
          },
        });
      })
      .finally(() => {
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
) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: each workspace owns a distinct cache and in-flight generation.
  const cache = useMemo(() => new TranscriptCache(api), [api, scope]);
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
  useEffect(() => {
    cache.activate();
    return () => cache.dispose();
  }, [cache]);
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
