import { createHash, randomUUID } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { runIdSchema } from "../contracts/index.js";
import { atomicReplace } from "../platform/index.js";
import { RUN_EVENT_TYPES, runEventSchema, runRecordSchema } from "./record-schemas.js";
import type { RunEvent, RunRecord } from "./types.js";
import { UsageError } from "./types.js";
import { RUN_RECORD_FORMAT } from "./version.js";

/** The subset of `node:fs/promises` the record store uses. */
export interface RecordFs {
  /** Wrappers over one filesystem share this scope; independent injected filesystems do not. */
  recordStoreScope?: object;
  realpath?(path: string): Promise<string>;
  mkdir(path: string, options: { recursive: true; mode: number }): Promise<unknown>;
  writeFile(path: string, data: string, options: { mode: number; flag: "wx" }): Promise<void>;
  rename(from: string, to: string, timeoutMs?: number): Promise<void>;
  appendFile(path: string, data: string, options: { mode: number }): Promise<void>;
  readFile(path: string, encoding: "utf8"): Promise<string>;
  readdir(path: string): Promise<string[]>;
  rm(path: string, options: { force: true }): Promise<void>;
}

export interface RecordStore {
  readonly dir: string;
  save(record: RunRecord): Promise<void>;
  appendEvent(event: RunEvent): Promise<void>;
  read(id: string): Promise<RunRecord>;
  readEvents(id: string): Promise<RunEvent[]>;
  list(): Promise<RunRecord[]>;
}

export function assertRunId(id: string): void {
  if (!runIdSchema.safeParse(id).success) throw new UsageError(`invalid run ID '${id}'`);
}

export function runsDir(commonDir: string): string {
  return join(commonDir, "code60", "runs");
}

/** Records of runs outside a Git repository, keyed by the directory they ran in. */
export function directoryRunsDir(stateHome: string, directory: string): string {
  const key = createHash("sha256").update(directory).digest("hex").slice(0, 16);
  return join(stateHome, "code60", "dirs", key, "runs");
}

interface StoreCoordination {
  writes: Map<string, Promise<void>>;
  listings: WeakMap<
    RecordFs["readFile"],
    WeakMap<RecordFs["readdir"], Map<string, Promise<RunRecord[]>>>
  >;
}

const coordinators = new WeakMap<object, StoreCoordination>();

async function canonicalDirectory(fs: RecordFs, dir: string): Promise<string> {
  let parent = resolve(dir);
  if (!fs.realpath) return parent;
  const missing: string[] = [];
  for (;;) {
    try {
      return join(await fs.realpath(parent), ...missing.toReversed());
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT" || dirname(parent) === parent)
        throw cause;
      missing.push(basename(parent));
      parent = dirname(parent);
    }
  }
}

function parseRecord(text: string, id: string): RunRecord {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`Invalid run.json for run '${id}'`);
  }
  // Records without a format predate it and are format 1.
  const format = (value as { format?: unknown } | null)?.format;
  if (
    format !== undefined &&
    (typeof format !== "number" || !Number.isSafeInteger(format) || format < 1)
  )
    throw new Error(`Invalid run.json for run '${id}'`);
  if (typeof format === "number" && format > RUN_RECORD_FORMAT)
    throw new Error(`run.json for run '${id}' was created by a newer version of Code60`);
  try {
    const record = runRecordSchema.parse(value, { jitless: true });
    if (record.id !== id) throw new Error("Mismatched run ID");
    return record;
  } catch {
    // Do not include raw JSON, prompts, or the Zod issue payload in diagnostics.
    throw new Error(`Invalid run.json for run '${id}'`);
  }
}

/**
 * Stores runs under `<dir>/<id>/`. Writes for one run are serialized so events stay in order
 * and `run.json` replacements never interleave.
 */
