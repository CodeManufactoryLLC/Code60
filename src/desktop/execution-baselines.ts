import type { CoreDeps } from "../core/index.js";
import type { ExecutionOwner, ExecutionTarget } from "./execution-host.js";

/** Live preparation only. Nothing here restores execution authority from saved history. */
export class ExecutionBaselines {
  private readonly captures = new Map<string, Promise<string>>();
  constructor(private readonly git: CoreDeps["git"]) {}

  capture(
    owner: ExecutionOwner,
    target: ExecutionTarget,
    base: string | undefined,
    signal: AbortSignal,
  ): Promise<string> {
    signal.throwIfAborted();
    const key = JSON.stringify([owner.id, owner.generation, owner.taskId, target.id, base ?? null]);
    const previous = this.captures.get(key);
    if (previous) return previous;
    if (this.captures.size >= 4096) throw new Error("Relay baseline capacity reached.");
    const capture = this.prepare(target, base, signal);
    this.captures.set(key, capture);
    void capture.catch(() => {
      if (this.captures.get(key) === capture) this.captures.delete(key);
    });
    return capture;
  }

  private async prepare(
    target: ExecutionTarget,
    base: string | undefined,
    signal: AbortSignal,
  ): Promise<string> {
    const repo = await this.git.repoInfo(target.cwd).catch(() => {
      throw new Error("Set up Git before dispatching isolated workers.");
    });
    signal.throwIfAborted();
    if (base !== undefined) return this.git.resolveCommit(repo.topLevel, base);
    await this.git.resolveCommit(repo.topLevel, "HEAD");
    signal.throwIfAborted();
    if (!this.git.tasks) throw new Error("Current-files baseline capture is unavailable.");
    return this.git.tasks.snapshot(repo.topLevel, undefined, signal);
  }
}
