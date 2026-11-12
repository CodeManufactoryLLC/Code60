import { ScopeLifetime } from "./scope-lifetime.js";

interface State {
  selected: string | null;
  expanded: string[];
  error: string;
}

/** Temporary Explorer state belongs to one project instance, not a path-keyed cache. */
export class FileBrowserState extends ScopeLifetime {
  private state: State = { selected: null, expanded: [], error: "" };
  private listeners = new Set<() => void>();
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(change: Partial<State>) {
    if (!this.capture()()) return;
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener();
  }
  selectFile = (selected: string) => this.update({ selected });
  setError = (error: string) => this.update({ error });
  setExpanded = (change: string[] | ((previous: string[]) => string[])) => {
    const expanded = typeof change === "function" ? change(this.state.expanded) : change;
    if (expanded.length > 63) {
      this.setError("Folder limit reached. Collapse a folder before expanding another.");
      return;
    }
    this.update({ expanded, error: "" });
  };
}
