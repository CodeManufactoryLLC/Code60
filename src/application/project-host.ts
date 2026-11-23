import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

/** An instance is not a path: closing/reopening a directory never revives old work. */
export interface ProjectRuntime<State> {
  readonly id: string;
  readonly epoch: number;
  readonly key: string | null;
  readonly state: State;
  closed: boolean;
}

/** Application-owned registry, not a controller per project or a durable authority store. */
export class ProjectHost<State> {
  private readonly context = new AsyncLocalStorage<ProjectRuntime<State>>();
  private readonly projects = new Map<string, ProjectRuntime<State>>();
  private epoch = 0;
  private defaultRuntime: ProjectRuntime<State>;
  private selectedRuntime: ProjectRuntime<State>;

  constructor(private readonly makeState: () => State) {
    this.defaultRuntime = this.make(null);
    this.selectedRuntime = this.defaultRuntime;
  }

  private make(key: string | null): ProjectRuntime<State> {
    return { id: randomUUID(), epoch: this.epoch, key, state: this.makeState(), closed: false };
  }

  get current(): ProjectRuntime<State> {
    return this.context.getStore() ?? this.selectedRuntime;
  }

  get selected(): ProjectRuntime<State> {
    return this.selectedRuntime;
  }

  get fallback(): ProjectRuntime<State> {
    return this.defaultRuntime;
  }

  get databaseEpoch(): number {
    return this.epoch;
  }

  all(): ProjectRuntime<State>[] {
    return [this.defaultRuntime, ...this.projects.values()];
  }

  find(key: string): ProjectRuntime<State> | undefined {
    return this.projects.get(key);
  }

  byId(id: string): ProjectRuntime<State> {
    const runtime = this.all().find((entry) => entry.id === id);
    if (!runtime) throw new Error("This project instance is no longer open");
    this.assertCurrent(runtime);
    return runtime;
  }

  open(key: string): ProjectRuntime<State> {
    const previous = this.projects.get(key);
    if (previous) return previous;
    if (this.projects.size >= 64) throw new Error("Close a project before opening another");
    const runtime = this.make(key);
    this.projects.set(key, runtime);
    return runtime;
  }

  select(runtime: ProjectRuntime<State>): void {
    this.assertCurrent(runtime);
    this.selectedRuntime = runtime;
  }

  assertCurrent(runtime: ProjectRuntime<State>): void {
    if (
      runtime.closed ||
      runtime.epoch !== this.epoch ||
      (runtime !== this.defaultRuntime && this.projects.get(runtime.key ?? "") !== runtime)
    )
      throw new Error("This project or database instance is no longer open");
  }

  /** Callers stop every owner successfully before removing its runtime. */
  remove(runtime: ProjectRuntime<State>): void {
    this.assertCurrent(runtime);
    if (runtime === this.defaultRuntime)
      throw new Error("The application context cannot be closed");
    runtime.closed = true;
    this.projects.delete(runtime.key ?? "");
    if (this.selectedRuntime === runtime)
      this.selectedRuntime = [...this.projects.values()].at(-1) ?? this.defaultRuntime;
  }

  /** Cleanup is deliberately external, so failure cannot silently forget a process owner. */
  replaceDatabase(): void {
    for (const runtime of this.all()) runtime.closed = true;
    this.projects.clear();
    this.epoch++;
    this.defaultRuntime = this.make(null);
    this.selectedRuntime = this.defaultRuntime;
  }

  run<T>(runtime: ProjectRuntime<State>, operation: () => T): T {
    return this.context.run(runtime, operation);
  }

  /** EventEmitter listeners do not inherit the registration's async context. */
  bind<Args extends unknown[]>(listener: (...args: Args) => void): (...args: Args) => void {
    const runtime = this.current;
    return (...args) => {
      if (runtime.closed || runtime.epoch !== this.epoch) return;
      this.run(runtime, () => listener(...args));
    };
  }
}
