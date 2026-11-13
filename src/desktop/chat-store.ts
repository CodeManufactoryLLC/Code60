import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { parseValue, type SavedChat, savedChatSchema } from "../bridge/index.js";
import { atomicReplace, privateDirectory, writePrivateFile } from "../platform/index.js";

const MAX_BYTES = 16 * 1_048_576;
const MAX_CHATS = 500;
const filename = /^[a-f0-9-]{36}\.json$/;

async function safeDirectory(path: string) {
  await privateDirectory(path);
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Unsafe chat directory");
}

async function regular(path: string) {
  const info = await lstat(path).catch((cause: NodeJS.ErrnoException) => {
    if (cause.code === "ENOENT") return null;
    throw cause;
  });
  if (info && (!info.isFile() || info.isSymbolicLink())) throw new Error("Unsafe chat record");
}

/** Validate and read through the same handle, including files that grow while being read. */
async function readText(path: string, limit = MAX_BYTES): Promise<string> {
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
      info.size > limit
    )
      throw new Error("Unsafe or oversized chat record");
    const bytes = Buffer.alloc(Math.min(info.size + 1, limit + 1));
    let count = 0;
    while (count < bytes.length) {
      const result = await file.read(bytes, count, bytes.length - count, count);
      if (!result.bytesRead) break;
      count += result.bytesRead;
    }
    if (count > info.size) throw new Error("Chat record changed while reading");
    return bytes.subarray(0, count).toString("utf8");
  } finally {
    await file.close();
  }
}

/** Desktop metadata only. Saved task provenance never restores capabilities or queues. */
export class ChatStore {
  private writes: Promise<unknown> = Promise.resolve();
  private readonly records: string;
  constructor(readonly root: string) {
    this.records = join(root, "chats");
  }

  private async directories() {
    await safeDirectory(this.root);
    await safeDirectory(this.records);
  }

  /** Reserve a read-only metadata snapshot between this store's atomic writes. */
  snapshot(): Promise<{ chats: SavedChat[]; errors: string[] }> {
    const result = this.writes.then(() => this.load());
    this.writes = result.catch(() => {});
    return result;
  }

  async load(): Promise<{ chats: SavedChat[]; errors: string[] }> {
    await this.directories();
    const names = (await readdir(this.records)).filter((name) => filename.test(name));
    if (names.length > MAX_CHATS) throw new Error("Saved chat limit reached");
    const chats: SavedChat[] = [];
    const errors: string[] = [];
    let remaining = 64 * 1_048_576;
    for (const name of names) {
      try {
        const text = await readText(join(this.records, name), Math.min(MAX_BYTES, remaining));
        remaining -= Buffer.byteLength(text);
        const record = parseValue(savedChatSchema, JSON.parse(text));
        if (`${record.directoryId}.json` !== name) throw new Error("Saved chat identity mismatch");
        if (
          new Set(record.tasks.map((task) => task.id)).size !== record.tasks.length ||
          (record.taskId && !record.tasks.some((task) => task.id === record.taskId))
        )
          throw new Error("Saved task identity mismatch");
        chats.push(record);
      } catch {
        errors.push(
          `A saved chat (${name.slice(0, 8)}) could not be read. Its files were preserved; inspect the private chat storage before retrying.`,
        );
      }
    }
    return { chats, errors };
  }

  async directory(id: string) {
    // Validate the generated component before deriving any path.
    const directoryId = savedChatSchema.shape.directoryId.parse(id);
    await safeDirectory(this.root);
    const path = join(this.root, directoryId);
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error("Saved chat directory is unavailable or unsafe");
    return path;
  }

  async save(value: SavedChat): Promise<void> {
    const record = parseValue(savedChatSchema, value);
    const data = JSON.stringify(record);
    if (Buffer.byteLength(data) > MAX_BYTES)
      return Promise.reject(new Error("Chat storage limit reached"));
    const result = this.writes.then(async () => {
      await this.directories();
      const path = join(this.records, `${record.directoryId}.json`);
      await regular(path);
      const entries = await readdir(this.records);
      if (
        !entries.includes(`${record.directoryId}.json`) &&
        entries.filter((name) => filename.test(name)).length >= MAX_CHATS
      )
        throw new Error("Saved chat limit reached");
      const temporary = join(this.records, `${randomUUID()}.tmp`);
      try {
        await writePrivateFile(temporary, data, { flag: "wx", mode: 0o600 });
        await atomicReplace(temporary, path);
      } finally {
        await rm(temporary, { force: true });
      }
    });
    this.writes = result.catch(() => {});
    return result;
  }

  /** Only core-derived names in one validated saved run; never exposed through IPC. */
  async readHistory(directoryId: string, runId: string, path: string): Promise<string> {
    savedChatSchema.shape.runId.parse(runId);
    const directory = await this.directory(directoryId);
    let parent = directory;
    for (const component of [".code60", "runs", runId]) {
      parent = join(parent, component);
      const info = await lstat(parent);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error("Unsafe chat history directory");
    }
    const record = join(parent, "run.json");
    const events = join(parent, "events.jsonl");
    if (path !== record && path !== events) throw new Error("Unknown saved chat file");
    return readText(path, path === record ? 1_048_576 : 32 * 1_048_576);
  }
}
