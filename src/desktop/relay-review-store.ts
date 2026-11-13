import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import type { RelayReviewEntry, Review } from "../bridge/index.js";
import { type CoreDeps, TaskLoop } from "../core/index.js";
import { privateDirectory } from "../platform/index.js";
import type { ExecutionWorker } from "./execution-host.js";
import { RelayReviewIndex } from "./relay-review-index.js";
import { readRelayState, verifyRelayStorage } from "./relay-storage.js";
import { ReviewStore } from "./reviews.js";

interface Assignment {
  key: string;
  reviewId: string;
  targetId: string;
  turn: number;
  pinned: boolean;
}
const groupKey = (worker: ExecutionWorker) =>
  JSON.stringify([
    worker.owner.generation,
    worker.owner.taskId,
    worker.target.id,
    worker.workspaceMode,
  ]);

/** Lazy evidence storage. Its ephemeral assignments never authorize worker controls. */
export class RelayReviewStore {
  readonly liveSubmissions = new Set<string>();
  private readonly groups = new Map<string, string>();
  private readonly assignments = new Map<string, Assignment>();
  private writes: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private epoch = 0;
  private constructor(
    readonly root: string,
    readonly id: string,
    readonly index: RelayReviewIndex,
    private readonly deps: CoreDeps,
  ) {}
  static async open(root: string, id: string, deps: CoreDeps): Promise<RelayReviewStore> {
    await privateDirectory(root);
    await privateDirectory(join(root, "records"));
    return new RelayReviewStore(
      root,
      id,
      await RelayReviewIndex.open(join(root, "index"), id),
      deps,
    );
  }
  private async storage() {
    for (const path of [this.root, join(this.root, "records"), join(this.root, "index")])
      await verifyRelayStorage(path, true);
  }
  async read(id: string, create = false): Promise<ReviewStore> {
    await this.storage();
    const store = await ReviewStore.open(join(this.root, "records"), this.id, {
      recordId: id,
      create,
      liveSubmissions: this.liveSubmissions,
      read: (path) => readRelayState(path, 16 * 1_048_576),
    });
    if (store.list().length && store.get(id).relay?.conversationId !== this.id)
      throw new Error("Invalid Relay review conversation provenance");
    return store;
  }
  write<T>(id: string, action: (store: ReviewStore) => Promise<T>): Promise<T> {
    return this.serial(async () => action(await this.read(id)));
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    if (this.pending >= 256) return Promise.reject(new Error("Relay review writes are busy"));
    this.pending++;
    const result = this.writes.then(work).finally(() => this.pending--);
    this.writes = result.catch(() => {});
    return result;
  }
  assignment(runId: string): { reviewId: string; targetId: string; turn: number } | undefined {
    const found = this.assignments.get(runId);
    return found
      ? { reviewId: found.reviewId, targetId: found.targetId, turn: found.turn }
      : undefined;
  }
  reset(): void {
    this.epoch++;
    this.groups.clear();
    this.assignments.clear();
    this.liveSubmissions.clear();
  }
  async loop(review: Review): Promise<TaskLoop | undefined> {
    const origin = review.relay;
    const git = this.deps.git.tasks;
    if (!origin || origin.conversationId !== this.id || origin.workspaceMode !== "worktree" || !git)
      return undefined;
    const repo = await this.deps.git.repoInfo(origin.cwd);
    const checkout = await realpath(repo.topLevel);
    return new TaskLoop(checkout, join(this.root, "tasks", origin.targetId), git, undefined, [
      this.root,
    ]);
  }
  /** Associate only after dispatch/reply acceptance. A metadata failure never authorizes replay. */
  associate(
    worker: ExecutionWorker,
    turn: number,
    baseline = worker.taskBaseline?.taskId === worker.owner.taskId
      ? worker.taskBaseline.commit
      : undefined,
  ): Promise<string | undefined> {
    if (worker.workspaceMode === "direct") return Promise.resolve(undefined);
    const epoch = this.epoch;
    const key = groupKey(worker);
    const valid = () => {
      if (epoch !== this.epoch || key !== groupKey(worker))
        throw new Error("Relay review assignment was superseded");
    };
    return this.serial(async () => {
      valid();
      if (worker.owner.id !== this.id) throw new Error("Worker belongs to another Relay");
      const previous = this.assignments.get(worker.id);
      if (previous?.key === key && previous.turn === turn && previous.pinned === !!worker.checkout)
        return previous.reviewId;
      let id = previous?.key === key ? previous.reviewId : this.groups.get(key);
      let store = id ? await this.read(id) : undefined;
      valid();
      if (
        store &&
        id &&
        store.get(id).workers.length >= 100 &&
        !store.get(id).workers.some((item) => item.runId === worker.id)
      ) {
        store = undefined;
        id = undefined;
      }
      const fresh = !id;
      id ??= randomUUID();
      // Keep the accepted worker's evidence link even if a later write fails.
      this.assignments.set(worker.id, {
        key,
        reviewId: id,
        targetId: worker.target.id,
        turn,
        pinned: !!worker.checkout,
      });
      if (
        previous &&
        previous.key !== key &&
        ![...this.assignments.values()].some((item) => item.key === previous.key) &&
        this.groups.get(previous.key) === previous.reviewId
      )
        this.groups.delete(previous.key);
      if (fresh || !this.groups.has(key)) this.groups.set(key, id);
      if (!store) {
        store = await this.read(id, true);
        valid();
        await store.create(this.id, 0, worker.label ?? `${worker.provider} changes`, {
          conversationId: this.id,
          generation: worker.owner.generation,
          taskId: worker.owner.taskId,
          targetId: worker.target.id,
          cwd: worker.target.cwd,
          device: worker.target.device.toString(),
          inode: worker.target.inode.toString(),
          workspaceMode: worker.workspaceMode,
          ...(baseline ? { baseline } : {}),
        });
      }
      valid();
      if (baseline && !store.get(id).relay?.baseline)
        await store.mutate(id, (review) => {
          if (!review.relay) throw new Error("Missing Relay review provenance");
          review.relay.baseline = baseline;
        });
      const review = store.get(id);
      if (baseline && review.relay?.baseline !== baseline)
        throw new Error("Relay task target already has another baseline");
      if (review.relay?.baseline)
        await (await this.loop(review))?.baseline(id, review.relay.baseline);
      valid();
      if (!worker.record.base || !worker.record.branch)
        throw new Error("Relay review requires the accepted isolated worker checkout");
      await store.addWorker(
        id,
        worker.id,
        worker.label ?? worker.provider,
        turn,
        worker.checkout
          ? {
              cwd: worker.checkout.cwd,
              device: worker.checkout.device.toString(),
              inode: worker.checkout.inode.toString(),
              base: worker.record.base,
              branch: worker.record.branch,
            }
          : undefined,
      );
      valid();
      if (fresh) {
        const label = [...worker.target.cwd];
        const entry: RelayReviewEntry = {
          id,
          taskId: worker.owner.taskId,
          targetId: worker.target.id,
          generation: worker.owner.generation,
          title: review.title,
          targetLabel: label.slice(0, 256).join(""),
          labelTruncated: label.length > 256,
          workspaceMode: worker.workspaceMode,
          at: new Date().toISOString(),
        };
        await this.index.append(entry);
      }
      return id;
    });
  }
  async settled(): Promise<void> {
    await this.writes;
  }
}
