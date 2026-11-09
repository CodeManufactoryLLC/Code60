import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { z } from "zod";
import type { TaskEntry, TaskGit } from "../git/index.js";
import { atomicReplace, privateDirectory, writePrivateFile } from "../platform/index.js";

const uuid = z.string().uuid();
const oid = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const sourceSchema = z.object({ runId: z.string(), base: oid, commit: oid });
const contentSchema = z
  .object({
    data: z.string(),
    mode: z.enum(["100644", "100755"]),
    permissions: z.number().int().min(0).max(511).optional(),
  })
  .nullable();
const changeSchema = z.object({
  id: uuid,
  path: z.string(),
  before: contentSchema,
  after: contentSchema,
});
const proposalSchema = z.object({
  format: z.literal(1),
  id: uuid,
  taskId: uuid,
  revisionId: uuid,
  identity: z.string(),
  status: z.enum(["prepared", "applying", "applied", "undoing", "undone", "recovery", "failed"]),
  changes: z.array(changeSchema),
  conflicts: z.array(z.object({ path: z.string(), reason: z.string() })),
  sources: z.array(sourceSchema),
  previousSources: z.array(sourceSchema).default([]),
  error: z.string().optional(),
  direction: z.enum(["apply", "undo"]).optional(),
});
const stateSchema = z.object({
  format: z.literal(1),
  id: uuid,
  baseline: oid.optional(),
  operations: z.array(uuid).default([]),
  appliedSources: z.array(sourceSchema).default([]),
  resolutions: z
    .record(
      z.string(),
      z.object({ base: contentSchema, rejected: z.record(z.string(), contentSchema) }),
    )
    .default({}),
});
export type TaskSource = z.infer<typeof sourceSchema>;
export type TaskState = z.infer<typeof stateSchema>;
export type TaskProposal = z.infer<typeof proposalSchema>;
type Content = z.infer<typeof contentSchema>;
const same = (a: Content, b: Content) => a?.mode === b?.mode && a?.data === b?.data;
const diskSame = (a: Content, b: Content) => same(a, b) && a?.permissions === b?.permissions;
const sameEntry = (a: TaskEntry | undefined, b: TaskEntry | undefined) =>
  a?.mode === b?.mode && a?.oid === b?.oid;
const explain = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
const dead = (pid: number) => {
  try {
    process.kill(pid, 0);
    return false;
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code === "ESRCH";
  }
};

const readFlags =
  constants.O_RDONLY |
  constants.O_NONBLOCK |
  (process.platform === "win32" ? 0 : constants.O_NOFOLLOW);

async function readExact(file: fs.FileHandle, size: number): Promise<Buffer> {
  const buffer = Buffer.alloc(size + 1);
  let length = 0;
  while (length < buffer.length) {
    const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
    if (!bytesRead) break;
    length += bytesRead;
  }
  if (length !== size) throw new Error("File size changed while reading");
  return buffer.subarray(0, length);
}

