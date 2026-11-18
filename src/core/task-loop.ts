import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { z } from "zod";
import type { TaskEntry, TaskGit } from "../git/index.js";
import {
  atomicReplace,
  containedPath,
  privateDirectory,
  writePrivateFile,
} from "../platform/index.js";

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
  private static readonly writes = new Set<{ projects: string[]; done: Promise<unknown> }>();
  /** Filesystem-only journals never read or modify Git metadata. */
  static folderGit(root: string, merge?: TaskGit["merge"]): TaskGit {
    const unsupported = async (): Promise<never> => {
      throw new Error("Folder journals do not provide Git snapshots");
    };
    return {
      snapshot: unsupported,
      tree: unsupported,
      blob: unsupported,
      hash: unsupported,
      merge: merge ?? (async () => null),
      identity: async (project) => {
        const canonical = await fs.realpath(project);
        const info = await fs.lstat(project, { bigint: true });
        if (canonical !== project || !info.isDirectory() || info.isSymbolicLink())
          throw new Error("The checkpoint target moved");
        return `${info.dev}:${info.ino}`;
      },
      lockPath: async (project) => {
        const directory = join(root, "folder-locks");
        await privateDirectory(directory);
        return join(directory, `${createHash("sha256").update(project).digest("hex")}.lock`);
      },
    };
  }
  /** Checkout leases include nested roots; filesystem locks cover other processes. */
  static coordinate<T>(projects: readonly string[], work: () => Promise<T>): Promise<T> {
    const roots = [
      ...new Set(
        projects.map((project) => {
          const path = resolve(project);
          return process.platform === "linux" ? path : path.toLowerCase();
        }),
      ),
    ];
    const previous = [...TaskLoop.writes].filter((entry) =>
      entry.projects.some((a) => roots.some((b) => containedPath(a, b) || containedPath(b, a))),
    );
    const done = Promise.all(previous.map((entry) => entry.done.catch(() => {}))).then(work);
    const entry = { projects: roots, done };
    TaskLoop.writes.add(entry);
    return done.finally(() => TaskLoop.writes.delete(entry));
  }
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
  async baseline(id: string, captured?: string): Promise<string> {
    if (captured !== undefined) oid.parse(captured, { jitless: true });
    const state = await this.state(id);
    if (captured !== undefined && state.baseline && state.baseline !== captured)
      throw new Error("Task baseline is already bound to another capture");
    if (!state.baseline) {
      state.baseline =
        captured ?? (await this.git.snapshot(this.project, { exclude: this.excludedPaths }));
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
  /** A bounded direct-folder preimage; links and unsupported paths fail before launch. */
  async snapshotFolder(availableBytes = 32 * 1024 * 1024) {
    const files = new Map<string, NonNullable<Content>>();
    let bytes = 0;
    let entries = 0;
    const visit = async (relative: string, depth: number): Promise<void> => {
      if (depth > 64) throw new Error("Direct snapshot exceeds 64 directory levels");
      const directory = join(this.project, relative);
      const before = await this.io.lstat(directory, { bigint: true });
      if (
        before.isSymbolicLink() ||
        !before.isDirectory() ||
        (await this.io.realpath(directory)) !== directory
      )
        throw new Error("Direct snapshot cannot traverse a symbolic link");
      const handle = await this.io.opendir(directory);
      for await (const entry of handle) {
        if (++entries > 10_000) throw new Error("Direct snapshot exceeds 10,000 entries");
        if ([".git", ".code60_workspace"].includes(entry.name.toLowerCase())) continue;
        const path = relative ? `${relative}/${entry.name}` : entry.name;
        const absolute = resolve(this.project, path);
        if (
          this.excludedPaths.some(
            (excluded) => resolve(excluded).toLowerCase() === absolute.toLowerCase(),
          )
        )
          continue;
        await this.safePath(path);
        if (entry.isDirectory()) await visit(path, depth + 1);
        else {
          const value = await this.disk(path);
          if (!value) throw new Error("Direct snapshot changed while reading");
          bytes += Buffer.byteLength(value.data, "base64");
          if (bytes > Math.min(32 * 1024 * 1024, availableBytes))
            throw new Error("Direct snapshots exceed their 32 MiB total file limit");
          files.set(path, value);
        }
      }
      const after = await this.io.lstat(directory, { bigint: true });
      if (
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        before.mtimeNs !== after.mtimeNs ||
        after.isSymbolicLink()
      )
        throw new Error("Direct snapshot directory changed while reading");
    };
    await visit("", 0);
    return files;
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
  private async checkoutContent(
    entry: TaskEntry | undefined,
    path: string,
    content: Content,
    current: Content,
  ): Promise<Content> {
    if (!entry || !content || !current) return content;
    const bytes = Buffer.from(content.data, "base64");
    const disk = Buffer.from(current.data, "base64");
    if (
      [bytes, disk].some(
        (data) => data.includes(0) || !Buffer.from(data.toString("utf8")).equals(data),
      )
    )
      return content;
    const text = disk.toString("utf8");
    // Mixed endings have no single checkout convention; do not guess.
    const crlf = text.includes("\r\n");
    if (crlf && /(?<!\r)\n/.test(text)) return content;
    const rendered = Buffer.from(bytes.toString("utf8").replace(/\r?\n/g, crlf ? "\r\n" : "\n"));
    if (rendered.equals(bytes)) return content;
    // EOL conversion is allowed only when Git's actual clean filters prove
    // these bytes still represent this exact blob. Never normalize write guards.
    if ((await this.git.hash(this.project, path, rendered)) !== entry.oid) return content;
    return { ...content, data: rendered.toString("base64") };
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
    availableBytes = 128 * 1024 * 1024,
    reserve?: (bytes: number) => Promise<void>,
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
          let proposed = await this.content(after[path], path);
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
          const disk = paths.has(path) ? null : await this.disk(path);
          const current = paths.get(path) ?? { before: disk, after: disk };
          if (!resolution)
            original = await this.checkoutContent(base[path], path, original, current.after);
          proposed = await this.checkoutContent(after[path], path, proposed, current.after);
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
    if (
      Math.max(bytes, Buffer.byteLength(JSON.stringify(proposal))) >
      Math.min(128 * 1024 * 1024, availableBytes)
    )
      throw new Error("Task exceeds the available application journal limit (128 MiB maximum)");
    for (const change of proposal.changes)
      if (!diskSame(change.before, await this.disk(change.path)))
        throw new Error("Project changed while preparing the application. Refresh the preview.");
    if (proposal.identity !== (await this.git.identity(this.project)))
      throw new Error("Git state changed. Refresh the preview.");
    signal?.throwIfAborted();
    await reserve?.(Buffer.byteLength(JSON.stringify(proposal)) + 1024);
    await this.saveProposal(proposal);
    state.operations.push(proposal.id);
    await this.saveState(state);
    return proposal;
  }
  /** Prepare one inverse transaction, preserving independent edits between worker updates. */
  async prepareRewind(
    id: string,
    operations: readonly (Pick<TaskProposal, "changes"> & { wholeFolder?: boolean })[],
    availableBytes = 128 * 1024 * 1024,
    reserve?: (bytes: number) => Promise<void>,
  ): Promise<TaskProposal> {
    const state = await this.state(id);
    if (await this.pendingOperation(id)) throw new Error("Recover the interrupted operation first");
    const identity = await this.git.identity(this.project);
    const paths = new Map<string, { before: Content; after: Content }>();
    const conflicts: TaskProposal["conflicts"] = [];
    for (const operation of [...operations].reverse()) {
      for (const change of [...operation.changes].reverse()) {
        try {
          this.path(change.path);
          const current = paths.get(change.path) ?? {
            before: await this.disk(change.path),
            after: await this.disk(change.path),
          };
          const restored = operation.wholeFolder
            ? change.before
            : await this.combine(change.after, current.after, change.before);
          if (restored === undefined) throw new Error("Newer edits conflict with Undo");
          if (restored) {
            const permissions = operation.wholeFolder
              ? (restored.permissions ?? 0o666 & ~process.umask())
              : (current.before?.permissions ?? restored.permissions ?? 0o666 & ~process.umask());
            current.after = {
              ...restored,
              permissions: operation.wholeFolder
                ? permissions
                : (permissions & ~0o111) |
                  (restored.mode === "100755" ? (permissions & 0o444) >> 2 : 0),
            };
          } else current.after = null;
          paths.set(change.path, current);
        } catch (cause) {
          conflicts.push({ path: change.path, reason: explain(cause) });
        }
      }
    }
    const proposal: TaskProposal = {
      format: 1,
      id: randomUUID(),
      taskId: id,
      revisionId: id,
      identity,
      status: "prepared",
      sources: [],
      previousSources: state.appliedSources,
      conflicts,
      changes: [...paths].flatMap(([path, value]) =>
        diskSame(value.before, value.after) ? [] : [{ id: randomUUID(), path, ...value }],
      ),
    };
    if (Buffer.byteLength(JSON.stringify(proposal)) > Math.min(128 * 1024 * 1024, availableBytes))
      throw new Error("Undo exceeds the available journal limit (128 MiB maximum)");
    await this.verifyPrepared(proposal);
    await reserve?.(Buffer.byteLength(JSON.stringify(proposal)) + 1024);
    await this.saveProposal(proposal);
    state.operations.push(proposal.id);
    await this.saveState(state);
    return proposal;
  }
  /** Preflight every target before a multi-target restore starts writing. */
  async verifyPrepared(proposal: TaskProposal): Promise<void> {
    if (proposal.identity !== (await this.git.identity(this.project)))
      throw new Error("Git state changed. Undo was not started.");
    for (const change of proposal.changes)
      if (!diskSame(change.before, await this.disk(change.path)))
        throw new Error(`Newer edits prevent Undo: ${change.path}`);
  }
  async verifyRecovery(proposal: TaskProposal): Promise<void> {
    for (const change of proposal.changes) {
      const current = await this.disk(change.path);
      if (!diskSame(current, change.before) && !diskSame(current, change.after))
        throw new Error(`Newer edits prevent recovery: ${change.path}`);
    }
  }
  private async write(path: string, expected: Content, value: Content, valid?: () => void) {
    const target = await this.safePath(path);
    if (!diskSame(await this.disk(path), expected)) throw new Error(`Project changed: ${path}`);
    valid?.();
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
      valid?.();
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
    valid?: () => void,
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
      valid?.();
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
            valid,
          );
        }
        signal?.throwIfAborted();
        valid?.();
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
