import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import {
  MCP_TEXT_LIMITS,
  type McpConnectorDocument,
  type McpTextIssue,
  validateMcpConnectorText,
} from "../bridge/index.js";
import {
  bindGuardedTarget,
  captureGuardedRoot,
  discardGuardedStage,
  GuardedFileError,
  type GuardedFileIo,
  type GuardedSnapshot,
  type GuardedTarget,
  guardedFileRevision,
  lockPrivateState,
  publishGuardedFile,
  readGuardedFile,
  readPrivateJson,
  stageGuardedFile,
  syncGuardedDirectory,
  verifyPrivatePath,
  writePrivateJson,
} from "../platform/index.js";

const JOURNAL_LIMIT = 8 * 1024 * 1024;
const BACKUP_LIMIT = 2 * 1024 * 1024;
const TOTAL_LIMIT = 100 * 1024 * 1024;
const id = z.string().uuid();
const hash = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const digits = z.string().regex(/^\d+$/);
const native = z.strictObject({
  device: digits,
  inode: digits,
  size: digits,
  mtime: z.string().regex(/^-?\d+$/),
  ctime: z.string().regex(/^-?\d+$/),
  mode: z.number().int().min(0).max(0o777),
});
const rootSchema = z.strictObject({ path: z.string(), device: digits, inode: digits });
const guardSchema = z.strictObject({
  root: rootSchema,
  relative: z.string(),
  private: z.boolean(),
  mode: z.number().int().min(0).max(0o777),
});
const imageSchema = z.strictObject({
  data: z.string().max(1_398_104).nullable(),
  mode: z.number().int().min(0).max(0o777),
  revision: z.string(),
  identity: native.nullable(),
});
const stageSchema = z.strictObject({
  name: z.string().regex(/^\.code60-mcp-[a-f0-9-]{36}\.tmp$/),
  identity: native,
  digest: z.string().regex(/^[a-f0-9]{64}$/),
});
const resultSchema = z.strictObject({
  status: z.enum([
    "saved",
    "moved",
    "restored",
    "reset",
    "unchanged",
    "completed",
    "rolled-back",
    "recovery-required",
  ]),
  transactionId: id,
  revisions: z.record(z.string(), z.string()),
});
const changeSchema = z.strictObject({
  targetId: z.string(),
  write: z.boolean().default(true),
  guard: guardSchema,
  projectRoot: rootSchema.optional(),
  before: imageSchema,
  after: imageSchema,
  stages: z.strictObject({ before: stageSchema.optional(), after: stageSchema.optional() }),
});
const journalSchema = z.strictObject({
  version: z.literal(1),
  id,
  fingerprint: z.string(),
  kind: z.enum(["saved", "moved", "restored", "reset"]),
  createdAt: z.number(),
  changes: z.array(changeSchema).min(1).max(2),
  recovery: z
    .strictObject({ id, fingerprint: z.string(), action: z.enum(["complete", "rollback"]) })
    .optional(),
});
const backupSchema = z.strictObject({
  version: z.literal(1),
  id: z.string().regex(/^[a-f0-9-]{36}-[01]$/),
  transactionId: id,
  targetId: z.string(),
  createdAt: z.number(),
  image: imageSchema,
  digest: z.string(),
  valid: z.boolean(),
});
const receiptSchema = z.strictObject({
  version: z.literal(1),
  id,
  fingerprint: z.string(),
  result: resultSchema,
});
type Journal = z.infer<typeof journalSchema>;
type Image = z.infer<typeof imageSchema>;
type Change = z.infer<typeof changeSchema>;
type Backup = z.infer<typeof backupSchema>;
type Receipt = z.infer<typeof receiptSchema>;
type Result = z.infer<typeof resultSchema>;
interface Target {
  id: string;
  guard: GuardedTarget;
  projectRoot?: z.infer<typeof rootSchema>;
}
interface StoreOptions {
  stateRoot: string;
  userDirectory: string;
  projects?: readonly { projectId: string; root: string }[];
  io?: GuardedFileIo;
  /** Inject filesystem boundary failures without global monkeypatches or production diagnostics. */
  checkpoint?: (step: "journal" | "backup" | "receipt", operationId: string) => Promise<void>;
  now?: () => number;
  /** May lower the production ceiling for an isolated environment; never raises it. */
  budgetBytes?: number;
}
interface Snapshot {
  targetId: string;
  exists: boolean;
  revision: string;
  text: string | null;
  document?: McpConnectorDocument;
  issues: McpTextIssue[];
  pendingRecovery: string[];
}
export class McpStorageError extends Error {
  constructor(
    readonly code:
      | "invalid"
      | "conflict"
      | "unsafe"
      | "storage-limit"
      | "recovery-required"
      | "unavailable"
      | "cancelled"
      | "closed",
    readonly issues: readonly McpTextIssue[] = [],
  ) {
    super(`MCP configuration ${code}`);
  }
}
const image = (snapshot: GuardedSnapshot): Image => ({
  data: snapshot.data === null ? null : Buffer.from(snapshot.data).toString("base64"),
  revision: snapshot.revision,
  identity: snapshot.identity,
  mode: snapshot.mode,
});
const bytes = (value: Image) => (value.data === null ? null : Buffer.from(value.data, "base64"));
const canonical = (document: McpConnectorDocument) => `${JSON.stringify(document, null, 2)}\n`;

