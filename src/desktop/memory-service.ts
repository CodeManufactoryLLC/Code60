import { type ChildProcess, fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { serialize } from "node:v8";
import {
  DEFAULT_MEMORY_SETTINGS,
  type MemoryAction,
  type MemoryBrowse,
  type MemoryDetail,
  type MemoryGeneration,
  type MemoryPage,
  type MemorySettings,
  type MemorySnapshot,
  type MemorySource,
  memorySettingsSchema,
  parseValue,
} from "../bridge/index.js";
import {
  type CoreDeps,
  estimateMemoryTokens,
  generateAgentMemory,
  memoryGenerationPrompt,
  validateMemoryGeneration,
} from "../core/index.js";
import { privateDirectory } from "../platform/index.js";
import { MEMORY_LIMITS } from "./memory-limits.js";
import { MemoryRuntime } from "./memory-runtime.js";

type Range = {
  sources: MemorySource[];
  cursor: number;
  boundary: number;
  previous: string;
};
export type GeneratedMemory = {
  result: MemoryGeneration;
  sources: MemorySource[];
  previous: string;
};
type Provider = { name: string; command: readonly [string, ...string[]] };
export type MemoryTarget = { cwd: string; device: bigint; inode: bigint };

/** Application-owned service; all SQLite/model/search work is outside Electron main. */
export class MemoryService {
  private child: ChildProcess | undefined;
  private booting: Promise<void> | undefined;
  private retiring: Promise<void> | undefined;
  private idle: ReturnType<typeof setTimeout> | undefined;
  private readonly requests = new Map<
    string,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private readonly runtimes = new Set<MemoryRuntime>();
  private readonly listeners = new Set<() => void>();
  private readonly jobs = new Map<string, { abort: AbortController; done: Promise<unknown> }>();
  private generationQueue: Promise<void> = Promise.resolve();
  private revision = 0;
  get generationRevision() {
    return this.revision;
  }
  private closed = false;
  private warning: string | null = null;
  private providerKey = "";
  private mutating = 0;
  private toggling = false;
  private loaded = false;
  private maintenance: ReturnType<typeof setTimeout> | undefined;
  paused = false;
  settings: MemorySettings = structuredClone(DEFAULT_MEMORY_SETTINGS);
  readonly limits = { ...MEMORY_LIMITS };
  get capturing() {
    return this.loaded && !this.closed && !this.paused && !this.toggling && this.settings.enabled;
  }
  get learning() {
    return this.capturing && !this.mutating;
  }
  async loadSettings() {
    if (!this.loaded) await this.ready();
  }
  private scheduleMaintenance() {
    if (this.closed || !this.settings.retentionDays) {
      clearTimeout(this.maintenance);
      this.maintenance = undefined;
      return;
    }
    if (this.maintenance) return;
    this.maintenance = setTimeout(() => {
      this.maintenance = undefined;
      void this.call("maintain")
        .catch(() => this.report("Memory retention could not finish. Check available storage."))
        .finally(() => this.scheduleMaintenance());
    }, 60000);
    this.maintenance.unref();
  }

  constructor(
    private readonly root: string,
    private readonly modelRoot: string,
    private readonly deps: CoreDeps,
    private readonly provider: () => Provider | null,
    private readonly active = true,
  ) {}
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private changed() {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {}
    }
  }
  report(message: string) {
    this.warning = message;
    this.changed();
  }
  async syncProvider() {
    const key = JSON.stringify(this.provider());
    if (key === this.providerKey) return;
    this.providerKey = key;
    this.revision++;
    await this.stopJobs();
  }
  cancelConversation(cid: string) {
    this.jobs.get(cid)?.abort.abort();
  }
  async rewind(key: string, turn: number): Promise<void> {
    if (!this.active) return;
    await this.loadSettings();
    const runtimes = [...this.runtimes].filter((runtime) => runtime.matches(key));
    for (const runtime of runtimes) runtime.invalidateContext();
    await Promise.all(runtimes.map((runtime) => runtime.settle()));
    const ids = await this.call<string[]>("rewind", key, turn);
    const jobs = ids.flatMap((id) => {
      const job = this.jobs.get(id);
      return job ? [job] : [];
    });
    for (const job of jobs) job.abort.abort();
    await Promise.allSettled(jobs.map((job) => job.done));
    this.changed();
  }
  attach(
    deps: CoreDeps,
    role: "relay" | "project" | "worker",
    project?: string | null,
    key?: string,
    targets?: () => readonly MemoryTarget[],
  ): CoreDeps {
    if (!this.active) return deps;
    return {
      ...deps,
      memory: (record, repository) => {
        const runtime = new MemoryRuntime(
          this,
          role,
          key ?? record.id,
          project === undefined ? repository : project,
          targets,
        );
        this.runtimes.add(runtime);
        return runtime;
      },
    };
  }
  release(runtime: MemoryRuntime) {
    this.runtimes.delete(runtime);
  }
  private async ready() {
    await this.retiring;
    if (this.closed) throw new Error("Memory service is stopping");
    if (this.booting) return this.booting;
    if (this.child) return;
    const child = fork(fileURLToPath(new URL("./memory-worker.js", import.meta.url)), [], {
      execPath: process.execPath,
      execArgv: [],
      serialization: "advanced",
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    this.child = child;
    child.on(
      "message",
      (message: { id?: string; error?: string; result?: unknown; changed?: boolean }) => {
        if (message.changed) {
          this.changed();
          return;
        }
        if (typeof message.id !== "string") return;
        const pending = this.requests.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.requests.delete(message.id);
        if (message.error) pending.reject(new Error(message.error));
        else pending.resolve(message.result);
        this.armIdle();
      },
    );
    const failed = () => {
      if (this.child !== child) return;
      this.child = undefined;
      this.booting = undefined;
      for (const request of this.requests.values()) {
        clearTimeout(request.timer);
        request.reject(new Error("Memory sidecar stopped"));
      }
      this.requests.clear();
    };
    child.once("error", failed);
    child.once("exit", failed);
    this.booting = this.request<{ settings: MemorySettings }>("init", [this.root, this.modelRoot])
      .then((snapshot) => {
        this.settings = snapshot.settings;
        this.loaded = true;
        this.scheduleMaintenance();
      })
      .finally(() => {
        this.booting = undefined;
      });
    return this.booting;
  }
  private armIdle() {
    clearTimeout(this.idle);
    if (this.requests.size) return;
    this.idle = setTimeout(() => {
      const child = this.child;
      if (!child) return;
      this.retiring = new Promise<void>((resolve) => {
        const timer = setTimeout(() => child.kill("SIGKILL"), 1000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
        child.disconnect();
      }).finally(() => {
        this.retiring = undefined;
      });
      this.child = undefined;
    }, 60000);
    this.idle.unref();
  }
  private request<T>(op: string, args: unknown[]): Promise<T> {
    const child = this.child;
    if (!child?.connected) return Promise.reject(new Error("Memory sidecar is unavailable"));
    if (this.requests.size >= 64 || serialize(args).byteLength > 256000)
      return Promise.reject(new Error("Memory queue or request limit exceeded"));
    clearTimeout(this.idle);
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        this.requests.delete(id);
        reject(new Error("Memory operation timed out"));
        child.kill();
      }, 30000);
      this.requests.set(id, { resolve: (value) => resolve(value as T), reject, timer });
      child.send({ id, op, args }, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.requests.delete(id);
        reject(new Error("Memory request could not be sent"));
      });
    });
  }
  async call<T>(op: string, ...args: unknown[]): Promise<T> {
    await this.ready();
    return this.request<T>(op, args);
  }
  async snapshot(): Promise<MemorySnapshot> {
    const revision = this.revision;
    const snapshot = await this.call<
      Omit<MemorySnapshot, "provider" | "warning" | "busy"> & { retentionFailed?: boolean }
    >("snapshot");
    if (revision === this.revision && !this.mutating) {
      this.settings = snapshot.settings;
      this.loaded = true;
      this.scheduleMaintenance();
    }
    return {
      ...snapshot,
      provider: this.provider()?.name ?? null,
      warning:
        this.warning ??
        (snapshot.retentionFailed
          ? "Memory retention could not finish. Check available storage."
          : snapshot.indexFailed
            ? "Semantic search needs repair. Keyword recall remains available."
            : null),
      busy: this.jobs.size > 0,
    };
  }
  browse(query: MemoryBrowse) {
    return this.call<MemoryPage>("browse", query);
  }
  detail(id: string) {
    return this.call<MemoryDetail>("detail", id);
  }
  async action(action: MemoryAction, confirm: (title: string, detail: string) => Promise<boolean>) {
    if (this.mutating) throw new Error("Memory settings are changing. Try again.");
    await this.loadSettings();
    let retentionToken: string | undefined;
    if (action.type === "configure") {
      parseValue(memorySettingsSchema, action.settings);
      const before = this.settings.retentionDays;
      const after = action.settings.retentionDays;
      if (after && (!before || after < before)) {
        const preview = await this.call<{ token: string; count: number }>(
          "retention-preview",
          after,
        );
        if (
          !(await confirm(
            "Automatically delete old memories?",
            `${preview.count} unpinned memories are currently older than ${after} days and will be deleted. Future unpinned memories will also expire after ${after} days. Original transcripts are kept.`,
          ))
        )
          return false;
        retentionToken = preview.token;
      }
    }
    if (action.type === "promote" || action.type === "forget" || action.type === "forget-scope") {
      const record = "id" in action ? (await this.detail(action.id)).record : undefined;
      if ("revision" in action && record?.revision !== action.revision)
        throw new Error("This memory changed. Refresh before continuing.");
      let target = record?.text ?? "Conversations without a project";
      if (action.type === "forget-scope" && action.projectId) {
        const project = (await this.snapshot()).projects.find(
          (entry) => entry.id === action.projectId,
        );
        if (!project)
          throw new Error("This memory project is unavailable. Refresh before forgetting.");
        target = project.label;
      }
      if (
        !(await confirm(
          action.type === "promote" ? "Share this memory globally?" : "Forget derived memories?",
          action.type === "promote"
            ? `${record?.text ?? ""}\n\nAll projects and agents may receive this memory. Original scope and evidence remain visible.`
            : `${target}\n\nExclude ${record ? "this memory" : "non-global memories in this scope"} from future recall and suppress recreation from the same sources. This cannot be undone. Original transcripts and already running agent context are not erased.`,
        ))
      )
        return false;
    }
    if (this.mutating) throw new Error("Memory settings are changing. Try again.");
    this.revision++;
    this.mutating++;
    this.toggling =
      action.type === "configure" && action.settings.enabled !== this.settings.enabled;
    if (this.toggling) for (const runtime of this.runtimes) runtime.learningChanged();
    try {
      await this.stopJobs();
      await Promise.all([...this.runtimes].map((runtime) => runtime.settle()));
      if (action.type === "reindex") await this.call("reindex");
      else if (action.type === "configure")
        await this.call("configure", action.settings, retentionToken);
      else await this.call("action", action);
      if (action.type === "configure") this.settings = action.settings;
      if (action.type === "forget" || action.type === "forget-scope")
        for (const runtime of this.runtimes) runtime.invalidateContext();
      this.warning = null;
      return true;
    } finally {
      this.revision++;
      this.mutating--;
      this.toggling = false;
      for (const runtime of this.runtimes) runtime.resumeLearning();
      this.scheduleMaintenance();
      this.changed();
    }
  }
  private enqueue<T>(id: string, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.mutating || this.closed)
      return Promise.reject(new Error("Memory settings are changing or stopping"));
    if (this.jobs.size >= 64) return Promise.reject(new Error("Memory generation queue is full"));
    const revision = this.revision;
    const abort = new AbortController();
    let started = false;
    let cancelQueued = () => {};
    const cancelled = new Promise<T>((_resolve, reject) => {
      cancelQueued = () => {
        if (!started) reject(new Error("Memory generation cancelled"));
      };
      abort.signal.addEventListener("abort", cancelQueued, { once: true });
    });
    const job = this.generationQueue.then(async () => {
      if (abort.signal.aborted || revision !== this.revision)
        throw new Error("Memory generation cancelled");
      started = true;
      const value = await run(abort.signal);
      abort.signal.throwIfAborted();
      if (revision !== this.revision) throw new Error("Memory generation was superseded");
      return value;
    });
    const settled = job.finally(() => {
      abort.signal.removeEventListener("abort", cancelQueued);
      this.jobs.delete(id);
      this.changed();
    });
    const done = Promise.race([settled, cancelled]);
    this.jobs.set(id, { abort, done });
    this.generationQueue = settled.then(
      () => {},
      () => {},
    );
    this.changed();
    return done;
  }
  private async extract(
    sources: MemorySource[],
    previous: string,
    signal: AbortSignal,
    learning: boolean,
  ): Promise<MemoryGeneration> {
    const provider = this.provider();
    if (!provider) throw new Error("Select a verified orchestration provider to prepare context");
    const temporary = await mkdtemp(join(tmpdir(), "code60-memory-"));
    try {
      const cwd = join(temporary, "private");
      await privateDirectory(cwd);
      const value = await generateAgentMemory(
        this.deps.agents,
        { name: provider.name, command: provider.command, cwd },
        memoryGenerationPrompt(sources, previous, learning),
        signal,
      );
      const result = validateMemoryGeneration(value, sources);
      if (
        estimateMemoryTokens(JSON.stringify({ ...result, memories: [] })) >
        this.limits.checkpointTokens
      )
        throw new Error("Generated checkpoint exceeds the context budget");
      if (!learning) result.memories = [];
      return result;
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
  summarize(sources: MemorySource[], previous: string, signal: AbortSignal) {
    const id = `continuity:${randomUUID()}`;
    const cancel = () => this.cancelConversation(id);
    const done = this.enqueue(id, (ownSignal) =>
      this.extract(sources, previous, AbortSignal.any([signal, ownSignal]), false),
    );
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    return done.finally(() => signal.removeEventListener("abort", cancel));
  }
  generate(cid: string): Promise<GeneratedMemory | undefined> {
    const existing = this.jobs.get(cid);
    if (existing) return existing.done as Promise<GeneratedMemory | undefined>;
    return this.enqueue(cid, async (signal) => {
      if (!this.learning) return;
      const revision = this.revision;
      const range = await this.call<Range>("range", cid);
      if (!range.sources.length || !this.learning) return;
      const provider = this.provider();
      if (!provider) throw new Error("Select a verified orchestration provider to generate memory");
      const result = await this.extract(range.sources, range.previous, signal, true);
      signal.throwIfAborted();
      if (!this.learning || revision !== this.revision)
        throw new Error("Memory generation was superseded");
      await this.call(
        "publish",
        cid,
        range.cursor,
        range.boundary,
        result,
        provider.name,
        range.previous,
      );
      this.warning = null;
      return { result, sources: range.sources, previous: range.previous };
    }).catch((error: unknown) => {
      if (this.learning)
        this.report("Learning is unavailable. Check the verified provider and available storage.");
      throw error;
    });
  }
  async stopJobs() {
    for (const runtime of this.runtimes) runtime.pause();
    const jobs = [...this.jobs.values()];
    for (const job of jobs) job.abort.abort();
    await Promise.allSettled(jobs.map((job) => job.done));
  }
  async stop() {
    this.paused = true;
    this.revision++;
    await this.stopJobs();
    clearTimeout(this.idle);
    await this.retiring;
    const child = this.child;
    if (child) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => child.kill("SIGKILL"), 1000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
        child.kill();
      });
    }
  }
  async close() {
    this.closed = true;
    clearTimeout(this.maintenance);
    await this.stop();
  }
}
