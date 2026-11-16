import { createHash, randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { join, sep } from "node:path";
import { z } from "zod";
import { chatReferenceSchema, planSchema } from "../bridge/index.js";
import { type CoreDeps, TaskLoop, type TaskProposal } from "../core/index.js";
import { privateDirectory } from "../platform/index.js";
import { FolderCheckpoints } from "./folder-checkpoints.js";
import { readRelayState, storageCode, writeRelayState } from "./relay-storage.js";

const reference = z.strictObject({
  project: z.string().min(1).max(32_768),
  root: z.string().min(1).max(32_768),
  taskId: z.string().uuid(),
  operationId: z.string().uuid(),
  device: z.string().regex(/^\d+$/),
  inode: z.string().regex(/^\d+$/),
  bytes: z.number().int().nonnegative(),
  filesystem: z.boolean().optional(),
});
const directTarget = z.strictObject({
  project: z.string().min(1).max(32_768),
  device: z.string().regex(/^\d+$/),
  inode: z.string().regex(/^\d+$/),
  baseline: z.uuid(),
  bytes: z.number().int().nonnegative(),
  rawBytes: z.number().int().nonnegative().max(33_554_432),
  operationOffset: z.number().int().nonnegative(),
});
const checkpoint = z.strictObject({
  id: z.string().uuid(),
  runId: z.string().min(1).max(128),
  turn: z.number().int().nonnegative(),
  text: z.string().max(1_000_000),
  references: z.array(chatReferenceSchema).max(8).default([]),
  before: z.number().int().nonnegative(),
  taskCount: z.number().int().nonnegative(),
  eventRunId: z.string().max(128).optional(),
  eventStart: z.number().int().nonnegative().optional(),
  continuityKey: z.string().max(32_768).optional(),
  title: z.string().max(160).nullable().optional(),
  plans: z.array(planSchema).max(100).default([]),
  workers: z
    .array(
      z.strictObject({
        runId: z.string().max(128),
        turn: z.number().int().nonnegative(),
      }),
    )
    .max(1024)
    .default([]),
  phase: z.enum(["active", "undoing", "restored"]),
  operations: z.array(reference).max(4096),
  restores: z.array(reference).max(256),
  sources: z.array(z.string().uuid()).max(4096),
  direct: z.array(directTarget).max(256).default([]),
});
const schema = z.strictObject({
  format: z.literal(1),
  latest: checkpoint.nullable(),
  previous: z.array(checkpoint).max(100).default([]),
  rewound: z.boolean().default(false),
  rewindPending: z.boolean().default(false),
  recordedBytes: z.number().int().nonnegative().max(268_435_456).default(0),
  hidden: z.array(z.string().uuid()).max(32_768),
  ranges: z
    .array(
      z.strictObject({
        runId: z.string().max(128),
        from: z.number().int().nonnegative(),
        to: z.number().int().nonnegative(),
        eventRunId: z.string().max(128).optional(),
        eventFrom: z.number().int().nonnegative().optional(),
        eventTo: z.number().int().nonnegative().optional(),
      }),
    )
    .max(4096),
});
type State = z.infer<typeof schema>;
type TaskGit = NonNullable<CoreDeps["git"]["tasks"]>;
type Reference = z.infer<typeof reference>;
export type ChatCheckpoint = z.infer<typeof checkpoint>;
const covers = (parent: string, child: string) =>
  parent === child || child.startsWith(parent.endsWith(sep) ? parent : `${parent}${sep}`);

/** Private rollback evidence. Opening history never authorizes execution or restoration. */
export class ChatCheckpoints {
  private state: State = {
    format: 1,
    latest: null,
    previous: [],
    rewound: false,
    rewindPending: false,
    recordedBytes: 0,
    hidden: [],
    ranges: [],
  };
  private persisted: unknown;
  private writes: Promise<unknown> = Promise.resolve();
  private constructor(
    readonly root: string,
    private readonly git: TaskGit | undefined,
    private readonly excludedPaths: string[],
  ) {}
  static async open(
    root: string,
    git?: TaskGit,
    excludedPaths: string[] = [],
  ): Promise<ChatCheckpoints> {
    const store = new ChatCheckpoints(root, git, [root, ...excludedPaths]);
    await privateDirectory(root);
    try {
      store.persisted = await readRelayState(join(root, "state.json"), 4_194_304);
      store.state = schema.parse(store.persisted, {
        jitless: true,
      });
    } catch (error) {
      if (storageCode(error) !== "ENOENT") throw error;
    }
    return store;
  }
  get latest(): Readonly<ChatCheckpoint> | null {
    return this.state.latest;
  }
  get undoTarget(): Readonly<ChatCheckpoint> | null {
    return this.latest?.phase === "restored" && !this.state.rewindPending
      ? (this.state.previous.at(-1) ?? null)
      : this.latest;
  }
  get rewound(): boolean {
    return this.state.rewound;
  }
  get revision(): number {
    return this.state.ranges.length;
  }
  get pendingRewind(): boolean {
    return this.state.rewindPending;
  }
  complete(id: string): Promise<void> {
    return this.serial(async () => {
      if (this.latest?.id !== id || this.latest.phase !== "restored")
        throw new Error("The file restore has not finished");
      await this.save({ ...this.state, rewindPending: false });
    });
  }
  excluded(runId: string): readonly { from: number; to: number }[] {
    return this.state.ranges.filter((range) => range.runId === runId);
  }
  visibleEvent(runId: string, revision: number): boolean {
    return !this.state.ranges.some(
      (range) =>
        range.eventRunId === runId &&
        range.eventFrom !== undefined &&
        range.eventTo !== undefined &&
        revision >= range.eventFrom &&
        revision <= range.eventTo,
    );
  }
  continued(): Promise<void> {
    return this.serial(() => this.save({ ...this.state, rewound: false }));
  }
  get hidden(): ReadonlySet<string> {
    return new Set(this.state.hidden);
  }
  requestForSource(id: string): { chatId: string; turn: number } | undefined {
    const request = [this.latest, ...this.state.previous.toReversed()].find((request) =>
      request?.sources.includes(id),
    );
    return request
      ? { chatId: request.eventRunId ?? request.runId, turn: request.turn }
      : undefined;
  }
  visible(runId: string, index: number): boolean {
    return !this.state.ranges.some(
      (range) => range.runId === runId && index >= range.from && index < range.to,
    );
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.writes.then(work);
    this.writes = result.catch(() => {});
    return result;
  }
  settled(): Promise<void> {
    return this.writes.then(() => {});
  }
  private async save(next: State): Promise<void> {
    schema.parse(next, { jitless: true });
    const path = join(this.root, "state.json");
    await writeRelayState(path, next, this.persisted, 4_194_304);
    this.state = next;
    this.persisted = next;
  }
  begin(
    input: Pick<
      ChatCheckpoint,
      | "runId"
      | "turn"
      | "text"
      | "before"
      | "taskCount"
      | "eventRunId"
      | "eventStart"
      | "continuityKey"
      | "title"
    > &
      Partial<Pick<ChatCheckpoint, "plans" | "workers" | "references">> & {
        directProjects?: string[];
      },
  ): Promise<string> {
    return this.serial(() =>
      TaskLoop.coordinate(input.directProjects ?? [], async () => {
        if (this.latest?.phase === "undoing" || this.state.rewindPending)
          throw new Error("Finish the interrupted Undo first");
        if (this.state.previous.length >= 100)
          throw new Error("This chat reached its 100-checkpoint limit. Start a new chat.");
        const id = randomUUID();
        const { directProjects = [], ...savedInput } = input;
        const direct: ChatCheckpoint["direct"] = [];
        let recordedBytes = this.state.recordedBytes;
        for (const project of [...new Set(directProjects)].sort((a, b) => a.length - b.length)) {
          if (direct.some((entry) => covers(entry.project, project))) continue;
          const entry = await this.captureDirect(project, direct, 0, recordedBytes);
          direct.push(entry);
          recordedBytes += entry.bytes;
        }
        await this.save({
          ...this.state,
          recordedBytes,
          previous:
            this.latest?.phase === "active"
              ? [...this.state.previous, this.latest]
              : this.state.previous,
          latest: {
            ...savedInput,
            references: input.references ?? [],
            plans: input.plans ?? [],
            workers: input.workers ?? [],
            id,
            phase: "active",
            operations: [],
            restores: [],
            sources: [],
            direct,
          },
        });
        return id;
      }),
    );
  }
  private folders(): FolderCheckpoints {
    return new FolderCheckpoints(
      join(this.root, "folders"),
      TaskLoop.folderGit(this.root, this.git?.merge.bind(this.git)),
      this.excludedPaths,
    );
  }
  private async captureDirect(
    project: string,
    targets: ChatCheckpoint["direct"],
    operationOffset: number,
    recordedBytes: number,
  ): Promise<ChatCheckpoint["direct"][number]> {
    if (targets.some((entry) => covers(project, entry.project)))
      throw new Error(
        "Cannot enlarge direct checkpoint coverage after execution. Send a new request first.",
      );
    const identity = await this.pin(project);
    const available = 268_435_456 - recordedBytes - 134_217_728;
    if (available <= 0) throw new Error("Direct checkpoint storage limit reached");
    const saved = await this.folders().capture(
      project,
      available,
      33_554_432 - targets.reduce((sum, entry) => sum + entry.rawBytes, 0),
      (bytes) => this.save({ ...this.state, recordedBytes: this.state.recordedBytes + bytes }),
    );
    if (JSON.stringify(identity) !== JSON.stringify(await this.pin(project)))
      throw new Error("The checkpoint target was replaced");
    return { project, ...identity, ...saved, operationOffset };
  }
  coverDirect(project: string, valid: () => void): Promise<void> {
    return this.serial(() =>
      TaskLoop.coordinate([project], async () => {
        valid();
        const current = this.latest;
        if (current?.phase !== "active") throw new Error("Start a request before direct execution");
        const existing = current.direct.find((entry) => covers(entry.project, project));
        if (existing) {
          await this.validate(existing);
          valid();
          return;
        }
        const entry = await this.captureDirect(
          project,
          current.direct,
          current.operations.length,
          this.state.recordedBytes,
        );
        valid();
        await this.save({
          ...this.state,
          latest: { ...current, direct: [...current.direct, entry] },
        });
      }),
    );
  }
  source(id: string, expected = this.latest?.id): Promise<void> {
    return this.serial(async () => {
      const current = this.latest;
      if (current?.id !== expected) throw new Error("The request checkpoint changed");
      if (current?.phase !== "active" || this.requestForSource(id)) return;
      await this.save({ ...this.state, latest: { ...current, sources: [...current.sources, id] } });
    });
  }
  /** Bind live captures at serialized integration time; explicit expected IDs reject stale callers. */
  integrate(
    loop: TaskLoop,
    prepare:
      | TaskProposal
      | ((
          availableBytes: number,
          reserve: (bytes: number) => Promise<void>,
        ) => Promise<TaskProposal>),
    valid: () => void,
    expected?: string,
  ): Promise<void> {
    return this.serial(() =>
      TaskLoop.coordinate([loop.project], async () => {
        valid();
        const current = this.latest;
        if (
          !current ||
          (expected !== undefined && current.id !== expected) ||
          current.phase !== "active"
        )
          throw new Error("The request checkpoint is no longer writable");
        const availableBytes = Math.floor(
          (268_435_456 - this.state.recordedBytes - (current.direct.length ? 134_217_728 : 0)) / 2,
        );
        if (availableBytes <= 0) throw new Error("Checkpoint storage reached its 256 MiB limit");
        let reserved = false;
        const reserve = async (bytes: number) => {
          if (
            this.state.recordedBytes + 2 * bytes + (current.direct.length ? 134_217_728 : 0) >
            268_435_456
          )
            throw new Error("Checkpoint storage reached its 256 MiB limit");
          await this.reserve(bytes);
          reserved = true;
        };
        const proposal =
          typeof prepare === "function" ? await prepare(availableBytes, reserve) : prepare;
        if (!reserved) await reserve(Buffer.byteLength(JSON.stringify(proposal)) + 1024);
        valid();
        const sourced = {
          ...current,
          sources: this.requestForSource(proposal.revisionId)
            ? current.sources
            : [...current.sources, proposal.revisionId],
        };
        if (!current.sources.includes(proposal.revisionId))
          await this.save({ ...this.state, latest: sourced });
        if (proposal.conflicts.length)
          throw new Error("Worker changes conflict with current files");
        if (!proposal.changes.length) return;
        const entry = {
          project: loop.project,
          root: loop.root,
          taskId: proposal.taskId,
          operationId: proposal.id,
          ...(await this.pin(loop.project)),
          bytes: Buffer.byteLength(JSON.stringify(proposal)),
        };
        await this.save({
          ...this.state,
          latest: {
            ...sourced,
            operations: [...current.operations, entry],
          },
        });
        valid();
        await loop.execute(proposal.taskId, proposal.id, "apply");
        valid();
      }),
    );
  }
  private loop(entry: Reference): TaskLoop {
    return entry.filesystem
      ? this.folders().loop(entry.project, entry.root)
      : new TaskLoop(entry.project, entry.root, this.requireGit());
  }
  private requireGit(): TaskGit {
    if (!this.git) throw new Error("File checkpoint coverage is unavailable");
    return this.git;
  }
  private async reserve(bytes: number): Promise<void> {
    if (bytes < 0 || !Number.isSafeInteger(bytes) || this.state.recordedBytes + bytes > 268_435_456)
      throw new Error("Checkpoint storage reached its 256 MiB limit");
    await this.save({ ...this.state, recordedBytes: this.state.recordedBytes + bytes });
  }
  private async pin(project: string): Promise<{ device: string; inode: string }> {
    const canonical = await realpath(project);
    const info = await stat(canonical, { bigint: true });
    if (canonical !== project || !info.isDirectory())
      throw new Error("The checkpoint target moved");
    return { device: info.dev.toString(), inode: info.ino.toString() };
  }
  private async validate(entry: { project: string; device: string; inode: string }): Promise<void> {
    const current = await this.pin(entry.project);
    if (current.device !== entry.device || current.inode !== entry.inode)
      throw new Error("The checkpoint target was replaced");
  }
  /** The caller first confirms, stops all owned writers and invalidates their authority. */
  restore(id: string, end: number, eventEnd?: number): Promise<ChatCheckpoint> {
    return this.serial(() =>
      TaskLoop.coordinate(
        [
          ...(this.undoTarget?.operations ?? []),
          ...(this.undoTarget?.restores ?? []),
          ...(this.undoTarget?.direct ?? []),
        ].map((entry) => entry.project),
        async () => {
          let current = this.latest;
          if (current?.phase === "restored" && this.state.previous.at(-1)?.id === id) {
            current = this.state.previous.at(-1) ?? null;
            await this.save({
              ...this.state,
              latest: current,
              previous: this.state.previous.slice(0, -1),
            });
          }
          if (!current || current.id !== id)
            throw new Error("This request is no longer the latest");
          if (current.phase === "restored") return current;
          if (!current.restores.length) {
            const groups = new Map<
              string,
              (Pick<TaskProposal, "changes"> & { wholeFolder?: boolean })[]
            >();
            for (const [index, entry] of current.operations.entries()) {
              const direct = current.direct.find((target) => target.project === entry.project);
              await this.validate(entry);
              const loop = this.loop(entry);
              const proposal = await loop.proposal(entry.taskId, entry.operationId);
              if (["applying", "undoing", "recovery"].includes(proposal.status)) {
                throw new Error("Recover the interrupted file operation in Changes before Undo");
              }
              if (direct && index >= direct.operationOffset) continue;
              if (proposal.status !== "applied") continue;
              const group = groups.get(entry.project) ?? [];
              group.push(proposal);
              groups.set(entry.project, group);
            }
            let directBytes = 0;
            for (const target of current.direct) {
              await this.validate(target);
              const { changes, rawBytes } = await this.folders().changes(
                target.project,
                target.baseline,
                33_554_432 - directBytes,
              );
              directBytes += rawBytes;
              const group = groups.get(target.project) ?? [];
              group.push({ changes, wholeFolder: true });
              groups.set(target.project, group);
            }
            const restores: Reference[] = [];
            for (const [project, operations] of groups) {
              const root = join(this.root, createHash("sha256").update(project).digest("hex"));
              const filesystem = current.direct.some((target) => target.project === project);
              const loop = filesystem
                ? this.folders().loop(project, root)
                : new TaskLoop(project, root, this.requireGit());
              const proposal = await loop.prepareRewind(
                id,
                operations,
                268_435_456 - this.state.recordedBytes,
                (bytes) => this.reserve(bytes),
              );
              if (proposal.conflicts.length)
                throw new Error(
                  `Undo blocked by newer edits: ${proposal.conflicts.map((c) => c.path).join(", ")}`,
                );
              if (proposal.changes.length) {
                const entry = {
                  project,
                  root,
                  taskId: id,
                  operationId: proposal.id,
                  ...(await this.pin(project)),
                  bytes: Buffer.byteLength(JSON.stringify(proposal)),
                  ...(filesystem ? { filesystem: true } : {}),
                };
                restores.push(entry);
              }
            }
            current = { ...current, phase: "undoing", restores };
            await this.save({ ...this.state, latest: current });
          }
          // Recovery itself can write files, so preflight the other targets first.
          for (const entry of current.restores) {
            await this.validate(entry);
            const loop = this.loop(entry);
            const proposal = await loop.proposal(entry.taskId, entry.operationId);
            if (proposal.status === "prepared") await loop.verifyPrepared(proposal);
            if (["applying", "undoing", "recovery"].includes(proposal.status))
              await loop.verifyRecovery(proposal);
          }
          for (const [index, entry] of current.restores.entries()) {
            await this.validate(entry);
            const loop = this.loop(entry);
            let proposal = await loop.proposal(entry.taskId, entry.operationId);
            if (["applying", "undoing", "recovery"].includes(proposal.status)) {
              await loop.execute(entry.taskId, entry.operationId, "recover");
              proposal = await loop.proposal(entry.taskId, entry.operationId);
            }
            if (proposal.status === "failed") {
              const replacement = await loop.prepareRewind(
                id,
                [
                  {
                    changes: proposal.changes.map((change) => ({
                      ...change,
                      before: change.after,
                      after: change.before,
                    })),
                  },
                ],
                268_435_456 - this.state.recordedBytes,
                (bytes) => this.reserve(bytes),
              );
              if (replacement.conflicts.length)
                throw new Error("Newer edits prevent resuming Undo");
              const bytes = Buffer.byteLength(JSON.stringify(replacement));
              current = {
                ...current,
                restores: current.restores.map((value, at) =>
                  at === index ? { ...entry, operationId: replacement.id, bytes } : value,
                ),
              };
              await this.save({
                ...this.state,
                latest: current,
              });
            }
          }
          // Check every target before changing any of them. Each execution rechecks under its lock.
          for (const entry of current.restores) {
            const loop = this.loop(entry);
            const proposal = await loop.proposal(entry.taskId, entry.operationId);
            if (proposal.status === "prepared") await loop.verifyPrepared(proposal);
            else if (proposal.status !== "applied" && proposal.status !== "recovery")
              throw new Error("Undo needs recovery before it can continue");
          }
          for (const entry of current.restores) {
            const loop = this.loop(entry);
            let proposal = await loop.proposal(entry.taskId, entry.operationId);
            if (["applying", "recovery"].includes(proposal.status)) {
              await loop.execute(entry.taskId, entry.operationId, "recover");
              proposal = await loop.proposal(entry.taskId, entry.operationId);
            }
            if (proposal.status !== "applied")
              await loop.execute(entry.taskId, entry.operationId, "apply");
          }
          const restored = { ...current, phase: "restored" as const };
          await this.save({
            ...this.state,
            latest: restored,
            rewound: true,
            rewindPending: true,
            hidden: [...new Set([...this.state.hidden, ...current.sources])],
            ranges: [
              ...this.state.ranges,
              {
                runId: current.runId,
                from: current.before,
                to: end,
                ...(current.eventRunId === undefined
                  ? {}
                  : {
                      eventRunId: current.eventRunId,
                      eventFrom: current.eventStart,
                      eventTo: eventEnd,
                    }),
              },
            ],
          });
          return restored;
        },
      ),
    );
  }
}
