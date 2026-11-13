import { randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, open, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import type { SavedChat } from "../bridge/index.js";
import { ChatStore } from "./chat-store.js";
import { captureTask } from "./tactic-context.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "code60-chats-"));
  roots.push(root);
  const record: SavedChat = {
    format: 1,
    directoryId: randomUUID(),
    runId: "chat-1",
    provider: "claude",
    commandHash: "a".repeat(64),
    archived: false,
    selectedAt: 1,
    tasks: [],
  };
  return {
    root,
    record,
    store: new ChatStore(root),
    file: join(root, "chats", `${record.directoryId}.json`),
  };
}
it("roundtrips private legacy, selected and explicitly cleared records with frozen tasks", async () => {
  const { root, record, store, file } = await setup();
  expect(await store.load()).toEqual({ chats: [], errors: [] });
  await store.save(record);
  expect((await store.load()).chats[0]).not.toHaveProperty("tactic");
  record.tactic = "independent-review";
  const task = captureTask(record.tactic, "Review task", 1, "/project");
  record.tasks.push(task);
  record.taskId = task.id;
  await store.save(record);
  record.tactic = null;
  record.title = "Named chat";
  record.archived = true;
  await store.save(record);
  expect((await new ChatStore(root).load()).chats).toEqual([record]);
  expect(JSON.parse(await readFile(file, "utf8")).tasks[0].tactic.prompt).toContain(
    "fresh reviewer",
  );
  if (process.platform !== "win32") expect((await lstat(file)).mode & 0o777).toBe(0o600);
  await mkdir(join(root, record.directoryId));
  expect(await store.directory(record.directoryId)).toBe(join(root, record.directoryId));
  await expect(store.directory("../other")).rejects.toThrow();
});
it("reports malformed, oversized, and wrong-identity records without deleting them", async () => {
  const { record, store, file } = await setup();
  await store.save(record);
  for (const content of [
    "{",
    JSON.stringify({ ...record, directoryId: randomUUID() }),
    " ".repeat(16 * 1_048_576 + 1),
    JSON.stringify({ ...record, taskId: randomUUID() }),
    JSON.stringify({ ...record, tasks: Array(2).fill(captureTask(null, "Task", 1, null)) }),
  ]) {
    await writeFile(file, content);
    const result = await store.load();
    expect(result.chats).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect((await lstat(file)).isFile()).toBe(true);
  }
});

it("bounds history reads and only accepts derived run files", async () => {
  const { root, record, store } = await setup();
  const run = join(root, record.directoryId, ".code60", "runs", record.runId);
  await mkdir(run, { recursive: true });
  const path = join(run, "run.json");
  await writeFile(path, "{}");
  expect(await store.readHistory(record.directoryId, record.runId, path)).toBe("{}");
  await expect(store.readHistory(record.directoryId, "../other", path)).rejects.toThrow();
  await expect(
    store.readHistory(record.directoryId, record.runId, join(root, "other")),
  ).rejects.toThrow("Unknown");
  for (const [name, size] of [
    ["run.json", 1_048_577],
    ["events.jsonl", 32 * 1_048_576 + 1],
  ] as const) {
    const file = await open(join(run, name), "w");
    try {
      await file.truncate(size);
    } finally {
      await file.close();
    }
    await expect(
      store.readHistory(record.directoryId, record.runId, join(run, name)),
    ).rejects.toThrow("oversized");
  }
});

it.skipIf(process.platform === "win32")(
  "rejects linked history files and every history ancestor",
  async () => {
    for (const components of [
      [".code60"],
      [".code60", "runs"],
      [".code60", "runs", "chat-1"],
      [".code60", "runs", "chat-1", "run.json"],
    ]) {
      const { root, record, store } = await setup();
      const parent = join(root, record.directoryId, ...components.slice(0, -1));
      await mkdir(parent, { recursive: true });
      const target = join(root, "elsewhere");
      if (components.length === 4) await writeFile(target, "{}");
      else await mkdir(target);
      await symlink(target, join(parent, components.at(-1) as string));
      await expect(
        store.readHistory(
          record.directoryId,
          record.runId,
          join(root, record.directoryId, ".code60", "runs", record.runId, "run.json"),
        ),
      ).rejects.toThrow(/Unsafe/);
    }
  },
);
it.skipIf(process.platform === "win32")(
  "rejects linked records, metadata directories and saved chat directories",
  async () => {
    const { root, record, store, file } = await setup();
    await store.save(record);
    const target = join(root, "target");
    await writeFile(target, JSON.stringify(record));
    await rm(file);
    await symlink(target, file);
    expect((await store.load()).errors).toHaveLength(1);
    await expect(store.save(record)).rejects.toThrow("Unsafe");
    await symlink(join(root, "chats"), join(root, record.directoryId));
    await expect(store.directory(record.directoryId)).rejects.toThrow("unsafe");
    await rm(join(root, "chats"), { recursive: true });
    await mkdir(join(root, "elsewhere"));
    await symlink(join(root, "elsewhere"), join(root, "chats"));
    await expect(store.load()).rejects.toThrow();
  },
);
it("preserves valid records after rejected writes and serializes concurrent selection changes", async () => {
  const { record, store } = await setup();
  await store.save(record);
  await expect(store.save({ ...record, format: 2 } as unknown as SavedChat)).rejects.toThrow();
  await Promise.all([
    store.save({ ...record, tactic: "independent-review" }),
    store.save({ ...record, tactic: null }),
  ]);
  expect((await store.load()).chats[0]?.tactic).toBeNull();
});

it("reserves read-only snapshots between pending and subsequent metadata writes", async () => {
  const { record, store } = await setup();
  const first = store.save({ ...record, title: "Before" });
  const snapshot = store.snapshot();
  const next = store.save({ ...record, title: "After" });
  await first;
  expect((await snapshot).chats[0]?.title).toBe("Before");
  await next;
  expect((await store.snapshot()).chats[0]?.title).toBe("After");
});
