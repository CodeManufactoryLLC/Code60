import { createHash, randomUUID } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, mkdir, open, readdir, rmdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  LOG_EVENTS,
  type LogInput,
  type LogPage,
  type LogQuery,
  type LogRecord,
  type LogStatus,
  logInputSchema,
  logRecordSchema,
} from "../bridge/index.js";
import { helperOutput, privateDirectory, writePrivateFile } from "../platform/index.js";

export const LOG_QUOTA = 20 * 1024 * 1024;
export const LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const SEGMENT_BYTES = 256 * 1024;
const RECORD_BYTES = 2048;
const QUEUE_BYTES = 512 * 1024;
const SEGMENT = /^(\d{13})-[a-f0-9-]{36}\.jsonl$/;
type Segment = { name: string; size: number; at: number };
type Snapshot = { sizes: Map<string, number>; bytes: number };
type Cursor = {
  before: string;
  ceiling: string;
  query: string;
  expires: number;
  anchor: string;
  snapshot: Snapshot;
};
const code = (error: unknown) => (error as NodeJS.ErrnoException)?.code;
const key = (record: LogRecord) => `${record.timestamp}:${record.id}`;
export const logProjectId = (directory: string) =>
  createHash("sha256").update(directory).digest("hex").slice(0, 16);

/** Private immutable/append-only JSONL segments. All readers, pruning and writers share a lock. */
export class DesktopLogStore {
  readonly appLaunchId = randomUUID();
  private readonly pending: string[] = [];
  private pendingBytes = 0;
  private draining: Promise<void> | undefined;
  private tail: Promise<unknown> = Promise.resolve();
  private readers = 0;
  private clearing = false;
  private closed = false;
  private corruptSegments = 0;
  private readonly cursors = new Map<string, Cursor>();
  private readonly listeners = new Set<() => void>();
  private notice: ReturnType<typeof setTimeout> | undefined;
  private readonly health: LogStatus = {
    dropped: 0,
    persistenceFailures: 0,
    unavailable: false,
    malformed: 0,
  };
  constructor(
    readonly directory: string,
    private readonly now: () => number = Date.now,
  ) {}

