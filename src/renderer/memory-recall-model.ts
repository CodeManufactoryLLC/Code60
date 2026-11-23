import type { ApplicationClient, MemoryDetail } from "../bridge/index.js";

type Api = Pick<ApplicationClient, "memoryDetail">;
export type RecallRecord =
  | { detail: Pick<MemoryDetail, "record" | "incomplete"> }
  | { unavailable: true };
export const RECALL_PAGE_SIZE = 5;
export const RECALL_CACHE_LIMIT = RECALL_PAGE_SIZE * 32;

type Job = { current(): boolean; run(): Promise<void>; cancel(): void };
/** Shared across owner replacements: old IPC reads cannot exceed the four-read limit. */
class ReadQueue {
  private pending: Job[] = [];
  private running = 0;
  add(job: Job) {
    this.pending.push(job);
    this.drain();
  }
  private drain() {
    this.pending = this.pending.filter((job) => {
      if (job.current()) return true;
      job.cancel();
      return false;
    });
    while (this.running < 4 && this.pending.length) {
      const job = this.pending.shift();
      if (!job) return;
      this.running++;
      void job.run().finally(() => {
        this.running--;
        this.drain();
      });
    }
  }
}
const queues = new WeakMap<Api, ReadQueue>();

/** One mounted, visible recall owner. Only a bounded page of validated IDs is retained. */
export class RecallRecords {
  private records = new Map<string, RecallRecord>();
  private state: ReadonlyMap<string, RecallRecord> = this.records;
  private listeners = new Set<() => void>();
  private version = 0;
  private wanted: string[] = [];
  private active = false;
  private queue: ReadQueue;
  constructor(private api: Api) {
    let queue = queues.get(api);
    if (!queue) {
      queue = new ReadQueue();
      queues.set(api, queue);
    }
    this.queue = queue;
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish() {
    this.state = new Map(this.records);
    for (const listener of this.listeners) listener();
  }
  stop() {
    this.active = false;
    this.version++;
    this.records.clear();
    this.state = this.records;
  }
  load(ids: readonly string[], refresh = false) {
    this.active = true;
    this.wanted = [...new Set(ids)].slice(0, RECALL_CACHE_LIMIT);
    const wanted = new Set(this.wanted);
    for (const id of this.records.keys()) if (refresh || !wanted.has(id)) this.records.delete(id);
    const version = ++this.version;
    this.publish();
    const current = () => this.active && version === this.version;
    const pending = this.wanted.filter((id) => !this.records.has(id));
    const worker = async () => {
      while (current() && pending.length) {
        const id = pending.shift();
        if (!id) return;
        await new Promise<void>((resolve) => {
          this.queue.add({
            current,
            cancel: resolve,
            run: async () => {
              try {
                const detail = await this.api.memoryDetail({ id });
                if (current())
                  this.records.set(
                    id,
                    detail.record.id === id && detail.record.state !== "forgotten"
                      ? { detail: { record: detail.record, incomplete: detail.incomplete } }
                      : { unavailable: true },
                  );
              } catch {
                if (current()) this.records.set(id, { unavailable: true });
              } finally {
                if (current()) this.publish();
                resolve();
              }
            },
          });
        });
      }
    };
    return Promise.all(Array.from({ length: Math.min(4, pending.length) }, worker));
  }
}
