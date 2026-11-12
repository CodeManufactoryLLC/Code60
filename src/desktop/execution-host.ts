import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type {
  Config,
  CoreDeps,
  Orchestrator,
  RunEvent,
  RunRecord,
  Workspace,
} from "../core/index.js";
import { ACTIVE_STATUSES, prepareRuns } from "../core/index.js";
import { ExecutionBaselines } from "./execution-baselines.js";

type WorkspaceMode = "direct" | "worktree";
export interface ExecutionTarget {
  id: string;
  cwd: string;
  device: bigint;
  inode: bigint;
}
export interface ExecutionOwner {
  id: string;
  generation: number;
  taskId: string;
}
export interface ExecutionWorker {
  id: string;
  owner: ExecutionOwner;
  target: ExecutionTarget;
  workspaceMode: WorkspaceMode;
  provider: string;
  label?: string;
  orchestrator: Orchestrator;
  workspace: Workspace;
  record: RunRecord;
  checkout?: Pick<ExecutionTarget, "cwd" | "device" | "inode">;
  /** Only a default-base dispatch freezes this task/target baseline. */
  taskBaseline?: { taskId: string; commit: string };
}
export interface TargetDispatch {
  requestId: string;
  cwd: string;
  workspaceMode: WorkspaceMode;
  provider: string;
  prompt: string;
  label?: string | undefined;
  base?: string | undefined;
  turnTimeout?: string | undefined;
  planTaskId?: string | undefined;
}
const ownerKey = (owner: ExecutionOwner) => `${owner.id}:${owner.generation}`;
const taskTarget = (owner: ExecutionOwner, cwd: string) =>
  JSON.stringify([ownerKey(owner), owner.taskId, cwd]);

/** Targets are independent of database membership, navigation and complete desktop controllers. */
export class ExecutionHost {
  private readonly targets = new Map<string, ExecutionTarget>();
  private readonly workers = new Map<string, ExecutionWorker>();
  private readonly reservations = new Map<string, number>();
  private readonly requests = new Map<string, { key: string; result: Promise<ExecutionWorker> }>();
  private readonly paused = new Set<string>();
  private readonly controls = new Map<string, Promise<unknown>>();
  private readonly preparations = new Map<
    Promise<unknown>,
    { owner: ExecutionOwner; target: Promise<ExecutionTarget>; abort: AbortController }
  >();
  private readonly folderPauses = new Set<Promise<string>>();
  private readonly orphans = new Map<Orchestrator, ExecutionTarget>();
  private epoch = 0;
  private stopping = 0;
  private closing = false;
  private readonly baselines: ExecutionBaselines;

  constructor(
    private readonly deps: CoreDeps,
    private readonly env: Readonly<Record<string, string | undefined>>,
    private readonly hooks: {
      authorize(owner: ExecutionOwner): void;
      event(worker: ExecutionWorker, event: RunEvent): void;
      changed(targetId?: string): void;
      warning(message: string): void;
      checkout?(worker: ExecutionWorker): Promise<void>;
      authorizeTarget?(
        owner: ExecutionOwner,
        request: TargetDispatch,
        target: ExecutionTarget,
      ): void;
    },
  ) {
    this.baselines = new ExecutionBaselines(deps.git);
  }

  list(owner?: Pick<ExecutionOwner, "id" | "generation">): ExecutionWorker[] {
    return [...this.workers.values()].filter(
      (worker) =>
        !owner || (worker.owner.id === owner.id && worker.owner.generation === owner.generation),
    );
  }
  liveCount(owner: ExecutionOwner): number {
    return (
      (this.reservations.get(ownerKey(owner)) ?? 0) +
      this.list(owner).filter((worker) =>
        worker.orchestrator.runs().some((run) => ACTIVE_STATUSES.has(run.status)),
      ).length
    );
  }