/** Desktop task data and recoverable file application; no agent or UI authority is stored. */
export class TaskLoop {
  constructor(
    readonly project: string,
    readonly root: string,
    private git: TaskGit,
    private io = fs,
    private excludedPaths: string[] = [],
  ) {}
  private async read<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const handle = await this.io.open(path, readFlags);
    try {
      const info = await handle.stat({ bigint: true });
      if (!info.isFile() || info.size > 192n * 1024n * 1024n)
        throw new Error("Invalid task storage");
      if (process.platform === "win32") {
        const entry = await this.io.lstat(path, { bigint: true });
        if (entry.isSymbolicLink() || entry.dev !== info.dev || entry.ino !== info.ino)
          throw new Error("Task storage changed or is a symbolic link");
      }
      const data = await readExact(handle, Number(info.size));
      return schema.parse(JSON.parse(data.toString("utf8")), { jitless: true });
    } finally {
      await handle.close();
    }
  }
  private async save(path: string, data: unknown) {
    await privateDirectory(dirname(path));
    const temporary = join(dirname(path), `${randomUUID()}.tmp`);
    try {
      await writePrivateFile(temporary, JSON.stringify(data), { flag: "wx", mode: 0o600 });
      await atomicReplace(temporary, path);
    } finally {
      await this.io.rm(temporary, { force: true });
    }
  }
  async state(id: string): Promise<TaskState> {
    uuid.parse(id);
    try {
      const state = await this.read(join(this.root, `${id}.tsk`), stateSchema);
      if (state.id !== id) throw new Error("Task identity mismatch");
      return state;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT")
        return {
          format: 1,
          id,
          operations: [],
          appliedSources: [],
          resolutions: {},
        };
      throw cause;
    }
  }
  private saveState(state: TaskState) {
    return this.save(join(this.root, `${state.id}.tsk`), state);
  }
  async baseline(id: string): Promise<string> {
    const state = await this.state(id);
    if (!state.baseline) {
      state.baseline = await this.git.snapshot(this.project, { exclude: this.excludedPaths });
      await this.saveState(state);
    }
    return state.baseline;
  }
  async proposal(id: string, operationId: string): Promise<TaskProposal> {
    uuid.parse(operationId);
    const state = await this.state(id);
    if (!state.operations.includes(operationId)) throw new Error("Unknown task operation");
    const proposal = await this.read(join(this.root, `${operationId}.op`), proposalSchema);
    if (proposal.taskId !== id || proposal.id !== operationId)
      throw new Error("Task proposal identity mismatch");
    return proposal;
  }
  /** A human asks workers to revise against these current conflicting file contents. */
  async requestRevision(id: string, operationId: string) {
    const proposal = await this.proposal(id, operationId);
    const state = await this.state(id);
    const trees = await Promise.all(
      proposal.sources.map((source) => this.git.tree(this.project, source.commit)),
    );
    for (const conflict of proposal.conflicts) {
      if (!conflict.reason.startsWith("Worker changes conflict")) continue;
      const rejected: Record<string, Content> = {};
      for (const [index, source] of proposal.sources.entries())
        rejected[source.runId] = await this.content(trees[index]?.[conflict.path], conflict.path);
      Object.defineProperty(state.resolutions, conflict.path, {
        value: { base: await this.disk(conflict.path), rejected },
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    if (Buffer.byteLength(JSON.stringify(state)) > 128 * 1024 * 1024)
      throw new Error("Conflict revision exceeds the task storage limit");
    await this.saveState(state);
  }
  private saveProposal(proposal: TaskProposal) {
    return this.save(join(this.root, `${proposal.id}.op`), proposal);
  }
  async latest(id: string) {
    const state = await this.state(id);
    const latest = state.operations.at(-1);
    return latest ? this.proposal(id, latest) : null;
  }
  async lastApplied(id: string) {
    const state = await this.state(id);
    for (const operation of [...state.operations].reverse()) {
      const proposal = await this.proposal(id, operation);
      if (proposal.status === "applied") return proposal;
    }
    return null;
  }
  async pendingOperation(id: string): Promise<TaskProposal | null> {
    try {
      const owner = JSON.parse(
        await this.io.readFile(await this.git.lockPath(this.project), "utf8"),
      );
      if (
        owner.taskId !== id ||
        owner.root !== createHash("sha256").update(this.root).digest("hex")
      )
        return null;
      return this.proposal(id, uuid.parse(owner.operation));
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw cause;
    }
  }
  private path(path: string) {
    if (
      !path ||
      path.includes("\\") ||
      path.includes(":") ||
      path.includes("\0") ||
      path
        .split("/")
        .some(
          (p) =>
            !p ||
            p === "." ||
            p === ".." ||
            p.toLowerCase() === ".git" ||
            p.toLowerCase() === ".code60_workspace" ||
            /[. ]$/.test(p) ||
            /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p),
        )
    )
      throw new Error("Unsupported application path");
    const target = resolve(this.project, path);
    if (
      this.excludedPaths.some(
        (excluded) => resolve(excluded).toLowerCase() === target.toLowerCase(),
      )
    )
      throw new Error("Code60 storage cannot be applied");
    if (!target.startsWith(resolve(this.project) + sep))
      throw new Error("Path is outside the project");
    return target;
  }
  private async safePath(path: string) {
    if (
      (await this.io.lstat(this.project)).isSymbolicLink() ||
      resolve(await this.io.realpath(this.project)) !== resolve(this.project)
    )
      throw new Error("Project identity changed");
    const target = this.path(path);
    for (let parent = dirname(target); parent !== resolve(this.project); parent = dirname(parent)) {
      try {
        const info = await this.io.lstat(parent);
        if (!info.isDirectory() || info.isSymbolicLink())
          throw new Error("Application path traverses a link or non-directory");
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
      }
    }
    return target;
  }
  private async disk(path: string): Promise<Content> {
    const target = await this.safePath(path);
    let handle: fs.FileHandle;
    try {
      handle = await this.io.open(target, readFlags);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
      // Windows can return ENOENT when opening a dangling link. Check that
      // the entry itself is absent before treating this as a new file.
      try {
        await this.io.lstat(target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
      throw new Error("Project file changed while opening");
    }
    try {
      const info = await handle.stat({ bigint: true });
      if (!info.isFile() || info.nlink !== 1n)
        throw new Error("Only regular, non-linked files can be applied");
      if (info.size > 32n * 1024n * 1024n)
        throw new Error("Task file exceeds the 32 MiB application limit");
      // Recheck containment and pathname identity after opening. Windows can
      // follow a final symlink on open, so check the directory entry too.
      await this.safePath(path);
      const entry = await this.io.lstat(target, { bigint: true });
      if (entry.isSymbolicLink() || entry.dev !== info.dev || entry.ino !== info.ino)
        throw new Error("Project file changed while opening");
      return {
        data: (await readExact(handle, Number(info.size))).toString("base64"),
        mode: process.platform !== "win32" && info.mode & 0o111n ? "100755" : "100644",
        permissions: Number(info.mode & 0o777n),
      };
    } finally {
      await handle.close();
    }
  }
  private async content(entry: TaskEntry | undefined, path: string): Promise<Content> {
    if (!entry) return null;
    if (entry.mode !== "100644" && entry.mode !== "100755")
      throw new Error("Changed symlinks and submodules cannot be applied");
    return {
      mode: entry.mode,
      data: (await this.git.blob(this.project, entry.oid, path)).toString("base64"),
    };
  }
  private async combine(
    base: Content,
    current: Content,
    proposed: Content,
  ): Promise<Content | undefined> {
    if (same(base, proposed) || same(current, proposed)) return current;
    if (same(base, current)) return proposed;
    if (!base || !current || !proposed) return undefined;
    const mode =
      current.mode === base.mode
        ? proposed.mode
        : proposed.mode === base.mode || current.mode === proposed.mode
          ? current.mode
          : undefined;
    if (!mode) return undefined;
    if (current.data === proposed.data) return { mode, data: current.data };
    if (base.data === proposed.data) return { mode, data: current.data };
    if (base.data === current.data) return { mode, data: proposed.data };
    const result = await this.git.merge(
      Buffer.from(base.data, "base64"),
      Buffer.from(current.data, "base64"),
      Buffer.from(proposed.data, "base64"),
    );
    return result ? { mode, data: result.toString("base64") } : undefined;
  }
  async prepare(
    id: string,
    revisionId: string,
    sources: TaskSource[],
    signal?: AbortSignal,
  ): Promise<TaskProposal> {
    const state = await this.state(id);
    if (!sources.length)
      throw new Error("Capture the worker changes before preparing an application");
    if (await this.pendingOperation(id)) throw new Error("Recover the interrupted operation first");
    const previous = await this.latest(id);
    if (previous && ["applying", "undoing", "recovery"].includes(previous.status))
      throw new Error("Recover the interrupted operation first");
    const proposal: TaskProposal = {
      format: 1,
      taskId: id,
      id: randomUUID(),
      revisionId,
      identity: await this.git.identity(this.project),
      status: "prepared",
      changes: [],
      conflicts: [],
      sources,
      previousSources: state.appliedSources,
    };
    const paths = new Map<string, { before: Content; after: Content }>();
    const folded = new Map<string, string>();
    for (const source of sources) {
      signal?.throwIfAborted();
      const baseCommit =
        state.appliedSources.find((s) => s.runId === source.runId)?.commit ?? source.base;
      const [base, after] = await Promise.all([
        this.git.tree(this.project, baseCommit),
        this.git.tree(this.project, source.commit),
      ]);
      for (const path of new Set([...Object.keys(base), ...Object.keys(after)])) {
        signal?.throwIfAborted();
        if (sameEntry(base[path], after[path])) continue;
        try {
          this.path(path);
          const alias = path.normalize("NFC").toLowerCase();
          if (folded.has(alias) && folded.get(alias) !== path)
            throw new Error("Ambiguous case or Unicode path");
          folded.set(alias, path);
          let original = await this.content(base[path], path);
          const proposed = await this.content(after[path], path);
          const resolution = Object.hasOwn(state.resolutions, path)
            ? state.resolutions[path]
            : undefined;
          if (resolution && Object.hasOwn(resolution.rejected, source.runId)) {
            if (same(proposed, resolution.rejected[source.runId] ?? null))
              throw new Error("Revise this conflicting worker file before applying");
            original = resolution.base;
          }
          if (
            process.platform === "win32" &&
            proposed?.mode === "100755" &&
            original?.mode !== "100755"
          )
            throw new Error("New executable file modes cannot be applied on Windows");
          const current = paths.get(path) ?? {
            before: await this.disk(path),
            after: await this.disk(path),
          };
          const merged = await this.combine(original, current.after, proposed);
          if (merged === undefined)
            throw new Error("Worker changes conflict with another worker or current project edits");
          if (!original && !current.before && merged) {
            const renamed = Object.keys(base).find(
              (old) => !after[old] && sameEntry(base[old], after[path]),
            );
            const permissions = renamed ? (await this.disk(renamed))?.permissions : undefined;
            if (permissions !== undefined) merged.permissions = permissions;
          }
          paths.set(path, { before: current.before, after: merged });
        } catch (cause) {
          proposal.conflicts.push({ path, reason: explain(cause) });
        }
      }
    }
    let bytes = 0;
    for (const [path, value] of paths) {
      if (same(value.before, value.after)) continue;
      bytes += (value.before?.data.length ?? 0) + (value.after?.data.length ?? 0);
      if (value.after) {
        const permissions =
          value.before?.permissions ?? value.after.permissions ?? 0o666 & ~process.umask();
        value.after = {
          ...value.after,
          permissions:
            (permissions & ~0o111) |
            (value.after.mode === "100755" ? (permissions & 0o444) >> 2 : 0),
        };
      }
      proposal.changes.push({ id: randomUUID(), path, ...value });
    }
    if (bytes > 128 * 1024 * 1024)
      throw new Error("Task exceeds the 128 MiB application journal limit");
    for (const change of proposal.changes)
      if (!diskSame(change.before, await this.disk(change.path)))
        throw new Error("Project changed while preparing the application. Refresh the preview.");
    if (proposal.identity !== (await this.git.identity(this.project)))
      throw new Error("Git state changed. Refresh the preview.");
    signal?.throwIfAborted();
    await this.saveProposal(proposal);
    state.operations.push(proposal.id);
    await this.saveState(state);
    return proposal;
  }
  private async write(path: string, expected: Content, value: Content) {
    const target = await this.safePath(path);
    if (!diskSame(await this.disk(path), expected)) throw new Error(`Project changed: ${path}`);
    if (!value) {
      await this.io.unlink(target);
      return;
    }
    await this.io.mkdir(dirname(target), { recursive: true });
    const temporary = join(dirname(target), `.code60-${randomUUID()}.tmp`);
    try {
      const handle = await this.io.open(
        temporary,
        "wx",
        value.permissions ?? (value.mode === "100755" ? 0o755 : 0o644),
      );
      try {
        await handle.writeFile(Buffer.from(value.data, "base64"));
        await handle.chmod(value.permissions ?? (value.mode === "100755" ? 0o755 : 0o644));
        await handle.sync();
      } finally {
        await handle.close();
      }
      await this.safePath(path);
      if (!diskSame(await this.disk(path), expected)) throw new Error(`Project changed: ${path}`);
      await atomicReplace(temporary, target, this.io === fs ? undefined : this.io.rename);
    } finally {
      await this.io.rm(temporary, { force: true });
    }
  }
  private async lock(proposal: TaskProposal, recover: boolean) {
    const path = await this.git.lockPath(this.project);
    const owner = {
      pid: process.pid,
      taskId: proposal.taskId,
      operation: proposal.id,
      root: createHash("sha256").update(this.root).digest("hex"),
    };
    if (recover) {
      try {
        const old = JSON.parse(await this.io.readFile(path, "utf8"));
        if (
          old.operation !== owner.operation ||
          old.root !== owner.root ||
          !Number.isSafeInteger(old.pid) ||
          old.pid <= 0 ||
          (old.pid !== process.pid && !dead(old.pid))
        )
          throw new Error("Another Code60 process owns this operation");
        await this.io.unlink(path);
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
      }
    }
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      const handle = await this.io.open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify(owner));
        await handle.sync();
      } finally {
        await handle.close();
      }
      // Publish a complete owner record atomically, without replacing an existing lock.
      await this.io.link(temporary, path);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "EEXIST")
        throw new Error(
          "Another application or interrupted operation owns this project. Recover it before continuing.",
        );
      throw cause;
    } finally {
      await this.io.rm(temporary, { force: true });
    }
    return () => this.io.unlink(path);
  }
  async execute(
    id: string,
    operationId: string,
    direction: "apply" | "undo" | "recover",
    signal?: AbortSignal,
  ) {
    const proposal = await this.proposal(id, operationId);
    if (
      (direction === "apply" && proposal.status === "applied") ||
      (direction === "undo" && proposal.status === "undone")
    )
      return proposal;
    if (
      direction === "apply" &&
      (proposal.status !== "prepared" || !proposal.changes.length || proposal.conflicts.length)
    )
      throw new Error("This proposal cannot be applied");
    if (direction === "undo" && proposal.status !== "applied")
      throw new Error("This operation cannot be undone");
    if (direction === "undo" && (await this.lastApplied(id))?.id !== operationId)
      throw new Error("Undo the most recent application first");
    if (
      direction === "recover" &&
      !["applying", "undoing", "recovery"].includes(proposal.status) &&
      (await this.pendingOperation(id))?.id !== proposal.id
    )
      throw new Error("No interrupted operation to recover");
    const release = await this.lock(proposal, direction === "recover");
    let retainLock = false;
    try {
      if (direction === "recover") {
        if (["applying", "undoing", "recovery"].includes(proposal.status))
          await this.rollback(proposal);
        return proposal;
      }
      if (direction === "apply" && proposal.identity !== (await this.git.identity(this.project)))
        throw new Error("Git state changed. Refresh the preview.");
      const undo = direction === "undo";
      for (const change of proposal.changes)
        if (!diskSame(await this.disk(change.path), undo ? change.after : change.before))
          throw new Error(`Project changed: ${change.path}. Nothing was applied.`);
      proposal.direction = direction;
      proposal.status = undo ? "undoing" : "applying";
      await this.saveProposal(proposal);
      try {
        for (const change of proposal.changes) {
          signal?.throwIfAborted();
          await this.write(
            change.path,
            undo ? change.after : change.before,
            undo ? change.before : change.after,
          );
        }
        signal?.throwIfAborted();
        const state = await this.state(id);
        state.appliedSources = undo ? [] : proposal.sources;
        if (!undo) state.resolutions = {};
        if (undo) {
          for (const operation of [...state.operations].reverse()) {
            if (operation === proposal.id) continue;
            const older = await this.proposal(id, operation);
            if (older.status === "applied") {
              state.appliedSources = older.sources;
              break;
            }
          }
        }
        await this.saveState(state);
        proposal.status = undo ? "undone" : "applied";
        await this.saveProposal(proposal);
      } catch (cause) {
        proposal.error = explain(cause);
        await this.rollback(proposal);
        throw new Error(proposal.error);
      }
      return proposal;
    } catch (cause) {
      retainLock =
        proposal.status === "recovery" ||
        proposal.status === "applying" ||
        proposal.status === "undoing";
      throw cause;
    } finally {
      if (!retainLock) await release();
    }
  }
  private async rollback(proposal: TaskProposal) {
    const undo = proposal.direction === "undo";
    const conflicts: string[] = [];
    for (const change of [...proposal.changes].reverse()) {
      try {
        const current = await this.disk(change.path);
        const original = undo ? change.after : change.before;
        const written = undo ? change.before : change.after;
        if (diskSame(current, original)) continue;
        if (!diskSame(current, written)) {
          conflicts.push(change.path);
          continue;
        }
        await this.write(change.path, written, original);
      } catch {
        conflicts.push(change.path);
      }
    }
    proposal.status = conflicts.length ? "recovery" : undo ? "applied" : "failed";
    proposal.error = conflicts.length
      ? `Recovery needs attention; newer edits were preserved: ${conflicts.join(", ")}`
      : `${proposal.error ?? "Interrupted operation"}. Original files restored.`;
    if (!conflicts.length) {
      const state = await this.state(proposal.taskId);
      state.appliedSources = undo ? proposal.sources : proposal.previousSources;
      await this.saveState(state);
    }
    await this.saveProposal(proposal);
    if (conflicts.length) throw new Error(proposal.error);
  }
}