  readonly sink = (input: LogInput): void => {
    try {
      if (this.closed) return;
      const parsed = logInputSchema.safeParse(input);
      if (!parsed.success) {
        this.drop();
        return;
      }
      const [component, message] = LOG_EVENTS[parsed.data.event];
      const record: LogRecord = {
        ...parsed.data,
        version: 1,
        id: randomUUID(),
        timestamp: new Date(this.now()).toISOString(),
        severity: parsed.data.severity ?? (input.outcome === "failed" ? "error" : "info"),
        component,
        message,
        appLaunchId: this.appLaunchId,
      };
      const line = `${JSON.stringify(record)}\n`;
      const bytes = Buffer.byteLength(line);
      if (
        bytes > RECORD_BYTES ||
        this.pending.length >= 512 ||
        this.pendingBytes + bytes > QUEUE_BYTES
      ) {
        this.drop();
        return;
      }
      this.pending.push(line);
      this.pendingBytes += bytes;
      this.schedule();
    } catch {
      this.drop();
    }
  };

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  status(): LogStatus {
    return { ...this.health };
  }
  private changed(): void {
    if (this.notice || this.closed) return;
    this.notice = setTimeout(() => {
      this.notice = undefined;
      for (const listener of this.listeners) {
        try {
          listener();
        } catch {
          /* No lifecycle impact. */
        }
      }
    }, 40);
    this.notice.unref();
  }
  private drop(): void {
    this.health.dropped++;
    this.changed();
  }
  private failed(): void {
    this.health.persistenceFailures++;
    this.health.unavailable = true;
    this.changed();
  }
  private schedule(): void {
    if (this.draining) return;
    this.draining = this.serial(async () => {
      while (this.pending.length) {
        const lines = this.pending.splice(0, 256);
        const data = lines.join("");
        this.pendingBytes -= Buffer.byteLength(data);
        try {
          await this.locked(async () => {
            const segments = await this.prune();
            const bytes = Buffer.byteLength(data);
            let total = segments.reduce((sum, file) => sum + file.size, 0);
            while (total + bytes > LOG_QUOTA && segments.length) {
              const oldest = segments.shift();
              if (!oldest) break;
              await unlink(join(this.directory, oldest.name));
              total -= oldest.size;
            }
            let active = segments.at(-1);
            if (!active || active.size + bytes > SEGMENT_BYTES || this.now() - active.at >= 60_000)
              active = undefined;
            let appended = false;
            if (active) {
              const file = await this.safeFile(join(this.directory, active.name), "append");
              try {
                const end = Buffer.alloc(1);
                if (active.size) await file.read(end, 0, 1, active.size - 1);
                if (!active.size || end[0] === 10) {
                  await file.writeFile(data);
                  appended = true;
                }
              } finally {
                await file.close();
              }
            }
            // Never concatenate a healthy record onto a crash-truncated JSON line.
            if (!appended) {
              await writePrivateFile(
                join(this.directory, `${this.now()}-${randomUUID()}.jsonl`),
                data,
                { mode: 0o600, flag: "wx" },
              );
            }
            this.health.unavailable = false;
          });
        } catch {
          this.health.dropped += lines.length;
          this.failed();
        }
        this.changed();
      }
    }).finally(() => {
      this.draining = undefined;
      if (this.pending.length) this.schedule();
    });
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.catch(() => {});
    return result;
  }
  private async verify(path: string, directory: boolean): Promise<Stats> {
    const stat = await lstat(path);
    if (
      stat.isSymbolicLink() ||
      (directory ? !stat.isDirectory() : !stat.isFile()) ||
      (!directory && stat.nlink !== 1)
    )
      throw new Error("Unsafe diagnostic storage");
    if (process.platform === "win32") await helperOutput(["verify-private", path]);
    else if ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.())
      throw new Error("Unsafe diagnostic permissions");
    return stat;
  }
  private async prepare(): Promise<void> {
    // Check existing private ancestors before creating descendants. Never repair unsafe objects.
    for (const path of [dirname(this.directory), this.directory]) {
      try {
        await this.verify(path, true);
      } catch (error) {
        if (code(error) !== "ENOENT") throw error;
        await privateDirectory(path);
        await this.verify(path, true);
      }
    }
  }
  private async safeFile(path: string, access: "read" | "append" | "rewrite" = "read") {
    const checked = await this.verify(path, false);
    const handle = await open(
      path,
      (access === "read"
        ? constants.O_RDONLY
        : constants.O_RDWR | (access === "append" ? constants.O_APPEND : 0)) |
        (constants.O_NOFOLLOW ?? 0),
    );
    try {
      const stat = await handle.stat();
      const entry = await lstat(path);
      if (
        !stat.isFile() ||
        stat.nlink !== 1 ||
        stat.ino !== checked.ino ||
        stat.dev !== checked.dev ||
        stat.ino !== entry.ino ||
        stat.dev !== entry.dev ||
        (process.platform !== "win32" &&
          ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))
      )
        throw new Error("Diagnostic file changed");
      return handle;
    } catch (error) {
      await handle.close();
      throw error;
    }
  }
  private async locked<T>(operation: () => Promise<T>): Promise<T> {
    await this.prepare();
    const lock = join(this.directory, ".lock");
    const ownerName = `owner-${process.pid}-${randomUUID()}`;
    const deadline = performance.now() + 300;
    for (;;) {
      let created = false;
      try {
        // mkdir is exclusive on every platform. Windows inherits the verified private parent's ACL.
        await mkdir(lock, { mode: 0o700 });
        created = true;
        await this.verify(lock, true);
        await writePrivateFile(join(lock, ownerName), "", {
          mode: 0o600,
          flag: "wx",
        });
        break;
      } catch (error) {
        if (created) {
          await unlink(join(lock, ownerName)).catch(() => {});
          await rmdir(lock).catch(() => {});
          throw error;
        }
        if (code(error) !== "EEXIST") throw error;
        let stat: Stats;
        try {
          stat = await this.verify(lock, true);
        } catch (probe) {
          if (code(probe) === "ENOENT") continue;
          throw probe;
        }
        // Never steal from a live or unverifiable owner. Crashed locks are recovered only after 30s.
        if (Date.now() - stat.mtimeMs > 30_000) {
          const entries = await readdir(lock);
          const name = entries[0];
          const match = name && /^owner-([1-9]\d{0,9})-[a-f0-9-]{36}$/.exec(name);
          let gone = entries.length === 0;
          if (entries.length === 1 && match) {
            await this.verify(join(lock, name), false);
            try {
              process.kill(Number(match[1]), 0);
            } catch (probe) {
              gone = code(probe) === "ESRCH";
            }
          }
          if (gone) {
            // Unique owner filenames prevent a stale reclaimer unlinking a new owner's file.
            // If another reclaimer wins, ENOENT ends this attempt before rmdir.
            try {
              if (name) await unlink(join(lock, name));
              await rmdir(lock);
              continue;
            } catch (reclaimError) {
              if (!["ENOENT", "ENOTEMPTY"].includes(code(reclaimError) ?? "")) throw reclaimError;
            }
          }
        }
        if (performance.now() >= deadline) throw new Error("Diagnostic storage busy");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    try {
      return await operation();
    } finally {
      await unlink(join(lock, ownerName));
      await rmdir(lock);
    }
  }
  private async segments(): Promise<Segment[]> {
    const names = await readdir(this.directory);
    const result: Segment[] = [];
    for (const name of names) {
      const match = SEGMENT.exec(name);
      if (!match) continue;
      const path = join(this.directory, name);
      const stat = await this.verify(path, false);
      result.push({ name, size: stat.size, at: Number(match[1]) });
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }
  private async prune(): Promise<Segment[]> {
    let segments = await this.segments();
    let changed = false;
    const cutoff = this.now() - LOG_RETENTION_MS;
    for (const segment of segments) {
      if (segment.at + 60_000 <= cutoff || segment.size > SEGMENT_BYTES) {
        changed = true;
        if (segment.size > SEGMENT_BYTES) this.corruptSegments++;
        await unlink(join(this.directory, segment.name));
      } else if (segment.at <= cutoff) {
        changed = true;
        const path = join(this.directory, segment.name);
        const file = await this.safeFile(path);
        let data: string;
        try {
          data = await file.readFile("utf8");
        } finally {
          await file.close();
        }
        const retained = data
          .split("\n")
          .filter((line) => {
            if (!line) return false;
            try {
              const parsed = logRecordSchema.safeParse(JSON.parse(line));
              return !parsed.success || Date.parse(parsed.data.timestamp) > cutoff;
            } catch {
              return true;
            }
          })
          .join("\n");
        if (!retained) await unlink(path);
        else {
          // Shrink in place under the lock, never allocating a second on-disk quota.
          const target = await this.safeFile(path, "rewrite");
          try {
            const bytes = Buffer.from(`${retained}\n`);
            await target.write(bytes, 0, bytes.length, 0);
            await target.truncate(bytes.length);
          } finally {
            await target.close();
          }
        }
      }
    }
    if (changed) segments = await this.segments();
    let total = segments.reduce((sum, file) => sum + file.size, 0);
    while (total > LOG_QUOTA && segments.length) {
      const file = segments.shift();
      if (!file) break;
      await unlink(join(this.directory, file.name));
      total -= file.size;
    }
    return segments;
  }
  private async scan(
    segments: Segment[],
    visit: (record: LogRecord) => void,
    snapshot: Snapshot,
  ): Promise<number> {
    let malformed = 0;
    const buffer = Buffer.alloc(64 * 1024);
    for (const segment of segments) {
      let remaining = Math.min(segment.size, snapshot.sizes.get(segment.name) ?? 0);
      if (!remaining) continue;
      const file = await this.safeFile(join(this.directory, segment.name));
      try {
        let pending = Buffer.alloc(0);
        let dropping = false;
        for (;;) {
          if (remaining <= 0) break;
          const { bytesRead } = await file.read(
            buffer,
            0,
            Math.min(buffer.length, remaining),
            null,
          );
          if (!bytesRead) break;
          remaining -= bytesRead;
          const data = Buffer.concat([pending, buffer.subarray(0, bytesRead)]);
          let start = 0;
          for (let end = data.indexOf(10); end >= 0; end = data.indexOf(10, start)) {
            const line = data.subarray(start, end);
            start = end + 1;
            if (dropping || line.length > RECORD_BYTES) {
              malformed++;
              dropping = false;
              continue;
            }
            try {
              const result = logRecordSchema.safeParse(JSON.parse(line.toString("utf8")));
              if (!result.success) {
                malformed++;
                continue;
              }
              const at = Date.parse(result.data.timestamp);
              if (at > this.now() || at <= this.now() - LOG_RETENTION_MS) continue;
              visit(result.data);
            } catch {
              malformed++;
            }
          }
          pending = data.subarray(start);
          if (pending.length > RECORD_BYTES) {
            pending = Buffer.alloc(0);
            dropping = true;
          }
          // Yield control IPC between bounded parsing chunks, including a full-quota scan.
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
        if (pending.length || dropping) malformed++;
      } finally {
        await file.close();
      }
    }
    return malformed;
  }
  async query(query: LogQuery): Promise<LogPage> {
    if (this.readers >= 2) throw new Error("Diagnostic query busy. Retry.");
    this.readers++;
    try {
      return await this.serial(() =>
        this.locked(async () => {
          const signature = JSON.stringify({ ...query, cursor: undefined });
          const cursor = query.cursor ? this.cursors.get(query.cursor) : undefined;
          const retained = await this.prune();
          const empty = (state: LogPage["state"]): LogPage => ({
            records: [],
            cursor: null,
            state,
            status: this.status(),
            appLaunchId: this.appLaunchId,
          });
          if (
            query.cursor &&
            (!cursor || cursor.expires <= this.now() || cursor.query !== signature)
          )
            return empty("expired-cursor");
          const records: LogRecord[] = [];
          let anchorFound = !cursor;
          const ceiling = cursor?.ceiling ?? `${new Date(this.now()).toISOString()}:\uffff`;
          const snapshot = cursor?.snapshot ?? {
            sizes: new Map(retained.map((segment) => [segment.name, segment.size])),
            bytes: retained.reduce((sum, segment) => sum + Buffer.byteLength(segment.name) + 64, 0),
          };
          this.health.malformed =
            this.corruptSegments +
            (await this.scan(
              retained,
              (record) => {
                if (record.id === cursor?.anchor) anchorFound = true;
                const order = key(record);
                if (
                  order > ceiling ||
                  (cursor && order >= cursor.before) ||
                  !matchesLog(record, query, this.now())
                )
                  return;
                let low = 0;
                let high = records.length;
                while (low < high) {
                  const middle = (low + high) >>> 1;
                  if (key(records[middle] as LogRecord) > order) low = middle + 1;
                  else high = middle;
                }
                records.splice(low, 0, record);
                if (records.length > query.limit + 1) records.pop();
              },
              snapshot,
            ));
          this.health.unavailable = false;
          if (!anchorFound) return empty("expired-cursor");
          let next: string | null = null;
          if (records.length > query.limit) {
            records.pop();
            const last = records.at(-1);
            if (last) {
              next = randomUUID();
              for (const [id, entry] of this.cursors)
                if (entry.expires <= this.now()) this.cursors.delete(id);
              const snapshotBytes = () =>
                [
                  ...new Set([
                    snapshot,
                    ...[...this.cursors.values()].map((entry) => entry.snapshot),
                  ]),
                ].reduce((sum, entry) => sum + entry.bytes, 0);
              if (snapshot.bytes > 2 * 1024 * 1024)
                throw new Error("Diagnostic cursor metadata limit exceeded");
              while (this.cursors.size >= 128 || snapshotBytes() > 2 * 1024 * 1024)
                this.cursors.delete(this.cursors.keys().next().value as string);
              this.cursors.set(next, {
                before: key(last),
                ceiling,
                query: signature,
                expires: this.now() + 300_000,
                anchor: last.id,
                snapshot,
              });
            }
          }
          return {
            records,
            cursor: next,
            state: "ready",
            status: this.status(),
            appLaunchId: this.appLaunchId,
          };
        }),
      );
    } catch {
      this.failed();
      throw new Error(
        "Diagnostic logs unavailable. Check private storage permissions or free space and retry.",
      );
    } finally {
      this.readers--;
    }
  }
  async detail(id: string): Promise<LogRecord | null> {
    const page = await this.query({
      scope: "all",
      limit: 1,
      search: id,
      conditions: [],
      columnConditions: [],
      match: "all",
    });
    return page.records.find((record) => record.id === id) ?? null;
  }
  async clear(): Promise<void> {
    if (this.clearing) throw new Error("Diagnostic clear already in progress");
    this.clearing = true;
    // Include writes accepted before confirmation, but not subsequent lifecycle events.
    const drain = this.draining;
    try {
      await drain;
      await this.serial(() =>
        this.locked(async () => {
          for (const file of await this.segments()) await unlink(join(this.directory, file.name));
          this.cursors.clear();
          this.health.malformed = 0;
          this.corruptSegments = 0;
          this.changed();
        }),
      );
    } catch {
      this.failed();
      throw new Error("Could not clear diagnostic logs. Retry.");
    } finally {
      this.clearing = false;
    }
  }
  async flush(timeoutMs = 500): Promise<boolean> {
    const draining = this.draining;
    if (!draining) return true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        draining.then(() => true),
        new Promise<false>((resolve) => {
          timer = setTimeout(() => resolve(false), Math.max(0, Math.min(timeoutMs, 2000)));
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async close(): Promise<boolean> {
    this.closed = true;
    clearTimeout(this.notice);
    this.listeners.clear();
    this.cursors.clear();
    const flushed = await this.flush();
    this.health.dropped += this.pending.length;
    this.pending.length = 0;
    this.pendingBytes = 0;
    return flushed;
  }
}

function matchesLog(record: LogRecord, query: LogQuery, now: number): boolean {
  if (query.projectId && record.projectId && record.projectId !== query.projectId) return false;
  if (query.appLaunchId && record.appLaunchId !== query.appLaunchId) return false;
  if (
    query.search &&
    !Object.values(record).join(" ").toLowerCase().includes(query.search.toLowerCase())
  )
    return false;
  const matches = (condition: LogQuery["conditions"][number]) => {
    const raw = record[condition.column];
    const empty = raw === undefined || raw === "";
    if (condition.op === "empty") return empty;
    if (condition.op === "present") return !empty;
    if (empty) return false;
    const actual =
      condition.column === "durationMs"
        ? Number(raw)
        : condition.column === "timestamp"
          ? Date.parse(String(raw))
          : String(raw).toLowerCase();
    const expected =
      condition.column === "durationMs"
        ? Number(condition.value)
        : condition.column === "timestamp"
          ? Date.parse(condition.value)
          : condition.value.toLowerCase();
    switch (condition.op) {
      case "contains":
        return String(raw).toLowerCase().includes(condition.value.toLowerCase());
      case "eq":
        return actual === expected;
      case "ne":
        return actual !== expected;
      case "ge":
        return actual >= expected;
      case "le":
        return actual <= expected;
      case "recent":
        return (
          typeof actual === "number" &&
          actual >= now - Number(condition.value) * 60_000 &&
          actual <= now
        );
      case "older":
        return typeof actual === "number" && actual < now - Number(condition.value) * 60_000;
    }
  };
  return (
    query.columnConditions.every(matches) &&
    (!query.conditions.length ||
      (query.match === "all" ? query.conditions.every(matches) : query.conditions.some(matches)))
  );
}