  private async resolve(cwd: string): Promise<ExecutionTarget> {
    if (
      cwd.length > 32_768 ||
      !isAbsolute(cwd) ||
      [...cwd].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    )
      throw new Error("Worker cwd must be a bounded absolute directory");
    const canonical = await realpath(cwd);
    const info = await stat(canonical, { bigint: true });
    if (!info.isDirectory()) throw new Error("Worker target is not a directory");
    const current = this.targets.get(canonical);
    if (current) {
      if (current.device !== info.dev || current.inode !== info.ino)
        throw new Error("Execution target directory identity changed");
      return current;
    }
    if (this.targets.size >= 256) throw new Error("Execution target limit reached");
    const target = { id: randomUUID(), cwd: canonical, device: info.dev, inode: info.ino };
    this.targets.set(canonical, target);
    return target;
  }
  async target(cwd: string): Promise<ExecutionTarget> {
    return { ...(await this.resolve(cwd)) };
  }

  validateTarget(target: ExecutionTarget): Promise<void> {
    return this.revalidate(target.cwd, target);
  }

  private async revalidate(cwd: string, target: ExecutionTarget): Promise<void> {
    const canonical = await realpath(cwd);
    const info = await stat(canonical, { bigint: true });
    if (
      canonical !== target.cwd ||
      !info.isDirectory() ||
      info.dev !== target.device ||
      info.ino !== target.inode
    )
      throw new Error("Execution target directory identity changed before launch");
  }

