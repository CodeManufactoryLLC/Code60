import { randomUUID } from "node:crypto";
import {
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { type RelaySourceCursor, RelayStore } from "./relay-store.js";

let directory: string;
let stores: RelayStore[];
beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), "code60-relay-")));
  stores = [];
});
afterEach(async () => {
  await Promise.allSettled(stores.map((store) => store.close()));
  await rm(directory, { recursive: true, force: true });
});
async function open() {
  const store = await RelayStore.open(join(directory, "code60", "relay"));
  stores.push(store);
  return store;
}
it("retains one identity and workspace across generations and excludes competing writers", async () => {
  const first = await open();
  await expect(open()).rejects.toThrow("already open");
  await first.beginGeneration("run-one");
  await first.append({
    id: randomUUID(),
    role: "human",
    at: new Date().toISOString(),
    text: "Keep this source\n",
  });
  await first.close();
  const second = await open();
  expect(second.id).toBe(first.id);
  expect(second.generation).toBe(1);
  expect(second.workspace).toBe(first.workspace);
  expect((await second.history()).messages[0]?.text).toBe("Keep this source\n");
  expect(await stat(join(second.workspace, ".git")).catch(() => null)).toBeNull();
  if (process.platform !== "win32") {
    expect((await stat(second.workspace)).mode & 0o777).toBe(0o700);
    expect((await stat(join(second.root, "state.json"))).mode & 0o777).toBe(0o600);
  }
});
it("reads a bounded tail of a long-lived journal and preserves oversized Unicode source", async () => {
  const store = await open();
  const at = new Date().toISOString();
  const text = "😀文".repeat(150_000);
  await store.append({ id: randomUUID(), role: "assistant", at, text });
  const bytes = (await stat(join(store.root, "history.frames"))).size;
  const recent = await store.history();
  expect(recent.characters).toBeLessThanOrEqual(64_000);
  expect(recent.characters).toBeGreaterThan(32_000);
  expect(recent.older).toBe(true);
  expect(recent.messages[0]?.partial).toBe(true);
  expect(recent.bytesRead).toBeLessThan(512_000);
  expect(recent.bytesRead).toBeLessThan(bytes);
  expect((await stat(join(store.root, "history.frames"))).size).toBe(bytes);
  const older = await store.history(recent.cursor);
  expect(older.characters).toBeLessThanOrEqual(64_000);
  expect(older.bytesRead).toBeLessThan(512_000);
});
it("shows corrupt/incomplete tails and never appends across them", async () => {
  const store = await open();
  await appendFile(join(store.root, "history.frames"), "incomplete");
  expect((await store.history()).incomplete).toBe(true);
  await expect(
    store.append({ id: randomUUID(), role: "human", at: new Date().toISOString(), text: "new" }),
  ).rejects.toThrow("incomplete tail");
  expect(await readFile(join(store.root, "history.frames"), "utf8")).toBe("incomplete");
});
it("does not silently recreate missing workspaces or malformed metadata", async () => {
  const store = await open();
  await store.close();
  await rm(store.workspace, { recursive: true });
  await expect(open()).rejects.toThrow();
  await mkdir(store.workspace, { mode: 0o700 });
  await writeFile(join(store.root, "state.json"), "{}");
  await expect(open()).rejects.toThrow();
});
it.skipIf(process.platform === "win32")(
  "refuses unsafe permissions and symbolic links",
  async () => {
    const store = await open();
    await store.close();
    await chmod(store.workspace, 0o755);
    await expect(open()).rejects.toThrow("permissions");
    await chmod(store.workspace, 0o700);
    const state = join(store.root, "state.json");
    const original = await readFile(state);
    await rm(state);
    const other = join(directory, "other");
    await writeFile(other, original, { mode: 0o600 });
    await symlink(other, state);
    await expect(open()).rejects.toThrow("Unsafe");
  },
);
it("never displaces an unverifiable lock owner", async () => {
  const store = await open();
  await store.close();
  await mkdir(join(store.root, ".writer"), { mode: 0o700 });
  await expect(open()).rejects.toThrow("cannot be verified");
});

