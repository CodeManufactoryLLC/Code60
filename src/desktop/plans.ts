import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type Plan,
  type PlanAction,
  type PlanCreate,
  type PlanUpdate,
  planMarkdown,
  planSchema,
  planSummary,
} from "../bridge/index.js";
import { atomicReplace, privateDirectory, writePrivateFile } from "../platform/index.js";

const MAX_BYTES = 1_048_576;
async function directory(path: string) {
  await privateDirectory(path);
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Unsafe plan directory");
}
async function regular(path: string) {
  const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (info && (!info.isFile() || info.isSymbolicLink())) throw new Error("Unsafe plan file");
}
async function read(path: string): Promise<unknown> {
  await regular(path);
  const file = await open(
    path,
    constants.O_RDONLY |
      constants.O_NONBLOCK |
      (process.platform === "win32" ? 0 : constants.O_NOFOLLOW),
  );
  try {
    const info = await file.stat();
    const entry = await lstat(path);
    if (
      !info.isFile() ||
      entry.isSymbolicLink() ||
      info.dev !== entry.dev ||
      info.ino !== entry.ino ||
      info.size > MAX_BYTES
    )
      throw new Error("Unsafe plan record");
    const bytes = Buffer.alloc(MAX_BYTES + 1);
    let count = 0;
    while (count < bytes.length) {
      const result = await file.read(bytes, count, bytes.length - count, count);
      if (!result.bytesRead) break;
      count += result.bytesRead;
    }
    if (count > MAX_BYTES) throw new Error("Plan record too large");
    return JSON.parse(bytes.subarray(0, count).toString("utf8"));
  } finally {
    await file.close();
  }
}
async function write(path: string, data: string) {
  if (Buffer.byteLength(data) > MAX_BYTES) throw new Error("Plan storage limit reached");
  await regular(path);
  const temporary = join(dirname(path), `${randomUUID()}.tmp`);
  try {
    await writePrivateFile(temporary, data, { flag: "wx", mode: 0o600 });
    await atomicReplace(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Conversation-owned documents. Saved state never grants execution authority. */
export class PlanStore {
  private records = new Map<string, Plan>();
  private writes: Promise<unknown> = Promise.resolve();
  private readonly markdownRoot: string;
  private readonly recordRoot: string;
  private constructor(
    readonly root: string,
    readonly chatId: string,
  ) {
    this.markdownRoot = join(root, "plans");
    this.recordRoot = join(root, ".code60", "plans");
  }
  private async directories() {
    for (const path of [this.root, join(this.root, ".code60"), this.recordRoot, this.markdownRoot])
      await directory(path);
  }
  static async open(root: string, chatId: string) {
    const store = new PlanStore(root, chatId);
    await store.directories();
    const entries = (await readdir(store.recordRoot)).filter((name) =>
      /^[a-f0-9-]{36}\.json$/.test(name),
    );
    if (entries.length > 100) throw new Error("Plan limit reached");
    for (const entry of entries) {
      const plan = planSchema.parse(await read(join(store.recordRoot, entry)));
      if (plan.chatId !== chatId || entry !== `${plan.id}.json`)
        throw new Error("Invalid plan identity");
      if (["queued", "running"].includes(plan.state)) {
        plan.state = "paused";
        plan.error = "Execution interrupted. Inspect previous work before continuing.";
        plan.revision++;
      }
      await store.save(plan); // Repair a Markdown projection interrupted before record commit.
    }
    return store;
  }
  list() {
    return [...this.records.values()].map(planSummary);
  }
  active() {
    return [...this.records.values()].find(
      (plan) => !["completed", "dismissed"].includes(plan.state),
    );
  }
  get(id: string): Plan {
    const plan = this.records.get(id);
    if (!plan) throw new Error("Unknown plan in this conversation");
    return structuredClone(plan);
  }
  private serialized<T>(operation: () => Promise<T>) {
    const result = this.writes.then(operation);
    this.writes = result.catch(() => {});
    return result;
  }
  private async save(plan: Plan) {
    planSchema.parse(plan);
    await this.directories();
    // The record is the commit point; reopening regenerates any interrupted projection.
    await write(join(this.markdownRoot, `${plan.id}.md`), planMarkdown(plan));
    try {
      await write(join(this.recordRoot, `${plan.id}.json`), JSON.stringify(plan));
    } catch (error) {
      const previous = this.records.get(plan.id);
      if (previous)
        await write(join(this.markdownRoot, `${plan.id}.md`), planMarkdown(previous)).catch(
          () => {},
        );
      throw error;
    }
    this.records.set(plan.id, structuredClone(plan));
    return this.get(plan.id);
  }
  create(request: PlanCreate, project: string | null) {
    return this.serialized(async () => {
      const key = JSON.stringify({ ...request, project });
      const previous = [...this.records.values()].find(
        (plan) => plan.requestId === request.requestId,
      );
      if (previous) {
        if (previous.creationKey !== key)
          throw new Error("requestId already used with different plan arguments");
        return this.get(previous.id);
      }
      if (this.active()) throw new Error("Revise or dismiss the unfinished plan first");
      if (this.records.size >= 100) throw new Error("Plan limit reached");
      return this.save({
        format: 1,
        id: randomUUID(),
        chatId: this.chatId,
        project,
        revision: 1,
        proposalRevision: 1,
        requestId: request.requestId,
        creationKey: key,
        title: request.title,
        description: request.description,
        state: "draft",
        tasks: request.tasks.map((task) => ({
          id: randomUUID(),
          text: task.text,
          state: "pending",
          note: "",
          workerIds: [],
        })),
      });
    });
  }
  mutate(id: string, edit: (plan: Plan) => void) {
    return this.serialized(async () => {
      const plan = this.get(id);
      edit(plan);
      plan.revision++;
      return this.save(plan);
    });
  }
  update(request: PlanUpdate) {
    return this.mutate(request.planId, (plan) => {
      if (plan.revision !== request.revision)
        throw new Error("Plan changed; read the latest revision");
      if (request.operation === "revise") {
        if (plan.state !== "draft") throw new Error("Only draft plans can be revised");
        const ids = request.draft.tasks.flatMap((task) => (task.id ? [task.id] : []));
        if (
          new Set(ids).size !== ids.length ||
          ids.some((id) => !plan.tasks.some((task) => task.id === id))
        )
          throw new Error("Invalid task identity");
        plan.title = request.draft.title;
        plan.description = request.draft.description;
        plan.tasks = request.draft.tasks.map((task) => ({
          id: task.id ?? randomUUID(),
          text: task.text,
          state: "pending",
          note: "",
          workerIds: [],
        }));
        plan.proposalRevision++;
      } else {
        if (plan.state !== "running")
          throw new Error("Accept or resume this plan before reporting progress");
        const task = plan.tasks.find((task) => task.id === request.taskId);
        if (!task) throw new Error("Unknown plan task");
        task.state = request.state;
        task.note = request.note;
        if (request.workerIds) task.workerIds = request.workerIds;
        if (request.state === "blocked") plan.state = "paused";
        else if (plan.tasks.every((task) => task.state === "completed")) plan.state = "completed";
      }
    });
  }
  action(request: PlanAction) {
    return this.serialized(async () => {
      if (request.chatId !== this.chatId)
        throw new Error("This plan belongs to another conversation");
      const plan = this.get(request.planId);
      if (request.type === "accept" && plan.acceptedRevision === request.revision) return plan;
      if (plan.revision !== request.revision)
        throw new Error("Plan changed; review the latest revision");
      if (request.type === "accept") {
        if (plan.state !== "draft") throw new Error("This plan is not awaiting acceptance");
        plan.acceptedRevision = request.revision;
        plan.state = "queued";
      } else if (request.type === "resume") {
        if (!["paused", "failed"].includes(plan.state) || !plan.acceptedRevision)
          throw new Error("This plan cannot be resumed");
        plan.state = "queued";
      } else {
        if (["running", "completed"].includes(plan.state))
          throw new Error("Stop the running plan before dismissing it");
        plan.state = "dismissed";
      }
      delete plan.error;
      plan.revision++;
      return this.save(plan);
    });
  }
}
