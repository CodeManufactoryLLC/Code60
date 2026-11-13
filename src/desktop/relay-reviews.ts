import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import type { RelayReviewRequest, RelayReviewResponse, Review, TaskView } from "../bridge/index.js";
import { parseRelayReview } from "../bridge/index.js";
import {
  ACTIVE_STATUSES,
  type CoreDeps,
  commandDeps,
  openWorkspace,
  prepareDiff,
  type ReviewSnapshotFile,
  recordedAgentAlive,
  type TaskProposal,
  type TaskSource,
} from "../core/index.js";
import { DiffReads } from "./diff-reads.js";
import type { ExecutionHost, ExecutionTarget } from "./execution-host.js";
import type { RelayReviewIndexCursor } from "./relay-review-index.js";
import type { RelayReviewStore } from "./relay-review-store.js";
import type { ReviewStore } from "./reviews.js";

type Address = { conversationId: string; generation: number; targetId: string; reviewId: string };
type Valid = () => void;
interface Lease {
  reviewId: string;
  cwd?: string;
  abort: AbortController;
  done: Promise<void>;
  finish(): void;
}
const ownerKey = (request: Address) =>
  JSON.stringify([request.conversationId, request.generation, request.targetId]);
const failure = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
const origin = (review: Review) => {
  if (!review.relay) throw new Error("Missing Relay review provenance");
  return review.relay;
};

