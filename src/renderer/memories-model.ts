import type { DesktopApi, MemoryBrowse, MemoryPage, MemorySnapshot } from "../bridge/index.js";

type Api = Pick<DesktopApi, "memorySnapshot" | "browseMemories">;
interface State {
  page: MemoryPage;
  metadata: MemorySnapshot | undefined;
  pending: boolean;
  error: string;
  pageNumber: number;
}
export class MemoriesModel {
  private state: State = {
    page: { records: [], next: null },
    metadata: undefined,
    pending: false,
    error: "",
    pageNumber: 1,
  };
  private listeners = new Set<() => void>();
  private active = false;
  private running = false;
  private dirty = false;
  private generation = 0;
  private query: MemoryBrowse = {};
  private previousCursors: (string | undefined)[] = [];
  constructor(private api: Api) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(change: Partial<State>) {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener();
  }
  activate(active: boolean) {
    if (active === this.active) return;
    this.active = active;
    this.generation++;
    if (active) this.refresh();
    else this.update({ pending: false });
  }
  configure(query: MemoryBrowse) {
    this.query = { ...query, cursor: undefined };
    this.previousCursors = [];
    this.generation++;
    this.update({ page: { records: [], next: null }, pageNumber: 1 });
    this.refresh();
  }
  next() {
    if (this.state.pending || !this.state.page.next) return;
    this.previousCursors.push(this.query.cursor);
    this.query = { ...this.query, cursor: this.state.page.next };
    this.generation++;
    this.update({ page: { records: [], next: null }, pageNumber: this.previousCursors.length + 1 });
    this.refresh();
  }
  previous() {
    if (this.state.pending || !this.previousCursors.length) return;
    this.query = { ...this.query, cursor: this.previousCursors.pop() };
    this.generation++;
    this.update({ page: { records: [], next: null }, pageNumber: this.previousCursors.length + 1 });
    this.refresh();
  }
  refresh = () => {
    if (!this.active) return;
    this.dirty = true;
    this.update({ pending: true, error: "" });
    if (!this.running) void this.read();
  };
  private async read() {
    this.running = true;
    this.update({ pending: true, error: "" });
    try {
      do {
        this.dirty = false;
        const generation = this.generation;
        try {
          const [metadata, page] = await Promise.allSettled([
            this.api.memorySnapshot(),
            this.api.browseMemories(this.query),
          ]);
          if (metadata.status === "rejected" || page.status === "rejected")
            throw new Error("Memory read failed");
          if (this.active && generation === this.generation)
            this.update({ metadata: metadata.value, page: page.value, error: "" });
        } catch {
          if (this.active && generation === this.generation)
            this.update({ error: "Memories are unavailable. Retry Refresh memories." });
        }
      } while (this.active && this.dirty);
    } finally {
      this.running = false;
      this.update({ pending: false });
    }
  }
}
