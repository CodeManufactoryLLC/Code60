import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emitLog, type LogInput, logRecordSchema, parseLogQuery } from "../bridge/index.js";
import * as platform from "../platform/index.js";
import { privateDirectory, writePrivateFile } from "../platform/index.js";
import { DesktopLogStore, LOG_QUOTA, LOG_RETENTION_MS } from "./log-store.js";

const directories: string[] = [];
const stores: DesktopLogStore[] = [];
const now = Date.parse("2026-11-09T12:00:00.000Z");
const input = (overrides: Partial<LogInput> = {}): LogInput => ({
  event: "app.start",
  outcome: "started",
  operationId: randomUUID(),
  ...overrides,
});
async function fixture(clock: () => number = () => now) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "code60-logs-")));
  directories.push(root);
  const directory = join(root, "code60", "logs");
  const store = new DesktopLogStore(directory, clock);
  stores.push(store);
  return { root, directory, store };
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(stores.splice(0).map((store) => store.close()));
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function files(directory: string) {
  return (await readdir(directory)).filter((name) => name.endsWith(".jsonl"));
}
async function bytes(directory: string) {
  const sizes = await Promise.all(
    (await files(directory)).map(async (file) => (await stat(join(directory, file))).size),
  );
  return sizes.reduce((a, b) => a + b, 0);
}

