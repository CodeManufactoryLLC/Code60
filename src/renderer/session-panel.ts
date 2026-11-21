import { FileBrowserState } from "./file-browser-state.js";
import { emptyFileTabs, type FileTabAction, updateFileTabs } from "./file-tabs.js";
import { ScopeLifetime } from "./scope-lifetime.js";

/** A chat or worker owns its tabs and reads for the lifetime of its project instance. */
export class SessionPanel extends ScopeLifetime {
  private tabs;
  private listeners = new Set<() => void>();
  readonly files: FileBrowserState;
  readonly openedPlans = new Map<string, number>();
  ensuredChangesReview: string | undefined;
  constructor(readonly key: string) {
    super(key);
    this.tabs = emptyFileTabs(key);
    this.files = new FileBrowserState(key);
  }
  snapshot = () => this.tabs;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  act = (action: FileTabAction) => {
    if (!this.capture()()) return;
    const next = updateFileTabs(this.tabs, action);
    if (next === this.tabs) return;
    this.tabs = next;
    for (const listener of this.listeners) listener();
  };
  override dispose() {
    super.dispose();
    this.files.dispose();
  }
}

export function sessionPanelId(
  workerId: string | undefined,
  chatId: string | undefined,
  directory?: string | null | undefined,
) {
  // Project chat directories survive reconnects that replace the provider run.
  return JSON.stringify(workerId ? ["worker", workerId] : ["chat", directory ?? chatId ?? null]);
}