it("pages every original Unicode fragment exactly once without gaps or duplication", async () => {
  const store = await open();
  const at = new Date().toISOString();
  const originals = [
    { id: randomUUID(), role: "human" as const, at, text: "Earlier request\n" },
    { id: randomUUID(), role: "assistant" as const, at, text: "😀文\n".repeat(100_000) },
    { id: randomUUID(), role: "human" as const, at, text: "Latest request\n" },
  ];
  for (const original of originals) await store.append(original);
  const pages: Awaited<ReturnType<RelayStore["history"]>>[] = [];
  let before: number | undefined;
  for (let count = 0; count < 32; count++) {
    const page = await store.history(before);
    expect(page.incomplete).toBe(false);
    expect(page.characters).toBeLessThanOrEqual(64_000);
    expect(page.bytesRead).toBeLessThan(512_000);
    pages.unshift(page);
    if (!page.older) break;
    if (before !== undefined) expect(page.cursor).toBeLessThan(before);
    before = page.cursor;
  }
  expect(pages[0]?.older).toBe(false);
  for (const original of originals)
    expect(
      pages
        .flatMap((page) => page.messages)
        .filter((message) => message.id === original.id)
        .map((message) => message.text)
        .join(""),
    ).toBe(original.text);
});

it("persists incomplete evidence even when every retained frame is valid", async () => {
  const store = await open();
  await store.markIncomplete();
  await store.close();
  const reopened = await open();
  expect((await reopened.history()).incomplete).toBe(true);
});

it("never recreates metadata removed while the store is open", async () => {
  const store = await open();
  await rm(join(store.root, "state.json"));
  await expect(store.beginGeneration("another-run")).rejects.toThrow();
  await expect(stat(join(store.root, "state.json"))).rejects.toMatchObject({ code: "ENOENT" });
});

it("does not overwrite externally changed metadata while the store is open", async () => {
  const store = await open();
  const path = join(store.root, "state.json");
  const changed = { ...JSON.parse(await readFile(path, "utf8")), generation: 42 };
  await writeFile(path, JSON.stringify(changed));
  await expect(store.beginGeneration("another-run")).rejects.toThrow("metadata changed");
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual(changed);
});

it("marks invalid UTF-8 frames incomplete rather than silently replacing original bytes", async () => {
  const store = await open();
  const record = Buffer.from(
    JSON.stringify({
      id: randomUUID(),
      role: "human",
      at: new Date().toISOString(),
      text: "source",
      start: true,
    }),
  );
  const offset = record.indexOf(Buffer.from("source"));
  record[offset] = 0xff;
  await appendFile(
    join(store.root, "history.frames"),
    Buffer.concat([record, Buffer.from(`\n${record.length.toString(16).padStart(8, "0")}\n`)]),
  );
  expect((await store.history()).incomplete).toBe(true);
});

it("reads exact original Unicode source from both tail and middle display excerpts", async () => {
  const store = await open();
  const at = new Date().toISOString();
  const id = randomUUID();
  const original = "  Head\n" + "😀文\n".repeat(40_000) + "\nTail \t\n";
  await store.append({ id: randomUUID(), role: "human", at, text: "Before" });
  await store.append({ id, role: "assistant", at, text: original });
  await store.append({ id: randomUUID(), role: "human", at, text: "After" });
  const latest = await store.history();
  const middle = await store.history(latest.cursor);
  for (const page of [latest, middle]) {
    const excerpt = page.messages.find((message) => message.id === id);
    if (!excerpt?.sourceEnd) throw new Error("Missing source fixture");
    expect(excerpt.partial).toBe(true);
    let cursor: RelaySourceCursor | null = {
      direction: "backward",
      position: excerpt.sourceEnd,
      bound: page.sourceBound,
    };
    const parts: string[] = [];
    for (let count = 0; cursor && count < 100; count++) {
      const source = await store.source(id, cursor);
      expect(source.bytesRead).toBeLessThanOrEqual(132_106);
      parts.push(source.text);
      cursor = source.next;
    }
    expect(cursor).toBeNull();
    expect(parts.join("")).toBe(original);
    expect(page.characters).toBeLessThanOrEqual(64_000);
  }
});

