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
  projectFiles = false;
  constructor(key: string) {
    super(key);
    this.tabs = emptyFileTabs();
    this.files = new FileBrowserState(key);
  }
  showProjectFiles(value: boolean) {
    if (!this.capture()() || this.projectFiles === value) return;
    this.projectFiles = value;
    this.tabs = { ...this.tabs };
    for (const listener of this.listeners) listener();
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
  override activate() {
    super.activate();
    this.files.activate();
  }
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
  return JSON.stringify(
    workerId ? ["worker", workerId] : ["chat", projectChatIdentity(chatId, directory)],
  );
}

/** Saved chat directories survive provider run replacement. */
export function projectChatIdentity(chatId: string | undefined, directory?: string | null) {
  return directory ?? chatId ?? "disconnected";
}