export function createRecordStore(fs: RecordFs, dir: string): RecordStore {
  const scope = fs.recordStoreScope ?? fs;
  let shared = coordinators.get(scope);
  if (!shared) {
    shared = { writes: new Map(), listings: new WeakMap() };
    coordinators.set(scope, shared);
  }
  const { writes: queues } = shared;
  let readers = shared.listings.get(fs.readFile);
  if (!readers) {
    readers = new WeakMap();
    shared.listings.set(fs.readFile, readers);
  }
  const listings = readers.get(fs.readdir) ?? new Map<string, Promise<RunRecord[]>>();
  readers.set(fs.readdir, listings);
  let directory: Promise<string> | undefined;
  const canonical = () =>
    (directory ??= canonicalDirectory(fs, dir).catch((cause) => {
      directory = undefined;
      throw cause;
    }));
  const temporaryId = randomUUID();
  let tmpCounter = 0;

  const enqueue = async (id: string, op: () => Promise<void>): Promise<void> => {
    assertRunId(id);
    const key = JSON.stringify([await canonical(), id]);
    const next = (queues.get(key) ?? Promise.resolve()).then(op, op);
    queues.set(key, next);
    const release = () => {
      if (queues.get(key) === next) queues.delete(key);
    };
    void next.then(release, release);
    return next;
  };

  const runDir = (id: string) => {
    assertRunId(id);
    return join(dir, id);
  };

  return {
    dir,
    save(record) {
      const snapshot = `${JSON.stringify({ ...record, format: RUN_RECORD_FORMAT }, null, 2)}\n`;
      return enqueue(record.id, async () => {
        const target = runDir(record.id);
        await fs.mkdir(target, { recursive: true, mode: 0o700 });
        const tmp = join(target, `.run.json.${process.pid}.${temporaryId}.${tmpCounter++}.tmp`);
        try {
          await fs.writeFile(tmp, snapshot, { mode: 0o600, flag: "wx" });
          await atomicReplace(tmp, join(target, "run.json"), (from, to, timeoutMs) =>
            fs.rename(from, to, timeoutMs),
          );
        } catch (error) {
          await fs.rm(tmp, { force: true });
          throw error;
        }
      });
    },
    appendEvent(event) {
      const line = `${JSON.stringify(event)}\n`;
      return enqueue(event.runId, async () => {
        const target = runDir(event.runId);
        await fs.mkdir(target, { recursive: true, mode: 0o700 });
        await fs.appendFile(join(target, "events.jsonl"), line, { mode: 0o600 });
      });
    },
    async read(id) {
      let text: string;
      try {
        text = await fs.readFile(join(runDir(id), "run.json"), "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          throw new UsageError(`no run with ID '${id}'`);
        }
        throw error;
      }
      return parseRecord(text, id);
    },
    async readEvents(id) {
      const text = await fs.readFile(join(runDir(id), "events.jsonl"), "utf8").catch(() => {
        throw new Error(`Could not read events.jsonl for run '${id}'`);
      });
      const events: RunEvent[] = [];
      for (const [index, line] of text
        .split("\n")
        .filter((entry) => entry !== "")
        .entries()) {
        try {
          const value: unknown = JSON.parse(line);
          const type = (value as { type?: unknown } | null)?.type;
          if (typeof type === "string" && !RUN_EVENT_TYPES.has(type)) {
            if ((value as { runId?: unknown }).runId !== id) throw new Error("Mismatched run ID");
            continue;
          }
          const event = runEventSchema.parse(value, { jitless: true });
          if (event.runId !== id) throw new Error("Mismatched run ID");
          events.push(event);
        } catch {
          throw new Error(`Invalid events.jsonl for run '${id}' at event ${index + 1}`);
        }
      }
      return events;
    },
    async list() {
      const key = await canonical();
      let pending = listings.get(key);
      if (!pending) {
        pending = listRecords(fs, dir);
        listings.set(key, pending);
        const release = () => {
          if (listings.get(key) === pending) listings.delete(key);
        };
        void pending.then(release, release);
      }
      return structuredClone(await pending);
    },
  };
}

async function listRecords(fs: RecordFs, dir: string): Promise<RunRecord[]> {
  let ids: string[];
  try {
    ids = await fs.readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const records: RunRecord[] = [];
  for (const id of ids.filter((name) => runIdSchema.safeParse(name).success)) {
    try {
      records.push(parseRecord(await fs.readFile(join(dir, id, "run.json"), "utf8"), id));
    } catch {
      // A directory without a readable run.json is not a run the tool can show.
    }
  }
  return records.sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));
}