/** Backend library only: no production loader, browser routes or connector authority. */
export class McpConfigurationStore {
  private queue: Promise<unknown> = Promise.resolve();
  private closing: Promise<void> | undefined;
  private constructor(
    private readonly options: StoreOptions,
    private readonly targets: Map<string, Target>,
    private readonly stateIdentity: z.infer<typeof rootSchema>,
    private readonly release: () => Promise<void>,
  ) {}

  static async open(options: StoreOptions): Promise<McpConfigurationStore> {
    if (
      options.budgetBytes !== undefined &&
      (!Number.isSafeInteger(options.budgetBytes) ||
        options.budgetBytes <= 0 ||
        options.budgetBytes > TOTAL_LIMIT)
    )
      throw new McpStorageError("invalid");
    options = {
      ...options,
      ...(options.projects
        ? { projects: options.projects.map((project) => ({ ...project })) }
        : {}),
    };
    let release: () => Promise<void>;
    try {
      release = await lockPrivateState(options.stateRoot);
    } catch {
      throw new McpStorageError("unavailable");
    }
    try {
      const targets = new Map<string, Target>();
      const user = await bindGuardedTarget(options.userDirectory, true, options.io);
      const userId = hash(`user:${resolve(options.userDirectory)}`);
      targets.set(userId, { id: userId, guard: user });
      for (const project of options.projects ?? []) {
        const projectRoot = await captureGuardedRoot(project.root, options.io);
        const targetId = hash(`project:${project.projectId}:${JSON.stringify(projectRoot)}`);
        targets.set(targetId, {
          id: targetId,
          guard: await bindGuardedTarget(join(projectRoot.path, ".code60"), false, options.io),
          projectRoot,
        });
      }
      const store = new McpConfigurationStore(
        options,
        targets,
        await captureGuardedRoot(options.stateRoot),
        release,
      );
      await store.records(); // Inspection only; never replay pending effects on open.
      return store;
    } catch {
      try {
        await release();
      } catch {
        throw new McpStorageError("unsafe");
      }
      throw new McpStorageError("unsafe");
    }
  }

