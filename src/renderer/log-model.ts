import type { DesktopApi, LogPage, LogQuery, LogRecord } from "../bridge/index.js";
import { parseLogQuery } from "../bridge/index.js";

interface ViewerState {
  page: LogPage | undefined;
  pending: boolean;
  error: string;
  paused: boolean;
  newRecords: boolean;
  selected: LogRecord | undefined;
  pageNumber: number;
  hasPrevious: boolean;
}

/** Request generations prevent old filters/pages/reloads from replacing a newer result. */
export class LogViewer {
  private state: ViewerState = {
    page: undefined,
    pending: false,
    error: "",
    paused: false,
    newRecords: false,
    selected: undefined,
    pageNumber: 1,
    hasPrevious: false,
  };
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private active = false;
  private following = true;
  private cursors: (string | undefined)[] = [undefined];
  private query: LogQuery = parseLogQuery({ scope: "current" });
  private invalidated = false;
  private context = "";
  constructor(private readonly api: Pick<DesktopApi, "queryLogs">) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private update(patch: Partial<ViewerState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  activate(active: boolean): void {
    this.active = active;
    if (
      active &&
      !this.state.pending &&
      (!this.state.page || (!this.state.paused && this.state.newRecords && this.canFollow()))
    )
      void this.refresh();
    if (!active) {
      this.generation++;
      this.update({ pending: false });
    }
  }
  setFollowing(following: boolean): void {
    this.following = following;
  }
  setContext(context: string): void {
    if (this.context === context) return;
    this.context = context;
    this.generation++;
    this.cursors = [undefined];
    this.update({ page: undefined, pending: false, pageNumber: 1, hasPrevious: false });
  }
  select(record: LogRecord | undefined): void {
    this.update({ selected: record });
  }
  configure(value: Partial<LogQuery>): void {
    const next = parseLogQuery({ ...this.query, ...value, cursor: undefined });
    if (JSON.stringify(next) === JSON.stringify(this.query)) return;
    this.query = next;
    this.cursors = [undefined];
    this.generation++;
    this.update({
      page: undefined,
      pending: false,
      pageNumber: 1,
      hasPrevious: false,
      newRecords: false,
    });
    if (this.active) void this.load();
  }
  pause(paused: boolean): void {
    this.update({ paused });
    if (!paused && this.state.newRecords && this.canFollow()) void this.refresh();
  }
  private canFollow(): boolean {
    return this.active && this.following && !this.state.selected && this.state.pageNumber === 1;
  }
  notice(): void {
    this.update({ newRecords: true });
    if (this.state.pending) {
      this.invalidated = true;
      return;
    }
    if (!this.state.paused && this.canFollow()) void this.refresh();
  }
  async refresh(): Promise<void> {
    this.cursors = [undefined];
    this.update({ pageNumber: 1, hasPrevious: false });
    await this.load();
  }
  async next(): Promise<void> {
    if (!this.state.page?.cursor || this.state.pending) return;
    this.cursors.push(this.state.page.cursor);
    if (this.cursors.length > 128) this.cursors.shift();
    this.update({ pageNumber: this.state.pageNumber + 1, hasPrevious: true });
    await this.load();
  }
  async previous(): Promise<void> {
    if (this.cursors.length <= 1 || this.state.pending) return;
    this.cursors.pop();
    this.update({ pageNumber: this.state.pageNumber - 1, hasPrevious: this.cursors.length > 1 });
    await this.load();
  }
  async retry(): Promise<void> {
    await this.load();
  }
  private async load(): Promise<void> {
    const generation = ++this.generation;
    const unseen = this.state.newRecords;
    this.invalidated = false;
    this.update({ pending: true, error: "" });
    try {
      const page = await this.api.queryLogs({
        ...this.query,
        ...(this.cursors.at(-1) ? { cursor: this.cursors.at(-1) as string } : {}),
      });
      if (generation !== this.generation) return;
      this.update({
        page,
        pending: false,
        newRecords: this.invalidated || (this.state.pageNumber > 1 && unseen),
      });
      if (this.invalidated && !this.state.paused && this.canFollow()) void this.refresh();
    } catch {
      if (generation === this.generation)
        this.update({
          page: undefined,
          pending: false,
          error:
            "Could not read diagnostic logs. Check free space and private storage permissions, then retry.",
        });
    }
  }
}