  dispatch(
    owner: ExecutionOwner,
    request: TargetDispatch,
    config: Config,
  ): Promise<ExecutionWorker> {
    try {
      this.hooks.authorize(owner);
      if (this.closing || this.stopping) throw new Error("Execution host is stopping");
      const requestKey = `${ownerKey(owner)}:${request.requestId}`;
      const key = JSON.stringify({ ...request, taskId: owner.taskId });
      const previous = this.requests.get(requestKey);
      if (previous) {
        if (previous.key !== key)
          throw new Error("This requestId was already used with other arguments");
        return previous.result;
      }
      if (this.requests.size >= 4096)
        throw new Error(
          "This launch reached its worker request limit. Stop work before restarting.",
        );
      if (this.liveCount(owner) >= config.maxParallel)
        throw new Error(
          `All ${config.maxParallel} worker slots are in use, including idle workers.`,
        );
      // Reserve synchronously, before canonicalization, baseline capture or any other await.
      const capacity = ownerKey(owner);
      this.reservations.set(capacity, (this.reservations.get(capacity) ?? 0) + 1);
      const epoch = this.epoch;
      const target = this.resolve(request.cwd);
      const abort = new AbortController();
      const result = this.prepare(owner, request, config, epoch, target, abort.signal).finally(
        () => {
          const remaining = (this.reservations.get(capacity) ?? 1) - 1;
          if (remaining) this.reservations.set(capacity, remaining);
          else this.reservations.delete(capacity);
          this.preparations.delete(result);
        },
      );
      this.requests.set(requestKey, { key, result });
      this.preparations.set(result, { owner, target, abort });
      void result.catch(() => {
        // Only pre-acceptance failures may release the request ID for explicit retry.
        if (this.requests.get(requestKey)?.result === result) this.requests.delete(requestKey);
      });
      return result;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  private async prepare(
    owner: ExecutionOwner,
    request: TargetDispatch,
    config: Config,
    epoch: number,
    targetPromise: Promise<ExecutionTarget>,
    signal: AbortSignal,
  ): Promise<ExecutionWorker> {
    const target = await targetPromise;
    const authorize = () => {
      signal.throwIfAborted();
      this.hooks.authorize(owner);
      if (this.closing || epoch !== this.epoch) throw new Error("Worker preparation was stopped");
      if (this.paused.has(taskTarget(owner, target.cwd)))
        throw new Error(
          "Workers in this task/target are paused. Send a new human request to continue.",
        );
      this.hooks.authorizeTarget?.(owner, request, target);
    };
    await Promise.allSettled([...this.folderPauses]);
    authorize();
    const base =
      request.workspaceMode === "worktree"
        ? await this.baselines.capture(owner, target, request.base, signal)
        : request.base;
    authorize();
    let accepted: ExecutionWorker | undefined;
    const pinCheckout = async (cwd: string) => {
      if (request.workspaceMode !== "worktree" || !this.hooks.checkout) return;
      const worker = accepted;
      if (!worker || cwd !== worker.record.worktree)
        throw new Error("Worker launch checkout does not match its accepted run");
      const canonical = await realpath(cwd);
      const info = await stat(canonical, { bigint: true });
      authorize();
      if (
        !info.isDirectory() ||
        canonical !== cwd ||
        (worker.checkout &&
          (worker.checkout.device !== info.dev || worker.checkout.inode !== info.ino))
      )
        throw new Error("Worker checkout was replaced or moved");
      worker.checkout = { cwd: canonical, device: info.dev, inode: info.ino };
      await this.hooks.checkout(worker);
      await this.revalidate(cwd, {
        id: worker.id,
        cwd: canonical,
        device: info.dev,
        inode: info.ino,
      });
      authorize();
    };
    const deps: CoreDeps = {
      ...this.deps,
      agents: {
        start: async (spec, signal) => {
          await Promise.allSettled([...this.folderPauses]);
          authorize();
          await this.revalidate(request.cwd, target);
          authorize();
          await pinCheckout(spec.cwd);
          return this.deps.agents.start(spec, signal);
        },
        restore: async (spec, sessionId, signal) => {
          await Promise.allSettled([...this.folderPauses]);
          authorize();
          await this.revalidate(request.cwd, target);
          authorize();
          await pinCheckout(spec.cwd);
          if (!this.deps.agents.restore) throw new Error("Agent restoration is unavailable");
          return this.deps.agents.restore(spec, sessionId, signal);
        },
      },
    };
    const prepared = await prepareRuns(
      deps,
      {
        cwd: target.cwd,
        env: this.env,
        mode: "interactive",
        workspaceMode: request.workspaceMode,
        agents: [request.provider],
        prompt: request.prompt,
        allowAll: true,
        ...(base === undefined ? {} : { base }),
        ...(request.turnTimeout === undefined ? {} : { turnTimeout: request.turnTimeout }),
      },
      config,
    );
    const orchestrator = prepared.orchestrator;
    this.orphans.set(orchestrator, target);
    try {
      await Promise.allSettled([...this.folderPauses]);
      authorize();
      await this.revalidate(request.cwd, target);
      authorize();
    } catch (error) {
      await orchestrator.shutdown();
      this.orphans.delete(orchestrator);
      throw error;
    }
    const id = orchestrator.runs()[0]?.id;
    if (!id) throw new Error("Worker preparation returned no run");
    let record: RunRecord;
    try {
      record = await prepared.workspace.store.read(id);
      authorize();
    } catch (cause) {
      await orchestrator.shutdown();
      this.orphans.delete(orchestrator);
      throw cause;
    }
    const worker: ExecutionWorker = {
      id,
      owner: { ...owner },
      target,
      workspaceMode: request.workspaceMode,
      provider: request.provider,
      ...(request.label === undefined ? {} : { label: request.label }),
      orchestrator,
      workspace: prepared.workspace,
      record,
      ...(request.workspaceMode === "worktree" && request.base === undefined && base !== undefined
        ? { taskBaseline: { taskId: owner.taskId, commit: base } }
        : {}),
    };
    this.workers.set(id, worker);
    accepted = worker;
    this.orphans.delete(orchestrator);
    const dispose = [
      orchestrator.onEvent((event) => {
        try {
          this.hooks.event(worker, event);
        } catch {
          this.warning("Worker events could not be displayed. Inspect the saved transcript.");
        }
      }),
      orchestrator.onChange(() => this.changed(target.id)),
      orchestrator.onWarning((message) => this.warning(message)),
    ];
    void orchestrator.done.finally(() => {
      for (const stop of dispose) stop();
      this.changed(target.id);
    });
    // Registration is the acceptance boundary. Later presentation/persistence failures
    // must not reject this request and allow an already accepted run to be dispatched twice.
    orchestrator.start();
    this.changed(target.id);
    return worker;
  }

  private changed(targetId?: string): void {
    try {
      this.hooks.changed(targetId);
    } catch {
      // Presentation failures after acceptance cannot make an accepted request retryable.
      this.warning("Worker presentation could not be refreshed.");
    }
  }
  private warning(message: string): void {
    try {
      this.hooks.warning(message);
    } catch {}
  }

  owned(owner: ExecutionOwner, id: string): ExecutionWorker {
    this.hooks.authorize(owner);
    const worker = this.workers.get(id);
    if (!worker || ownerKey(worker.owner) !== ownerKey(owner))
      throw new Error("This conversation generation does not own that worker");
    return worker;
  }

  control<T>(
    owner: ExecutionOwner,
    id: string,
    work: (worker: ExecutionWorker) => Promise<T>,
  ): Promise<T> {
    const worker = this.owned(owner, id);
    const key = worker.target.id;
    const result = (this.controls.get(key) ?? Promise.resolve()).then(() => {
      this.owned(owner, id);
      return work(worker);
    });
    this.controls.set(key, result);
    void result
      .finally(() => {
        if (this.controls.get(key) === result) this.controls.delete(key);
      })
      .catch(() => {});
    return result;
  }

  async stopFolder(cwd: string, owners: readonly ExecutionOwner[] = []): Promise<void> {
    const preparations = [...this.preparations];
    const affected = [
      ...owners,
      ...this.list().map((worker) => worker.owner),
      ...preparations.map(([, entry]) => entry.owner),
    ];
    const pause = realpath(cwd).then((canonical) => {
      for (const owner of affected) this.paused.add(taskTarget(owner, canonical));
      return canonical;
    });
    this.folderPauses.add(pause);
    void pause.finally(() => this.folderPauses.delete(pause)).catch(() => {});
    const canonical = await pause;
    const workers = this.list().filter((worker) => worker.target.cwd === canonical);
    const preparationsStopped = Promise.allSettled(
      preparations.map(async ([done, entry]) => {
        if ((await entry.target).cwd === canonical) {
          entry.abort.abort(
            new Error(
              "Workers in this task/target are paused. Send a new human request to continue.",
            ),
          );
          await done;
        }
      }),
    );
    const results = await Promise.allSettled(
      workers.map((worker) => worker.orchestrator.shutdown()),
    );
    await preparationsStopped;
    const cleanup = await Promise.allSettled(
      [...this.orphans]
        .filter(([, target]) => target.cwd === canonical)
        .map(async ([orchestrator]) => {
          await orchestrator.shutdown();
          this.orphans.delete(orchestrator);
        }),
    );
    this.cleanupErrors([...results, ...cleanup]);
  }

  async stopAll(force = false): Promise<void> {
    this.stopping++;
    try {
      this.epoch++;
      for (const entry of this.preparations.values())
        entry.abort.abort(new Error("Worker preparation was stopped"));
      const results = await Promise.allSettled(
        [...this.list().map((worker) => worker.orchestrator), ...this.orphans.keys()].map(
          async (orchestrator) => {
            await orchestrator.shutdown(force);
            this.orphans.delete(orchestrator);
          },
        ),
      );
      await Promise.allSettled([...this.preparations.keys()]);
      const remaining = await Promise.allSettled(
        [...this.orphans.keys()].map(async (orchestrator) => {
          await orchestrator.shutdown(force);
          this.orphans.delete(orchestrator);
        }),
      );
      this.cleanupErrors([...results, ...remaining]);
    } finally {
      this.stopping--;
    }
  }
  async shutdown(force = false): Promise<void> {
    this.closing = true;
    await this.stopAll(force);
  }
  private cleanupErrors(results: PromiseSettledResult<unknown>[]) {
    if (results.some((result) => result.status === "rejected"))
      throw new Error(
        "Some workers could not be stopped. Their targets and transcripts were preserved.",
      );
  }
}