  /** Trusted backend registration only; canonical identity survives runtime replacement. */
  registerProject(root: string, expectedTargetId?: string): Promise<string> {
    return this.run(async () => {
      const projectRoot = await captureGuardedRoot(root, this.options.io);
      const targetId = hash(`project:${JSON.stringify(projectRoot)}`);
      if (expectedTargetId && expectedTargetId !== targetId) throw new McpStorageError("conflict");
      if (!this.targets.has(targetId)) {
        this.targets.set(targetId, {
          id: targetId,
          projectRoot,
          guard: await bindGuardedTarget(join(projectRoot.path, ".code60"), false, this.options.io),
        });
      }
      return targetId;
    });
  }
  targetIds() {
    return [...this.targets].map(([targetId, target]) => ({
      targetId,
      scope: target.projectRoot ? ("project" as const) : ("user" as const),
    }));
  }
  private run<T>(action: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new McpStorageError("closed"));
    const result = this.queue.then(action).catch((error) => {
      if (error instanceof McpStorageError) throw error;
      throw new McpStorageError("unavailable");
    });
    this.queue = result.catch(() => {});
    return result;
  }
  private target(targetId: string): Target {
    const target = this.targets.get(targetId);
    if (!target) throw new McpStorageError("unavailable");
    return target;
  }
  private async checkState() {
    const current = await captureGuardedRoot(this.options.stateRoot);
    if (JSON.stringify(current) !== JSON.stringify(this.stateIdentity))
      throw new McpStorageError("unsafe");
    await verifyPrivatePath(this.options.stateRoot, true);
  }
  private path(name: string) {
    return join(this.options.stateRoot, name);
  }
  private async records() {
    await this.checkState();
    const journals: Journal[] = [];
    const backups: Backup[] = [];
    const receipts: Receipt[] = [];
    let total = 0;
    const entries = await fs.opendir(this.options.stateRoot);
    let count = 0;
    for await (const entry of entries) {
      if (entry.name === ".writer") continue;
      if (++count > 100_000) throw new McpStorageError("storage-limit");
      const match = /^([a-f0-9-]{36}(?:-[01])?)\.(journal|backup|receipt)$/.exec(entry.name);
      if (!match || !entry.isFile()) throw new McpStorageError("unsafe");
      const info = await verifyPrivatePath(this.path(entry.name), false);
      total += Number(info.size);
      const kind = match[2];
      const raw = await readPrivateJson(
        this.path(entry.name),
        kind === "journal" ? JOURNAL_LIMIT : kind === "backup" ? BACKUP_LIMIT : 16_384,
      );
      if (kind === "journal") {
        const journal = journalSchema.parse(raw);
        for (const change of journal.changes) {
          if (
            !change.write &&
            (JSON.stringify(change.before) !== JSON.stringify(change.after) ||
              Object.keys(change.stages).length)
          )
            throw new McpStorageError("unsafe");
          for (const side of ["before", "after"] as const) {
            const value = change[side];
            const data = bytes(value);
            if (
              (side === "before" && value.revision === "unpublished") ||
              (value.mode & 0o022) !== 0 ||
              (change.guard.private && (value.mode & 0o077) !== 0)
            )
              throw new McpStorageError("unsafe");
            if (
              (data !== null &&
                (data.length > MCP_TEXT_LIMITS.bytes || data.toString("base64") !== value.data)) ||
              (value.identity && (data === null || value.identity.size !== String(data.length))) ||
              (change.stages[side] && hash(data ?? "missing") !== change.stages[side]?.digest)
            )
              throw new McpStorageError("unsafe");
            if (
              value.revision !== "unpublished" &&
              guardedFileRevision(change.guard, { data, identity: value.identity }) !==
                value.revision
            )
              throw new McpStorageError("unsafe");
          }
        }
        journals.push(journal);
      } else if (kind === "backup") {
        const backup = backupSchema.parse(raw);
        if (
          backup.id !== match[1] ||
          !backup.id.startsWith(`${backup.transactionId}-`) ||
          hash(bytes(backup.image) ?? "missing") !== backup.digest ||
          (backup.image.data !== null &&
            bytes(backup.image)?.toString("base64") !== backup.image.data)
        )
          throw new McpStorageError("unsafe");
        const data = bytes(backup.image);
        if (data !== null && data.length > MCP_TEXT_LIMITS.bytes)
          throw new McpStorageError("unsafe");
        if (
          backup.valid !==
          (data === null ||
            this.inspect({ data, identity: null, revision: "", mode: backup.image.mode })
              .document !== undefined)
        )
          throw new McpStorageError("unsafe");
        backups.push(backup);
      } else receipts.push(receiptSchema.parse(raw));
      const last =
        kind === "journal" ? journals.at(-1) : kind === "receipt" ? receipts.at(-1) : undefined;
      if (last && last.id !== match[1]) throw new McpStorageError("unsafe");
      if (total > this.budget()) throw new McpStorageError("storage-limit");
    }
    await this.checkState();
    return { journals, backups, receipts, total };
  }
  private async writeRecord(
    name: string,
    value: unknown,
    limit: number,
    step: "journal" | "backup" | "receipt",
    operationId: string,
  ) {
    await this.checkState();
    await this.options.checkpoint?.(step, operationId);
    let previous: unknown;
    try {
      previous = await readPrivateJson(this.path(name), limit);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await writePrivateJson(this.path(name), value, previous, limit);
    await this.checkState();
  }
  private async raw(target: Target): Promise<GuardedSnapshot> {
    if (
      target.projectRoot &&
      JSON.stringify(await captureGuardedRoot(target.projectRoot.path, this.options.io)) !==
        JSON.stringify(target.projectRoot)
    )
      throw new McpStorageError("conflict");
    try {
      return await readGuardedFile(target.guard, MCP_TEXT_LIMITS.bytes, this.options.io);
    } catch (error) {
      throw new McpStorageError(
        error instanceof GuardedFileError && error.code === "changed"
          ? "conflict"
          : error instanceof GuardedFileError && error.code === "too-large"
            ? "storage-limit"
            : "unsafe",
      );
    }
  }
  private inspect(snapshot: GuardedSnapshot): {
    text: string | null;
    document?: McpConnectorDocument;
    issues: McpTextIssue[];
  } {
    if (snapshot.data === null)
      return { text: null, document: { version: 1 as const, servers: {} }, issues: [] };
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(snapshot.data);
    } catch {
      return {
        text: null,
        issues: [
          {
            code: "encoding" as const,
            message: "Configuration must use valid UTF-8.",
            path: [],
            line: 1,
            column: 1,
            endLine: 1,
            endColumn: 2,
          },
        ],
      };
    }
    const parsed = validateMcpConnectorText(text);
    return parsed.valid
      ? { text, document: parsed.document, issues: [] }
      : { text, issues: parsed.issues };
  }
  read(targetId: string): Promise<Snapshot> {
    return this.run(async () => {
      const snapshot = await this.raw(this.target(targetId));
      const pending = (await this.records()).journals.filter((journal) =>
        journal.changes.some((change) => change.targetId === targetId),
      );
      return {
        targetId,
        exists: snapshot.data !== null,
        revision: snapshot.revision,
        ...this.inspect(snapshot),
        pendingRecovery: pending.map((journal) => journal.id),
      };
    });
  }
  private validate(text: string) {
    const parsed = validateMcpConnectorText(text);
    if (!parsed.valid) throw new McpStorageError("invalid", parsed.issues);
    return parsed.document;
  }
  private async expected(targetId: string, revision: string) {
    if (
      (await this.records()).journals.some((journal) =>
        journal.changes.some((change) => change.targetId === targetId),
      )
    )
      throw new McpStorageError("recovery-required");
    const target = this.target(targetId);
    const current = await this.raw(target);
    if (current.revision !== revision) throw new McpStorageError("conflict");
    if (current.identity && (current.mode & 0o200) === 0) throw new McpStorageError("unsafe");
    return { target, current };
  }
  private async replay(requestId: string, fingerprint: string): Promise<Result | undefined> {
    if (!id.safeParse(requestId).success) throw new McpStorageError("invalid");
    const records = await this.records();
    const receipt = records.receipts.find((entry) => entry.id === requestId);
    const journal = records.journals.find(
      (entry) => entry.id === requestId || entry.recovery?.id === requestId,
    );
    const originalFingerprint =
      receipt?.fingerprint ??
      (journal?.id === requestId ? journal.fingerprint : journal?.recovery?.fingerprint);
    if (originalFingerprint && originalFingerprint !== fingerprint)
      throw new McpStorageError("conflict");
    if (journal) return { status: "recovery-required", transactionId: journal.id, revisions: {} };
    if (receipt) return receipt.result;
  }
  private async receipt(requestId: string, fingerprint: string, result: Result) {
    await this.writeRecord(
      `${requestId}.receipt`,
      { version: 1, id: requestId, fingerprint, result },
      16_384,
      "receipt",
      requestId,
    );
  }
  private async reserve(extra: number, affected: readonly string[] = []) {
    const records = await this.records();
    const pinned = new Set(records.journals.map((journal) => journal.id));
    const sorted = records.backups.sort(
      (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
    );
    const counts = new Map<string, number>();
    for (const backup of sorted)
      counts.set(backup.targetId, (counts.get(backup.targetId) ?? 0) + 1);
    let total = records.total;
    for (const backup of sorted) {
      if (pinned.has(backup.transactionId)) continue;
      // Only an operation with a matching durable receipt proves completion.
      if (!records.receipts.some((receipt) => receipt.id === backup.transactionId)) continue;
      const limit = affected.includes(backup.targetId) ? 19 : 20;
      if ((counts.get(backup.targetId) ?? 0) <= limit && total + extra <= this.budget()) continue;
      const path = this.path(`${backup.id}.backup`);
      const latest = backupSchema.parse(await readPrivateJson(path, BACKUP_LIMIT));
      if (JSON.stringify(latest) !== JSON.stringify(backup)) throw new McpStorageError("unsafe");
      await this.checkState();
      const info = await verifyPrivatePath(path, false);
      await fs.unlink(path);
      total -= Number(info.size);
      counts.set(backup.targetId, (counts.get(backup.targetId) ?? 1) - 1);
    }
    if (total + extra > this.budget()) throw new McpStorageError("storage-limit");
  }
  private budget() {
    return Math.min(this.options.budgetBytes ?? TOTAL_LIMIT, TOTAL_LIMIT);
  }
  private async ensureBackups(journal: Journal) {
    const records = await this.records();
    for (const [index, change] of journal.changes.entries()) {
      if (!change.write) continue;
      const backupId = `${journal.id}-${index}`;
      const existing = records.backups.find((backup) => backup.id === backupId);
      if (existing) {
        if (
          existing.image.data !== change.before.data ||
          existing.image.mode !== change.before.mode
        )
          throw new McpStorageError("unsafe");
        continue;
      }
      const data = bytes(change.before);
      const valid =
        data === null ||
        this.inspect({ data, identity: null, mode: change.before.mode, revision: "" }).document !==
          undefined;
      const backup: Backup = {
        version: 1,
        id: backupId,
        transactionId: journal.id,
        targetId: change.targetId,
        createdAt: journal.createdAt,
        image: change.before,
        digest: hash(data ?? "missing"),
        valid,
      };
      await this.writeRecord(`${backupId}.backup`, backup, BACKUP_LIMIT, "backup", journal.id);
    }
  }
  private bound(change: Change): Target {
    const target = this.target(change.targetId);
    if (
      resolve(target.guard.root.path, target.guard.relative) !==
        resolve(change.guard.root.path, change.guard.relative) ||
      target.guard.private !== change.guard.private ||
      JSON.stringify(target.projectRoot) !== JSON.stringify(change.projectRoot)
    )
      throw new McpStorageError("conflict");
    return { ...target, guard: change.guard };
  }
  private matches(snapshot: GuardedSnapshot, expected: Image, stage: Change["stages"]["before"]) {
    if (snapshot.revision === expected.revision) return true;
    if (!stage || !snapshot.identity || snapshot.data === null || expected.data === null)
      return false;
    // Once a published identity was checkpointed, changed timestamps are newer edits.
    if (
      expected.identity?.device === stage.identity.device &&
      expected.identity.inode === stage.identity.inode
    )
      return false;
    return (
      snapshot.identity.device === stage.identity.device &&
      snapshot.identity.inode === stage.identity.inode &&
      snapshot.identity.mtime === stage.identity.mtime &&
      snapshot.mode === expected.mode &&
      hash(snapshot.data) === hash(bytes(expected) as Uint8Array)
    );
  }
  private async checkRecovery(journal: Journal) {
    for (const change of journal.changes) {
      const current = await this.raw(this.bound(change));
      if (
        !this.matches(current, change.before, change.stages.before) &&
        !this.matches(current, change.after, change.stages.after)
      )
        throw new McpStorageError("conflict");
    }
  }
  private async execute(
    journal: Journal,
    direction: "complete" | "rollback",
    signal?: AbortSignal,
  ): Promise<Result> {
    try {
      await this.checkRecovery(journal);
      await this.ensureBackups(journal);
      const selected = direction === "complete" ? "after" : "before";
      const changes = direction === "complete" ? journal.changes : [...journal.changes].reverse();
      for (const change of changes) {
        signal?.throwIfAborted();
        const target = this.bound(change);
        const current = await this.raw(target);
        const desired = change[selected];
        if (this.matches(current, desired, change.stages[selected])) continue;
        await this.checkRecovery(journal);
        const data = bytes(desired);
        if (data !== null) {
          const previousStage = change.stages[selected];
          if (previousStage)
            await discardGuardedStage(target.guard, previousStage, this.options.io);
          const stage = await stageGuardedFile(target.guard, data, desired.mode, this.options.io);
          change.stages[selected] = stage;
          try {
            await this.writeRecord(
              `${journal.id}.journal`,
              journal,
              JOURNAL_LIMIT,
              "journal",
              journal.id,
            );
          } catch (error) {
            await discardGuardedStage(target.guard, stage, this.options.io);
            throw error;
          }
        }
        await this.checkRecovery(journal);
        const updated = await publishGuardedFile(
          target.guard,
          current.revision,
          data === null ? null : (change.stages[selected] ?? null),
          MCP_TEXT_LIMITS.bytes,
          this.options.io,
          signal,
        );
        change[selected] = image(updated);
        await this.writeRecord(
          `${journal.id}.journal`,
          journal,
          JOURNAL_LIMIT,
          "journal",
          journal.id,
        );
      }
      const revisions: Record<string, string> = {};
      for (const change of journal.changes) {
        const target = this.bound(change);
        if (change.write) await syncGuardedDirectory(target.guard, this.options.io);
        const current = await this.raw(target);
        if (!this.matches(current, change[selected], change.stages[selected]))
          throw new McpStorageError("conflict");
        revisions[change.targetId] = current.revision;
      }
      const result: Result = {
        status: journal.recovery
          ? direction === "complete"
            ? "completed"
            : "rolled-back"
          : journal.kind,
        transactionId: journal.id,
        revisions,
      };
      await this.receipt(journal.id, journal.fingerprint, result);
      if (journal.recovery)
        await this.receipt(journal.recovery.id, journal.recovery.fingerprint, result);
      for (const change of journal.changes)
        for (const stage of Object.values(change.stages))
          if (stage) await discardGuardedStage(change.guard, stage, this.options.io);
      await fs.unlink(this.path(`${journal.id}.journal`));
      return result;
    } catch {
      return { status: "recovery-required", transactionId: journal.id, revisions: {} };
    }
  }
  private async begin(
    requestId: string,
    fingerprint: string,
    kind: Journal["kind"],
    values: {
      target: Target;
      current: GuardedSnapshot;
      text: string | null;
      mode?: number;
      write?: boolean;
    }[],
    signal?: AbortSignal,
  ) {
    if (signal?.aborted) throw new McpStorageError("cancelled");
    const pending = (await this.records()).journals;
    if (
      pending.some((journal) =>
        journal.changes.some((change) =>
          values.some((value) => value.target.id === change.targetId),
        ),
      )
    )
      throw new McpStorageError("recovery-required");
    const changes: Change[] = values.map(({ target, current, text, mode, write = true }) => ({
      targetId: target.id,
      write,
      guard: target.guard,
      ...(target.projectRoot ? { projectRoot: target.projectRoot } : {}),
      before: image(current),
      after: !write
        ? image(current)
        : {
            data: text === null ? null : Buffer.from(text).toString("base64"),
            mode: mode ?? current.mode,
            revision: "unpublished",
            identity: null,
          },
      stages: {},
    }));
    const journal: Journal = {
      version: 1,
      id: requestId,
      fingerprint,
      kind,
      createdAt: (this.options.now ?? Date.now)(),
      changes,
    };
    const size = Buffer.byteLength(JSON.stringify(journal));
    if (size > JOURNAL_LIMIT) throw new McpStorageError("storage-limit");
    await this.reserve(
      size * 3 + 32_768,
      changes.filter((change) => change.write).map((change) => change.targetId),
    );
    // Recheck every target after queue/quota work and before durable preparation.
    for (const value of values)
      if ((await this.raw(value.target)).revision !== value.current.revision)
        throw new McpStorageError("conflict");
    if (signal?.aborted) throw new McpStorageError("cancelled");
    try {
      await this.writeRecord(`${requestId}.journal`, journal, JOURNAL_LIMIT, "journal", requestId);
    } catch {
      // A metadata rename can also succeed before its directory sync fails.
      const persisted = await readPrivateJson(
        this.path(`${requestId}.journal`),
        JOURNAL_LIMIT,
      ).catch(() => undefined);
      const known = journalSchema.safeParse(persisted);
      if (known.success && known.data.id === requestId && known.data.fingerprint === fingerprint)
        return { status: "recovery-required" as const, transactionId: requestId, revisions: {} };
      throw new McpStorageError("unavailable");
    }
    return this.execute(journal, "complete", signal);
  }
  save(
    request: {
      targetId: string;
      expectedRevision: string;
      text: string;
      requestId: string;
      requireValidOriginal?: boolean;
      requireDecodableOriginal?: boolean;
    },
    signal?: AbortSignal,
  ): Promise<Result> {
    return this.run(async () => {
      this.validate(request.text);
      const fingerprint = hash(
        JSON.stringify([
          "save",
          request.targetId,
          request.expectedRevision,
          request.text,
          ...(request.requireValidOriginal ? ["valid-original"] : []),
          ...(request.requireDecodableOriginal ? ["decodable-original"] : []),
        ]),
      );
      const replay = await this.replay(request.requestId, fingerprint);
      if (replay) return replay;
      const { target, current } = await this.expected(request.targetId, request.expectedRevision);
      if (request.requireValidOriginal && !this.inspect(current).document)
        throw new McpStorageError("invalid");
      if (
        request.requireDecodableOriginal &&
        current.data !== null &&
        this.inspect(current).text === null
      )
        throw new McpStorageError("invalid");
      if (current.data !== null && Buffer.from(current.data).equals(Buffer.from(request.text))) {
        const result: Result = {
          status: "unchanged",
          transactionId: request.requestId,
          revisions: { [target.id]: current.revision },
        };
        await this.reserve(16_384);
        await this.receipt(request.requestId, fingerprint, result);
        return result;
      }
      return this.begin(
        request.requestId,
        fingerprint,
        "saved",
        [{ target, current, text: request.text }],
        signal,
      );
    });
  }
  setEnabled(request: {
    targetId: string;
    expectedRevision: string;
    requestId: string;
    serverId: string;
    enabled: boolean;
  }): Promise<Result> {
    return this.run(async () => {
      const fingerprint = hash(
        JSON.stringify([
          "enable",
          request.targetId,
          request.expectedRevision,
          request.serverId,
          request.enabled,
        ]),
      );
      const replay = await this.replay(request.requestId, fingerprint);
      if (replay) return replay;
      const { target, current } = await this.expected(request.targetId, request.expectedRevision);
      const document = this.inspect(current).document;
      if (!document || !Object.hasOwn(document.servers, request.serverId))
        throw new McpStorageError("invalid");
      const definition = document.servers[request.serverId]!;
      if (definition.enabled === request.enabled) {
        const result: Result = {
          status: "unchanged",
          transactionId: request.requestId,
          revisions: { [target.id]: current.revision },
        };
        await this.reserve(16_384);
        await this.receipt(request.requestId, fingerprint, result);
        return result;
      }
      definition.enabled = request.enabled;
      const text = `${JSON.stringify(document, null, 2)}\n`;
      this.validate(text);
      return this.begin(request.requestId, fingerprint, "saved", [{ target, current, text }]);
    });
  }
  move(
    request: {
      sourceId: string;
      destinationId: string;
      serverId: string;
      expectedSourceRevision: string;
      expectedDestinationRevision: string;
      requestId: string;
    },
    signal?: AbortSignal,
  ): Promise<Result> {
    return this.run(async () => {
      const fingerprint = hash(
        JSON.stringify([
          "move",
          request.sourceId,
          request.destinationId,
          request.serverId,
          request.expectedSourceRevision,
          request.expectedDestinationRevision,
        ]),
      );
      const replay = await this.replay(request.requestId, fingerprint);
      if (replay) return replay;
      if (request.sourceId === request.destinationId) throw new McpStorageError("invalid");
      const source = await this.expected(request.sourceId, request.expectedSourceRevision);
      const destination = await this.expected(
        request.destinationId,
        request.expectedDestinationRevision,
      );
      const from = this.inspect(source.current).document;
      const to = this.inspect(destination.current).document;
      if (
        !from ||
        !to ||
        !Object.hasOwn(from.servers, request.serverId) ||
        Object.hasOwn(to.servers, request.serverId)
      )
        throw new McpStorageError("invalid");
      const server = from.servers[request.serverId];
      if (!server) throw new McpStorageError("invalid");
      to.servers[request.serverId] = server;
      delete from.servers[request.serverId];
      const sourceText = canonical(from);
      const destinationText = canonical(to);
      this.validate(sourceText);
      this.validate(destinationText);
      return this.begin(
        request.requestId,
        fingerprint,
        "moved",
        [
          { ...destination, text: destinationText },
          { ...source, text: sourceText },
        ],
        signal,
      );
    });
  }
  listBackups(targetId: string) {
    return this.run(async () => {
      this.target(targetId);
      const records = await this.records();
      return records.backups
        .filter((backup) => backup.targetId === targetId)
        .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
        .map((backup) => ({
          backupId: backup.id,
          createdAt: backup.createdAt,
          valid: backup.valid,
          pinned: records.journals.some((journal) => journal.id === backup.transactionId),
        }));
    });
  }
  private async reviewedBackup(targetId: string, backupId: string) {
    await this.raw(this.target(targetId));
    const records = await this.records();
    const backup = records.backups.find(
      (entry) => entry.id === backupId && entry.targetId === targetId,
    );
    if (!backup?.valid || records.journals.some((j) => j.id === backup.transactionId))
      throw new McpStorageError("invalid");
    const path = this.path(`${backupId}.backup`);
    const before = await verifyPrivatePath(path, false);
    const current = backupSchema.parse(await readPrivateJson(path, BACKUP_LIMIT));
    const after = await verifyPrivatePath(path, false);
    const stamp = (info: typeof before) =>
      [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs, info.mode].map(String);
    if (
      JSON.stringify(stamp(before)) !== JSON.stringify(stamp(after)) ||
      JSON.stringify(current) !== JSON.stringify(backup)
    )
      throw new McpStorageError("conflict");
    return { backup, backupRevision: hash(JSON.stringify([stamp(after), current])) };
  }
  previewBackup(targetId: string, backupId: string) {
    return this.run(async () => {
      const { backup, backupRevision } = await this.reviewedBackup(targetId, backupId);
      const data = bytes(backup.image);
      return {
        backupId,
        backupRevision,
        missing: data === null,
        text:
          data === null
            ? null
            : new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data),
      };
    });
  }
  reset(
    request: {
      targets: { targetId: string; expectedRevision: string; reset: boolean }[];
      requestId: string;
    },
    signal?: AbortSignal,
  ): Promise<Result> {
    return this.run(async () => {
      if (
        !request.targets.length ||
        request.targets.length > 2 ||
        new Set(request.targets.map((t) => t.targetId)).size !== request.targets.length ||
        !request.targets.some((t) => t.reset)
      )
        throw new McpStorageError("invalid");
      const ordered = [...request.targets].sort(
        (a, b) =>
          Number(Boolean(this.target(a.targetId).projectRoot)) -
            Number(Boolean(this.target(b.targetId).projectRoot)) ||
          a.targetId.localeCompare(b.targetId),
      );
      const fingerprint = hash(
        JSON.stringify(["reset", ordered.map((t) => [t.targetId, t.expectedRevision, t.reset])]),
      );
      const replay = await this.replay(request.requestId, fingerprint);
      if (replay) return replay;
      if (signal?.aborted) throw new McpStorageError("cancelled");
      const values = [];
      for (const entry of ordered) {
        const expected = await this.expected(entry.targetId, entry.expectedRevision);
        const document = this.inspect(expected.current).document;
        const write =
          entry.reset &&
          expected.current.data !== null &&
          (!document || Object.keys(document.servers).length > 0);
        values.push({
          ...expected,
          text: write ? canonical({ version: 1, servers: {} }) : null,
          write,
        });
      }
      if (!values.some((v) => v.write)) {
        const result: Result = {
          status: "unchanged",
          transactionId: request.requestId,
          revisions: Object.fromEntries(values.map((v) => [v.target.id, v.current.revision])),
        };
        await this.reserve(16384);
        for (const v of values)
          if ((await this.raw(v.target)).revision !== v.current.revision)
            throw new McpStorageError("conflict");
        if (signal?.aborted) throw new McpStorageError("cancelled");
        await this.receipt(request.requestId, fingerprint, result);
        return result;
      }
      return this.begin(request.requestId, fingerprint, "reset", values, signal);
    });
  }
  restore(
    request: {
      targetId: string;
      expectedRevision: string;
      backupId: string;
      requestId: string;
      expectedBackupRevision?: string;
    },
    signal?: AbortSignal,
  ): Promise<Result> {
    return this.run(async () => {
      const fingerprint = hash(
        JSON.stringify([
          "restore",
          request.targetId,
          request.expectedRevision,
          request.backupId,
          ...(request.expectedBackupRevision ? [request.expectedBackupRevision] : []),
        ]),
      );
      const replay = await this.replay(request.requestId, fingerprint);
      if (replay) return replay;
      const reviewed = await this.reviewedBackup(request.targetId, request.backupId);
      if (
        request.expectedBackupRevision &&
        reviewed.backupRevision !== request.expectedBackupRevision
      )
        throw new McpStorageError("conflict");
      const backup = reviewed.backup;
      const data = bytes(backup.image);
      const text =
        data === null
          ? null
          : new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data);
      if (text !== null) this.validate(text);
      const expected = await this.expected(request.targetId, request.expectedRevision);
      return this.begin(
        request.requestId,
        fingerprint,
        "restored",
        [{ ...expected, text, mode: backup.image.mode }],
        signal,
      );
    });
  }
  listPendingRecovery() {
    return this.run(async () =>
      (await this.records()).journals.map((journal) => ({
        transactionId: journal.id,
        targetIds: journal.changes.map((change) => change.targetId),
      })),
    );
  }
  recover(
    request: {
      transactionId: string;
      action: "complete" | "rollback";
      expectedRevisions: Record<string, string>;
      requestId: string;
    },
    signal?: AbortSignal,
  ): Promise<Result> {
    return this.run(async () => {
      const fingerprint = hash(
        JSON.stringify([
          "recover",
          request.transactionId,
          request.action,
          Object.entries(request.expectedRevisions).sort(([a], [b]) => a.localeCompare(b)),
        ]),
      );
      const replay = await this.replay(request.requestId, fingerprint);
      if (replay) return replay;
      const journal = (await this.records()).journals.find(
        (entry) => entry.id === request.transactionId,
      );
      if (!journal) throw new McpStorageError("unavailable");
      if (signal?.aborted) throw new McpStorageError("cancelled");
      await this.checkRecovery(journal);
      for (const change of journal.changes)
        if (
          (await this.raw(this.bound(change))).revision !==
          request.expectedRevisions[change.targetId]
        )
          throw new McpStorageError("conflict");
      if (journal.recovery)
        await this.receipt(journal.recovery.id, journal.recovery.fingerprint, {
          status: "recovery-required",
          transactionId: journal.id,
          revisions: {},
        });
      journal.recovery = { id: request.requestId, fingerprint, action: request.action };
      await this.reserve(JOURNAL_LIMIT);
      await this.writeRecord(
        `${journal.id}.journal`,
        journal,
        JOURNAL_LIMIT,
        "journal",
        journal.id,
      );
      return this.execute(journal, request.action, signal);
    });
  }
  close() {
    this.closing ??= this.queue
      .then(() => this.release())
      .catch(() => {
        throw new McpStorageError("unsafe");
      });
    return this.closing;
  }
}