describe("desktop diagnostic storage", () => {
  it("persists strictly allowlisted records across launch IDs and rejects content before encoding", async () => {
    const { store, directory } = await fixture();
    store.sink(input({ event: "turn.end", outcome: "succeeded", runId: "r1", durationMs: 12 }));
    for (const text of ["api_key=secret", "雪".repeat(10000), "/Users/private", "Bearer secret"]) {
      store.sink({ ...input(), message: text } as LogInput);
      store.sink(input({ provider: text as "claude" }));
    }
    await store.flush(2000);
    const restarted = new DesktopLogStore(directory, () => now);
    stores.push(restarted);
    const page = await restarted.query(parseLogQuery({}));
    expect(page.records).toHaveLength(1);
    expect(page.records[0]).toMatchObject({
      version: 1,
      event: "turn.end",
      message: "Agent turn completed",
      durationMs: 12,
    });
    expect(page.records[0]?.appLaunchId).not.toBe(restarted.appLaunchId);
    expect(store.status().dropped).toBe(8);
    for (const file of await files(directory)) {
      const text = await readFile(join(directory, file), "utf8");
      expect(text).not.toMatch(/secret|雪|Users/);
      expect(Buffer.byteLength(text)).toBeLessThan(2048);
      expect(logRecordSchema.safeParse(JSON.parse(text)).success).toBe(true);
      if (process.platform !== "win32")
        expect((await lstat(join(directory, file))).mode & 0o077).toBe(0);
    }
  });
  it("bounds queues, coalesces notices, and never calls a throwing sink into lifecycle code", async () => {
    const { store } = await fixture();
    const notice = vi.fn();
    store.subscribe(notice);
    for (let index = 0; index < 5000; index++) store.sink(input());
    expect(store.status().dropped).toBeGreaterThanOrEqual(4488);
    await store.flush(2000);
    await vi.waitFor(() => expect(notice).toHaveBeenCalled(), { interval: 5 });
    expect(notice.mock.calls.length).toBeLessThan(5);
    expect(() =>
      emitLog(() => {
        throw new Error("observer failed");
      }, input()),
    ).not.toThrow();
  });
  it("filters the entire history, pages without duplicates, and invalidates expired or cleared cursors", async () => {
    const { store } = await fixture();
    for (let index = 0; index < 12; index++)
      store.sink(
        input({
          event: "turn.end",
          outcome: index % 2 ? "failed" : "succeeded",
          runId: `r${index}`,
          ...(index % 3 ? { projectId: "aaaaaaaaaaaaaaaa" } : {}),
        }),
      );
    store.sink(input({ projectId: "bbbbbbbbbbbbbbbb" }));
    await store.flush(2000);
    const query = parseLogQuery({
      limit: 3,
      projectId: "aaaaaaaaaaaaaaaa",
      conditions: [{ column: "outcome", op: "eq", value: "failed" }],
    });
    const first = await store.query(query);
    const second = await store.query({ ...query, cursor: first.cursor as string });
    expect(first.records).toHaveLength(3);
    expect(second.records).toHaveLength(3);
    expect(new Set([...first.records, ...second.records].map((record) => record.id)).size).toBe(6);
    expect(await store.detail(first.records[0]?.id as string)).toEqual(first.records[0]);
    expect(
      (await store.query({ ...query, cursor: first.cursor as string, search: "different" })).state,
    ).toBe("expired-cursor");
    await store.clear();
    expect((await store.query({ ...query, cursor: first.cursor as string })).state).toBe(
      "expired-cursor",
    );
    expect((await store.query(parseLogQuery({}))).records).toEqual([]);
    expect(await store.detail(randomUUID())).toBeNull();
  });
  it("expires records at exactly seven days, including boundary segments", async () => {
    let time = now;
    const { store, directory } = await fixture(() => time);
    store.sink(input());
    await store.flush(2000);
    time += 1000;
    store.sink(input({ event: "app.ready", outcome: "succeeded" }));
    await store.flush(2000);
    time = now + LOG_RETENTION_MS;
    expect((await store.query(parseLogQuery({}))).records.map((record) => record.event)).toEqual([
      "app.ready",
    ]);
    const text = (
      await Promise.all(
        (await files(directory)).map((file) => readFile(join(directory, file), "utf8")),
      )
    ).join("");
    expect(text).not.toContain('"event":"app.start"');
    time += 1000;
    expect((await store.query(parseLogQuery({}))).records).toEqual([]);
    expect(await bytes(directory)).toBe(0);
  });
  it("pins cursor reads to file byte boundaries even when later writes share the same millisecond", async () => {
    const { store, directory } = await fixture();
    for (let index = 0; index < 12; index++) store.sink(input({ runId: `original-${index}` }));
    await store.flush(2000);
    const query = parseLogQuery({ limit: 3 });
    let page = await store.query(query);
    const records = [...page.records];
    for (let index = 0; index < 40; index++) store.sink(input({ runId: `later-${index}` }));
    await store.flush(2000);
    while (page.cursor) {
      page = await store.query({ ...query, cursor: page.cursor });
      records.push(...page.records);
    }
    expect(records).toHaveLength(12);
    expect(records.every((record) => record.runId?.startsWith("original-"))).toBe(true);
    expect(new Set(records.map((record) => record.id)).size).toBe(12);
    const latest = await store.query(query);
    const other = new DesktopLogStore(directory, () => now);
    stores.push(other);
    await other.clear();
    expect((await store.query({ ...query, cursor: latest.cursor as string })).state).toBe(
      "expired-cursor",
    );
  });
  it("prunes on stale cursor reads and never clears neighboring authoritative data", async () => {
    let time = now;
    const { store, root, directory } = await fixture(() => time);
    store.sink(input());
    await store.flush(2000);
    await writeFile(join(root, "run.json"), "authoritative");
    time += LOG_RETENTION_MS;
    expect((await store.query(parseLogQuery({ cursor: randomUUID() }))).state).toBe(
      "expired-cursor",
    );
    expect(await bytes(directory)).toBe(0);
    await store.clear();
    expect(await readFile(join(root, "run.json"), "utf8")).toBe("authoritative");
    await writePrivateFile(
      join(directory, `${time}-${randomUUID()}.jsonl`),
      "x".repeat(256 * 1024 + 1),
      { mode: 0o600, flag: "wx" },
    );
    expect((await store.query(parseLogQuery({}))).status.malformed).toBeGreaterThan(0);
    expect(await bytes(directory)).toBe(0);
  });
  it("does not crash or claim complete history after malformed, oversize or truncated input", async () => {
    const { store, directory } = await fixture();
    store.sink(input());
    await store.flush(2000);
    const file = join(directory, (await files(directory))[0] as string);
    await writeFile(
      file,
      `${await readFile(file, "utf8")}invalid\n${"雪".repeat(3000)}\n{"unfinished":`,
    );
    const page = await store.query(parseLogQuery({}));
    expect(page.records).toHaveLength(1);
    expect(page.status.malformed).toBe(3);
    store.sink(input({ event: "app.ready", outcome: "succeeded" }));
    await store.flush(2000);
    expect((await store.query(parseLogQuery({ search: "app.ready" }))).records).toHaveLength(1);
  });
  it.each(["ENOSPC", "EACCES"])(
    "contains %s failures and recovers without recursively logging",
    async (errorCode) => {
      const { store } = await fixture();
      const write = platform.writePrivateFile;
      const spy = vi
        .spyOn(platform, "writePrivateFile")
        .mockImplementation((path, data, options) =>
          path.endsWith(".jsonl")
            ? Promise.reject(
                Object.assign(new Error("private path and credential"), { code: errorCode }),
              )
            : write(path, data, options),
        );
      store.sink(input());
      await store.flush(2000);
      expect(store.status()).toMatchObject({
        persistenceFailures: 1,
        dropped: 1,
        unavailable: true,
      });
      spy.mockRestore();
      store.sink(input({ event: "app.ready", outcome: "succeeded" }));
      await store.flush(2000);
      const page = await store.query(parseLogQuery({}));
      expect(page.records).toHaveLength(1);
      expect(page.records[0]?.event).toBe("app.ready");
      expect(page.status).toMatchObject({ persistenceFailures: 1, dropped: 1, unavailable: false });
    },
  );
  it("reclaims a crashed stale writer lock but never a live or unverifiable owner", async () => {
    const { store, directory } = await fixture();
    await privateDirectory(directory);
    const lock = join(directory, ".lock");
    await privateDirectory(lock);
    const dead = 2147483647;
    await writePrivateFile(join(lock, `owner-${dead}-${randomUUID()}`), "", {
      mode: 0o600,
      flag: "wx",
    });
    const past = new Date(Date.now() - 31000);
    await utimes(lock, past, past);
    store.sink(input());
    await store.flush(2000);
    expect((await store.query(parseLogQuery({}))).records).toHaveLength(1);
    expect(store.status().persistenceFailures).toBe(0);
    await privateDirectory(lock);
    await writePrivateFile(join(lock, `owner-${process.pid}-${randomUUID()}`), "", {
      mode: 0o600,
      flag: "wx",
    });
    await utimes(lock, past, past);
    await expect(store.query(parseLogQuery({}))).rejects.toThrow(/unavailable/);
  });
  it("applies typed saved conditions, column conditions and launch/time filters across retained records", async () => {
    const { store, directory } = await fixture();
    store.sink(input({ event: "turn.end", runId: "new", provider: "claude", durationMs: 20 }));
    await store.flush(2000);
    const other = new DesktopLogStore(directory, () => now - 120000);
    stores.push(other);
    other.sink(input({ event: "turn.end", runId: "old", provider: "codex", durationMs: 5 }));
    await other.flush(2000);
    const count = async (conditions: unknown[], extra = {}) =>
      (await store.query(parseLogQuery({ conditions, ...extra }))).records.length;
    expect(await count([{ column: "durationMs", op: "ge", value: "20" }])).toBe(1);
    expect(await count([{ column: "durationMs", op: "le", value: "5" }])).toBe(1);
    expect(await count([{ column: "provider", op: "ne", value: "claude" }])).toBe(1);
    expect(await count([{ column: "runId", op: "contains", value: "ol" }])).toBe(1);
    expect(await count([{ column: "timestamp", op: "recent", value: "1" }])).toBe(1);
    expect(await count([{ column: "timestamp", op: "older", value: "1" }])).toBe(1);
    expect(await count([{ column: "projectId", op: "empty", value: "" }])).toBe(2);
    expect(await count([{ column: "projectId", op: "present", value: "" }])).toBe(0);
    expect(await count([], { appLaunchId: store.appLaunchId })).toBe(1);
    expect(
      await count(
        [
          { column: "provider", op: "eq", value: "claude" },
          { column: "runId", op: "eq", value: "old" },
        ],
        { match: "any", columnConditions: [{ column: "durationMs", op: "ge", value: "20" }] },
      ),
    ).toBe(1);
  });
  it.skipIf(process.platform === "win32")(
    "rejects unsafe private directories, links, and permissions without modifying targets",
    async () => {
      const { root, store, directory } = await fixture();
      await privateDirectory(join(root, "code60"));
      await symlink(root, directory);
      store.sink(input());
      await store.flush(2000);
      expect(store.status()).toMatchObject({
        dropped: 1,
        persistenceFailures: 1,
        unavailable: true,
      });
      await expect(store.query(parseLogQuery({}))).rejects.toThrow(/unavailable/);
      await rm(directory);
      await privateDirectory(directory);
      const target = join(root, "target");
      await writeFile(target, "must stay", { mode: 0o600 });
      const name = `${now}-${randomUUID()}.jsonl`;
      await symlink(target, join(directory, name));
      await expect(store.query(parseLogQuery({}))).rejects.toThrow();
      expect(await readFile(target, "utf8")).toBe("must stay");
      await rm(join(directory, name));
      await chmod(directory, 0o755);
      await expect(store.clear()).rejects.toThrow(/clear/);
      expect((await stat(directory)).mode & 0o777).toBe(0o755);
      await chmod(directory, 0o700);
    },
  );
  it("coordinates competing instances and keeps accepted records intact", async () => {
    const { store, directory } = await fixture();
    const other = new DesktopLogStore(directory, () => now);
    stores.push(other);
    for (let index = 0; index < 40; index++) {
      store.sink(input({ runId: `a${index}` }));
      other.sink(input({ runId: `b${index}` }));
    }
    await Promise.all([store.flush(2000), other.flush(2000)]);
    const page = await store.query(parseLogQuery({}));
    expect(page.records).toHaveLength(80);
    expect(new Set(page.records.map((record) => record.id)).size).toBe(80);
    expect(page.status).toMatchObject({ malformed: 0, persistenceFailures: 0, dropped: 0 });
  });
  it("rotates at the full 20 MiB cap, counting every active segment", async () => {
    const { store, directory } = await fixture();
    store.sink(input());
    await store.flush(2000);
    await store.clear();
    const record = {
      ...input(),
      version: 1,
      id: randomUUID(),
      timestamp: new Date(now).toISOString(),
      severity: "info",
      component: "desktop",
      message: "Desktop startup started",
      appLaunchId: store.appLaunchId,
    };
    const json = JSON.stringify(record);
    const line = `${json}${" ".repeat(1023 - Buffer.byteLength(json))}\n`;
    expect(Buffer.byteLength(line)).toBe(1024);
    for (let index = 0; index < 80; index++) {
      await writePrivateFile(
        join(directory, `${now - 80 + index}-${randomUUID()}.jsonl`),
        line.repeat(256),
        { mode: 0o600, flag: "wx" },
      );
    }
    expect(await bytes(directory)).toBe(LOG_QUOTA);
    store.sink(input({ event: "app.ready", outcome: "succeeded" }));
    await store.flush(2000);
    expect(await bytes(directory)).toBeLessThanOrEqual(LOG_QUOTA);
    const page = await store.query(parseLogQuery({ limit: 1, search: "app.ready" }));
    expect(page.records[0]?.event).toBe("app.ready");
    expect(page.status.unavailable).toBe(false);
  }, 15_000);
  it("bounds lock waits and shutdown while preserving failure counts", async () => {
    const { store, directory } = await fixture();
    await privateDirectory(directory);
    await mkdir(join(directory, ".lock"), { mode: 0o700 });
    await writePrivateFile(join(directory, ".lock", "owner"), String(process.pid), {
      mode: 0o600,
      flag: "wx",
    });
    store.sink(input());
    const start = performance.now();
    expect(await store.flush(1)).toBe(false);
    await store.close();
    expect(performance.now() - start).toBeLessThan(1500);
    expect(store.status()).toMatchObject({ persistenceFailures: 1, dropped: 1 });
  });
});