/** Human-only review operations. Saved evidence is never a worker-control capability. */
export class RelayReviews {
  private readonly reads = new DiffReads();
  private readonly operations = new Map<string, Lease>();
  private readonly cursors = new Map<
    string,
    {
      position: RelayReviewIndexCursor;
      generation: number;
      expires: number;
    }
  >();
  private readonly acceptedFeedback = new Set<string>();
  private epoch = 0;
  constructor(
    readonly store: RelayReviewStore,
    private readonly deps: CoreDeps,
    private readonly env: Readonly<Record<string, string | undefined>>,
    private readonly execution: ExecutionHost,
    private readonly hooks: {
      valid(request: { conversationId: string; generation: number }): void;
      live(review: Review): boolean;
      changed(): void;
      feedback(review: Review, batchId: string, text: string): void;
      withdraw(reviewId: string, batchId: string): void;
      confirm(title: string, detail: string): Promise<boolean>;
    },
  ) {}
  private checked(store: ReviewStore, request: Address): Review {
    const review = store.get(request.reviewId);
    if (
      review.project !== request.conversationId ||
      origin(review).conversationId !== request.conversationId ||
      origin(review).targetId !== request.targetId
    )
      throw new Error("Relay review target does not match");
    return review;
  }
  private async load(request: Address, valid: Valid): Promise<ReviewStore> {
    valid();
    const store = await this.store.read(request.reviewId);
    valid();
    this.checked(store, request);
    return store;
  }
  async request(value: unknown): Promise<RelayReviewResponse> {
    const request = parseRelayReview(value);
    const epoch = this.epoch;
    const valid = () => {
      if (epoch !== this.epoch) throw new Error("Relay review operation was stopped");
      this.hooks.valid(request);
    };
    valid();
    if (request.type === "list")
      return this.reads.read(
        { id: "index", requestId: randomUUID() },
        async () => {
          const cursor = request.cursor ? this.cursors.get(request.cursor) : undefined;
          if (
            request.cursor &&
            (!cursor || cursor.generation !== request.generation || cursor.expires < Date.now())
          )
            throw new Error("Review page expired. Refresh the latest page.");
          return this.store.index.read(cursor?.position);
        },
        async (page) => {
          valid();
          let cursor: string | null = null;
          if (page.next) {
            for (const [id, saved] of this.cursors)
              if (saved.expires < Date.now()) this.cursors.delete(id);
            if (this.cursors.size >= 64)
              this.cursors.delete(this.cursors.keys().next().value ?? "");
            cursor = randomUUID();
            this.cursors.set(cursor, {
              position: page.next,
              generation: request.generation,
              expires: Date.now() + 300_000,
            });
          }
          return { type: "list", entries: page.entries, cursor };
        },
        JSON.stringify([request.conversationId, request.generation, "index"]),
      );
    if (request.type === "cancel") {
      await this.reads.cancel(request.requestId, request.reviewId, ownerKey(request));
      return { type: "done" };
    }
    if (request.type === "action") return this.action(request, valid);
    if (request.type === "task") {
      if (request.action.type === "status" || request.action.type === "file")
        return this.reads.read(
          { id: request.reviewId, requestId: randomUUID() },
          () => this.task(request, valid),
          async (result) => result,
          ownerKey(request),
        );
      return this.task(request, valid);
    }
    const lease = request.type === "capture" ? this.reserve(request) : undefined;
    try {
      return await this.reads.read(
        { id: request.reviewId, requestId: request.requestId },
        () => this.load(request, valid),
        async (store, signal): Promise<RelayReviewResponse> => {
          valid();
          if (request.type === "file") {
            const content = await store.content(
              request.reviewId,
              request.revisionId,
              request.fileKey,
            );
            valid();
            return { type: "file", content };
          }
          if (request.type === "capture") {
            if (!lease) throw new Error("Review capture was not reserved");
            const cancel = () => lease.abort.abort(signal.reason);
            signal.addEventListener("abort", cancel, { once: true });
            try {
              if (signal.aborted) cancel();
              await this.capture(request, this.checked(store, request), lease, valid);
            } finally {
              signal.removeEventListener("abort", cancel);
            }
            store = await this.load(request, valid);
          } else if (request.revisionId) {
            const review = await store.withLineStats(request.reviewId, request.revisionId);
            valid();
            return { type: "review", review, live: this.live(review) };
          }
          const review = store.get(request.reviewId);
          return { type: "review", review, live: this.live(review) };
        },
        ownerKey(request),
      );
    } finally {
      if (lease) this.release(request.targetId, lease);
    }
  }
  private live(review: Review): boolean {
    return (
      this.hooks.live(review) &&
      review.workers.length > 0 &&
      review.workers.every((saved) => {
        const worker = this.execution.list().find((worker) => worker.id === saved.runId);
        const view = worker?.orchestrator.runs()[0];
        const source = origin(review);
        return (
          worker?.owner.id === source.conversationId &&
          worker.owner.generation === source.generation &&
          worker.owner.taskId === source.taskId &&
          worker.target.id === source.targetId &&
          saved.turn === view?.turns
        );
      })
    );
  }
  assertWritableTarget(target: ExecutionTarget): void {
    if ([...this.operations].some(([id, lease]) => id === target.id || lease.cwd === target.cwd))
      throw new Error("Wait for this target's review operation to finish");
  }
  private reserve(request: Address): Lease {
    if (this.operations.has(request.targetId)) throw new Error("This target's review is busy");
    if (this.operations.size >= 2)
      throw new Error("Review operations are busy. Retry when one finishes.");
    let finish = () => {};
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const lease = { reviewId: request.reviewId, abort: new AbortController(), done, finish };
    this.operations.set(request.targetId, lease);
    return lease;
  }
  private release(targetId: string, lease: Lease): void {
    if (this.operations.get(targetId) === lease) this.operations.delete(targetId);
    lease.finish();
  }
  private async target(review: Review, lease: Lease, valid: Valid): Promise<void> {
    lease.abort.signal.throwIfAborted();
    const source = origin(review);
    if (source.workspaceMode !== "worktree")
      throw new Error("Direct changes have no isolated application");
    if ([...this.operations.values()].some((other) => other !== lease && other.cwd === source.cwd))
      throw new Error("This checkout's review is busy");
    lease.cwd = source.cwd;
    await this.identity(review, valid);
    for (const worker of this.execution
      .list()
      .filter((worker) => worker.target.cwd === source.cwd)) {
      const view = worker.orchestrator.runs()[0];
      if (
        view &&
        (view.stopping ||
          view.modeChanging ||
          (ACTIVE_STATUSES.has(view.status) && view.status !== "idle"))
      )
        throw new Error("Wait for the target's workers to finish their turns");
    }
  }
  private async identity(review: Review, valid: Valid): Promise<void> {
    valid();
    const source = origin(review);
    const canonical = await realpath(source.cwd);
    const info = await stat(canonical, { bigint: true });
    valid();
    if (
      canonical !== source.cwd ||
      !info.isDirectory() ||
      info.dev.toString() !== source.device ||
      info.ino.toString() !== source.inode
    )
      throw new Error("The saved review target was replaced or moved");
  }
  private async sources(review: Review, valid: Valid, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const source = origin(review);
    const workspace = await openWorkspace(this.deps, source.cwd, this.env, true);
    valid();
    const targets = [];
    for (const saved of review.workers) {
      signal?.throwIfAborted();
      const checkout = saved.checkout;
      if (!checkout)
        throw new Error(
          "Saved worker checkout identity is unavailable. Earlier captures remain evidence only.",
        );
      const currentCheckout = async () => {
        const canonical = await realpath(checkout.cwd);
        const info = await stat(canonical, { bigint: true });
        valid();
        if (
          canonical !== checkout.cwd ||
          !info.isDirectory() ||
          info.dev.toString() !== checkout.device ||
          info.ino.toString() !== checkout.inode
        )
          throw new Error("The saved worker checkout was replaced or moved");
      };
      await currentCheckout();
      const live = this.execution.list().find((worker) => worker.id === saved.runId);
      const record = await workspace.store.read(saved.runId);
      const repo = await this.deps.git.repoInfo(record.worktree);
      valid();
      const view = live?.orchestrator.runs()[0];
      if (
        !repo ||
        !workspace.repo ||
        record.worktree !== checkout.cwd ||
        record.base !== checkout.base ||
        record.branch !== checkout.branch ||
        (await realpath(repo.topLevel)) !== checkout.cwd ||
        (await realpath(repo.commonDir)) !== (await realpath(workspace.repo.commonDir)) ||
        saved.turn !== (view?.turns ?? record.turns) ||
        (live &&
          (live.owner.id !== source.conversationId ||
            live.owner.generation !== source.generation ||
            live.owner.taskId !== source.taskId ||
            live.target.id !== source.targetId))
      )
        throw new Error("Worker ownership or turn changed. Earlier captures remain evidence only.");
      if (
        view &&
        (view.stopping ||
          view.modeChanging ||
          (ACTIVE_STATUSES.has(view.status) && view.status !== "idle"))
      )
        throw new Error("Wait for the worker turn to finish");
      if (view?.status !== "idle") {
        if (await recordedAgentAlive(this.deps.processes, record))
          throw new Error("Stop the worker's leftover process before using its changes");
        if (
          ACTIVE_STATUSES.has(record.status) &&
          (this.deps.processes.ownerAlive
            ? await this.deps.processes.ownerAlive(record.ownerPid, record.ownerIdentity)
            : this.deps.processes.isAlive(record.ownerPid))
        )
          throw new Error("Another live process still owns this worker");
      }
      const prepared = await prepareDiff(commandDeps(this.deps, workspace), saved.runId);
      if (prepared.worktree !== checkout.cwd || prepared.base !== checkout.base)
        throw new Error("Saved worker record changed while reading");
      await currentCheckout();
      targets.push({
        runId: saved.runId,
        ...prepared,
      });
      valid();
    }
    return targets;
  }
  private async capture(
    request: Address,
    review: Review,
    lease: Lease,
    valid: Valid,
  ): Promise<void> {
    const signal = lease.abort.signal;
    await this.target(review, lease, valid);
    const targets = await this.sources(review, valid, signal);
    const git = this.deps.git.tasks;
    if (!git || !this.deps.git.reviewSnapshot) throw new Error("Structured review is unavailable");
    const applied = (await (await this.store.loop(review))?.state(review.id))?.appliedSources ?? [];
    const results: { runId: string; files?: ReviewSnapshotFile[]; error?: string }[] = [];
    const sources: TaskSource[] = [];
    let fileCount = 0;
    let bytes = 0;
    for (const target of targets) {
      signal.throwIfAborted();
      try {
        const commit = await git.snapshot(target.worktree, undefined, signal);
        const snapshot = await this.deps.git.reviewSnapshot(
          target.worktree,
          applied.find((source) => source.runId === target.runId)?.commit ?? target.base,
          signal,
          commit,
        );
        const files = snapshot.files.slice(0, Math.max(0, 2_000 - fileCount)).map((file) => {
          const size = Buffer.byteLength(file.original) + Buffer.byteLength(file.modified);
          if (bytes + size > 8_388_608)
            return {
              ...file,
              original: "",
              modified: "",
              limitation: "Review content limit reached",
            };
          bytes += size;
          return file;
        });
        fileCount += files.length;
        sources.push({ runId: target.runId, base: target.base, commit });
        results.push({
          runId: target.runId,
          files,
          ...(snapshot.truncated || files.length < snapshot.files.length
            ? { error: "File listing is partial (1,000 per worker; 2,000 per review)" }
            : {}),
        });
      } catch (cause) {
        signal.throwIfAborted();
        valid();
        results.push({ runId: target.runId, error: failure(cause).slice(0, 2_000) });
      }
    }
    signal.throwIfAborted();
    await this.identity(review, valid);
    await this.sources(review, valid, signal);
    await this.store.write(review.id, async (store) => {
      valid();
      signal.throwIfAborted();
      const current = this.checked(store, request);
      if (JSON.stringify(current.workers) !== JSON.stringify(review.workers))
        throw new Error("Review workers changed. Refresh changes.");
      await store.capture(review.id, results, sources);
    });
    this.hooks.changed();
  }
  private async action(
    request: Extract<RelayReviewRequest, { type: "action" }>,
    valid: Valid,
  ): Promise<RelayReviewResponse> {
    return this.store.write(request.reviewId, async (store) => {
      valid();
      const review = this.checked(store, request);
      const action = request.action;
      if ((action.type === "submit" || action.type === "retry") && !this.live(review))
        throw new Error("Feedback requires the live originating task and worker turns");
      if (
        (action.type === "submit" || action.type === "retry") &&
        this.acceptedFeedback.has(action.id)
      )
        throw new Error(
          "This feedback was already delivered. Inspect the conversation; do not resend it.",
        );
      if (
        (action.type === "submit" || action.type === "retry") &&
        this.acceptedFeedback.size >= 4_096
      )
        throw new Error("Feedback receipt capacity reached. Start a new Relay generation.");
      const updated = await store.action({
        ...action,
        project: request.conversationId,
        reviewId: review.id,
      });
      valid();
      if (action.type === "withdraw") {
        this.hooks.withdraw(review.id, action.id);
        this.store.liveSubmissions.delete(action.id);
      }
      if (action.type === "submit" || action.type === "retry") {
        const batch = updated.submissions.find((batch) => batch.id === action.id);
        if (batch?.state === "pending") {
          await this.queueFeedback(store, updated, batch.id, valid);
        }
      }
      this.hooks.changed();
      return { type: "review", review: store.get(review.id), live: this.live(review) };
    });
  }
  private async queueFeedback(store: ReviewStore, review: Review, batchId: string, valid: Valid) {
    this.store.liveSubmissions.add(batchId);
    try {
      const text = await store.feedback(review.id, batchId);
      valid();
      if (!this.live(review)) throw new Error("Feedback's originating task is no longer live");
      this.hooks.feedback(review, batchId, text);
    } catch (cause) {
      this.store.liveSubmissions.delete(batchId);
      await store.mutate(review.id, (current) => {
        const pending = current.submissions.find((item) => item.id === batchId);
        if (pending) {
          pending.state = "failed";
          pending.error = failure(cause).slice(0, 2_000);
        }
      });
      throw cause;
    }
  }
  async beginFeedback(reviewId: string, batchId: string): Promise<Review> {
    return this.store.write(reviewId, async (store) => {
      const review = store.get(reviewId);
      if (this.acceptedFeedback.size >= 4_096) throw new Error("Feedback receipt capacity reached");
      this.hooks.valid(origin(review));
      if (!this.live(review) || this.acceptedFeedback.has(batchId))
        throw new Error("Feedback's originating task or worker turn is no longer live");
      await store.mutate(reviewId, (current) => {
        const batch = current.submissions.find((batch) => batch.id === batchId);
        if (batch?.state !== "pending") throw new Error("Feedback is no longer pending");
        batch.state = "delivering";
      });
      return store.get(reviewId);
    });
  }
  async finishFeedback(
    reviewId: string,
    batchId: string,
    receipt: { accepted: true; turn: number; runId: string } | { accepted: false; error: string },
  ): Promise<void> {
    if (receipt.accepted) this.acceptedFeedback.add(batchId);
    try {
      await this.store.write(reviewId, (store) =>
        store.mutate(reviewId, (review) => {
          const batch = review.submissions.find((batch) => batch.id === batchId);
          if (!batch) throw new Error("Feedback receipt is missing");
          if (!receipt.accepted && batch.state === "withdrawn") return;
          if (receipt.accepted) {
            batch.state = "delivered";
            batch.deliveredTurn = receipt.turn;
            batch.deliveredChatId = receipt.runId;
            for (const comment of review.comments)
              if (batch.commentIds.includes(comment.id)) comment.state = "sent";
          } else {
            batch.state = "failed";
            batch.error = receipt.error.slice(0, 2_000);
          }
        }),
      );
    } finally {
      this.store.liveSubmissions.delete(batchId);
      this.hooks.changed();
    }
  }
  private async task(
    request: Extract<RelayReviewRequest, { type: "task" }>,
    valid: Valid,
  ): Promise<RelayReviewResponse> {
    const action = request.action;
    if (action.type === "cancel") {
      const active = this.operations.get(request.targetId);
      if (active?.reviewId === request.reviewId) {
        active.abort.abort(new Error("Review operation cancelled"));
        await active.done;
      }
      return { type: "done" };
    }
    const lease =
      action.type === "status" || action.type === "file" ? undefined : this.reserve(request);
    try {
      const store = await this.load(request, valid);
      const review = this.checked(store, request);
      if (lease) await this.identity(review, valid);
      const loop = await this.store.loop(review);
      valid();
      const git = this.deps.git.tasks;
      if (!loop || !git)
        return {
          type: "task",
          task: {
            available: false,
            canPrepare: false,
            source: "Selected Git revision",
          },
        };
      const view = async (proposal?: TaskProposal | null): Promise<RelayReviewResponse> => {
        valid();
        const undo = await loop.lastApplied(review.id);
        valid();
        const task: TaskView = {
          available: true,
          canPrepare:
            !review.error &&
            !!review.revisions.at(-1)?.sources?.length &&
            review.workers.every(
              (worker) =>
                !!worker.checkout &&
                review.revisions.at(-1)?.sources?.some((source) => source.runId === worker.runId),
            ),
          source: origin(review).baseline ? "Current saved files" : "Selected Git revision",
          ...(undo ? { undoId: undo.id } : {}),
          ...(proposal
            ? {
                operation: {
                  id: proposal.id,
                  revisionId: proposal.revisionId,
                  status: proposal.status,
                  changes: proposal.changes.map(({ id, path }) => ({ id, path })),
                  conflicts: proposal.conflicts,
                  ...(proposal.error ? { error: proposal.error } : {}),
                },
              }
            : {}),
        };
        return { type: "task", task };
      };
      if (action.type === "status") {
        const pending = await loop.pendingOperation(review.id);
        return view(pending ? { ...pending, status: "recovery" } : await loop.latest(review.id));
      }
      if (action.type === "file") {
        const proposal = await loop.proposal(review.id, action.operationId);
        const file = proposal.changes.find((file) => file.id === action.fileId);
        if (!file) throw new Error("Unknown proposal file");
        const large = (file.before?.data.length ?? 0) + (file.after?.data.length ?? 0) > 1_398_104;
        const before = large ? Buffer.alloc(0) : Buffer.from(file.before?.data ?? "", "base64");
        const after = large ? Buffer.alloc(0) : Buffer.from(file.after?.data ?? "", "base64");
        const limited =
          large ||
          [before, after].some(
            (data) => data.includes(0) || !Buffer.from(data.toString("utf8")).equals(data),
          );
        valid();
        const response = await view(proposal);
        if (response.type !== "task") throw new Error("Missing task preview");
        response.task.file = {
          path: file.path,
          original: limited ? "" : before.toString("utf8"),
          modified: limited ? "" : after.toString("utf8"),
          ...(limited
            ? { limitation: "Binary or large file; complete contents will be applied" }
            : {}),
        };
        return response;
      }
      if (!lease) throw new Error("Review operation was not reserved");
      const signal = lease.abort.signal;
      await this.reads.cancel(undefined, undefined, ownerKey(request));
      signal.throwIfAborted();
      await this.target(review, lease, valid);
      if (action.type === "prepare") {
        const revision = review.revisions.at(-1);
        if (
          review.error ||
          revision?.id !== action.revisionId ||
          !revision.sources?.length ||
          !review.workers.every((worker) =>
            revision.sources?.some((source) => source.runId === worker.runId),
          )
        )
          throw new Error("Refresh the incomplete or changed review before applying");
        await this.sources(review, valid, signal);
        return view(await loop.prepare(review.id, revision.id, revision.sources, signal));
      }
      if (!("operationId" in action)) throw new Error("Unknown task operation");
      const proposal = await loop.proposal(review.id, action.operationId);
      if (action.type === "revise") {
        if (this.acceptedFeedback.size >= 4_096)
          throw new Error("Feedback receipt capacity reached");
        if (
          !this.live(review) ||
          proposal.status !== "prepared" ||
          !proposal.conflicts.length ||
          review.revisions.at(-1)?.id !== proposal.revisionId
        )
          throw new Error(
            "Refresh conflicts for the live originating task before requesting a revision",
          );
        const feedback = `Revise the isolated worker changes so they preserve the user's current target edits. Read current target files before revising; do not modify the target directly.\nTarget: ${JSON.stringify(origin(review).cwd)}\nConflicts:\n${proposal.conflicts.map((item) => `${JSON.stringify(item.path)}: ${item.reason}`).join("\n")}`;
        if (feedback.length > 8_000)
          throw new Error("Too many conflicts; send smaller feedback groups");
        await loop.requestRevision(review.id, proposal.id);
        await this.store.write(review.id, async (current) => {
          valid();
          signal.throwIfAborted();
          await current.requestRevision(review.id, proposal.revisionId, feedback);
          const updated = current.get(review.id);
          const batch = updated.submissions.at(-1);
          if (!batch) throw new Error("Missing revision feedback");
          await this.queueFeedback(current, updated, batch.id, () => {
            valid();
            signal.throwIfAborted();
          });
        });
        return view(proposal);
      }
      if (
        !(await this.hooks.confirm(
          action.type === "apply"
            ? "Apply reviewed changes?"
            : action.type === "undo"
              ? "Undo reviewed changes?"
              : "Recover interrupted changes?",
          `${origin(review).cwd}\n${proposal.changes.length} file changes. Newer edits are rechecked before writing.`,
        ))
      )
        return view(proposal);
      valid();
      signal.throwIfAborted();
      await this.target(review, lease, valid);
      if (action.type === "apply" && proposal.status !== "applied") {
        const current = this.checked(await this.load(request, valid), request);
        if (
          current.error ||
          current.revisions.at(-1)?.id !== proposal.revisionId ||
          !current.workers.every((worker) =>
            proposal.sources.some((source) => source.runId === worker.runId),
          )
        )
          throw new Error("Refresh the changed review and application preview");
        for (const target of await this.sources(current, valid, signal)) {
          const captured = await git.snapshot(target.worktree, undefined, signal);
          if (proposal.sources.find((source) => source.runId === target.runId)?.commit !== captured)
            throw new Error("Worker files changed. Refresh changes before applying.");
        }
      }
      if (
        action.type === "undo" &&
        (await loop.lastApplied(review.id))?.id !== proposal.id &&
        proposal.status !== "undone"
      )
        throw new Error("Undo the latest application first");
      await this.identity(review, valid);
      const result = await loop.execute(review.id, proposal.id, action.type, signal);
      this.hooks.changed();
      return view(result);
    } finally {
      if (lease) this.release(request.targetId, lease);
    }
  }
  async rendererGone(): Promise<void> {
    this.epoch++;
    this.cursors.clear();
    const active = [...this.operations.values()];
    for (const lease of active) lease.abort.abort(new Error("Relay review operations stopped"));
    await Promise.allSettled([this.reads.cancel(), ...active.map((lease) => lease.done)]);
  }
  async stop(): Promise<void> {
    await this.rendererGone();
    await this.store.settled();
    this.store.reset();
    this.acceptedFeedback.clear();
  }
  async stopFolder(cwd: string): Promise<void> {
    const canonical = await realpath(cwd).catch(() => cwd);
    const targets = new Set(
      this.execution
        .list()
        .filter((worker) => worker.target.cwd === canonical)
        .map((worker) => worker.target.id),
    );
    const operations = [...this.operations].filter(
      ([id, lease]) => targets.has(id) || lease.cwd === canonical,
    );
    for (const [, lease] of operations)
      lease.abort.abort(new Error("Folder review operations stopped"));
    await Promise.allSettled(operations.map(([, lease]) => lease.done));
  }
}