it("pins source reads before later appended fragments and refuses wrong or missing source", async () => {
  const store = await open();
  const id = randomUUID();
  const at = new Date().toISOString();
  await store.append({ id, role: "human", at, text: "Original\n" });
  const history = await store.history();
  const position = history.messages[0]?.sourceEnd;
  if (!position) throw new Error("Missing source fixture");
  const cursor: RelaySourceCursor = {
    direction: "backward",
    position,
    bound: history.sourceBound,
  };
  await store.append({ id, role: "human", at, text: "Later continuation" }, false);
  expect(await store.source(id, cursor)).toMatchObject({ text: "Original\n", next: null });
  await expect(store.source(randomUUID(), cursor)).rejects.toThrow("incomplete");
  await expect(store.source(id, { ...cursor, bound: Number.MAX_SAFE_INTEGER })).rejects.toThrow(
    "unavailable",
  );
  await store.close();
  await expect(store.source(id, cursor)).rejects.toThrow("closed");
});

it("rejects corrupt source bodies rather than copying substituted UTF-8", async () => {
  const store = await open();
  const id = randomUUID();
  await store.append({ id, role: "assistant", at: new Date().toISOString(), text: "Original" });
  const history = await store.history();
  const position = history.messages[0]?.sourceEnd;
  if (!position) throw new Error("Missing source fixture");
  const path = join(store.root, "history.frames");
  const bytes = await readFile(path);
  bytes[bytes.indexOf(Buffer.from("Original"))] = 0xff;
  await writeFile(path, bytes, { mode: 0o600 });
  await expect(
    store.source(id, {
      direction: "backward",
      position,
      bound: history.sourceBound,
    }),
  ).rejects.toThrow("incomplete");
});

it.each(["same-size valid UTF-8", "identical replacement", "mutation before append"])(
  "rejects %s changes between pinned source pages",
  async (kind) => {
    const store = await open();
    const id = randomUUID();
    const at = new Date().toISOString();
    await store.append({ id, role: "assistant", at, text: "Original".repeat(8_000) });
    const history = await store.history();
    const position = history.messages[0]?.sourceEnd;
    if (!position) throw new Error("Missing source fixture");
    const first = await store.source(id, {
      direction: "backward",
      position,
      bound: history.sourceBound,
    });
    if (!first.next) throw new Error("Missing continuation");
    const path = join(store.root, "history.frames");
    const bytes = await readFile(path);
    if (kind === "identical replacement") {
      await rename(path, `${path}.retained`);
      await writeFile(path, bytes, { mode: 0o600, flag: "wx" });
    } else {
      bytes[bytes.indexOf(Buffer.from("Original"))] = "X".charCodeAt(0);
      await writeFile(path, bytes);
    }
    if (kind === "mutation before append")
      await expect(
        store.append({ id: randomUUID(), role: "human", at, text: "New" }),
      ).rejects.toThrow("outside changes");
    await expect(store.source(id, first.next)).rejects.toThrow("outside changes");
    expect((await store.history()).incomplete).toBe(true);
  },
);
it("serializes bounded source reads with owned appends without changing the pinned message", async () => {
  const store = await open();
  const id = randomUUID();
  const at = new Date().toISOString();
  await store.append({ id, role: "human", at, text: "Original\n" });
  const history = await store.history();
  const position = history.messages[0]?.sourceEnd;
  if (!position) throw new Error("Missing source fixture");
  const cursor: RelaySourceCursor = { direction: "backward", position, bound: history.sourceBound };
  const [before, , after] = await Promise.all([
    store.source(id, cursor),
    store.append({ id, role: "human", at, text: "Later" }, false),
    store.source(id, cursor),
  ]);
  expect(before.text).toBe("Original\n");
  expect(after.text).toBe("Original\n");
});
