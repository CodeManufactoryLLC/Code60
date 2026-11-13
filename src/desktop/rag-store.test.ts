import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { topMatches } from "../core/index.js";
import * as platform from "../platform/index.js";
import { type RagIndex, RagStore, readRagFile } from "./rag-store.js";

let directory: string;
let store: RagStore;
const summary = { builtAt: "2026-01-01T00:00:00.000Z", conversations: 1, chunks: 1 };
const index = (): RagIndex => ({
  chunks: [
    {
      source: {
        version: 1,
        kind: "conversation",
        runId: "run-1",
        conversation: "chat",
        title: "A chat",
        agent: "fake",
        project: null,
      },
      role: "user",
      message: 0,
      at: summary.builtAt,
      start: 2,
      end: 7,
      text: "hello",
    },
  ],
  vectors: Float32Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0)),
});
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "code60-rag-store-"));
  store = new RagStore(join(directory, ".code60_workspace", "rag", "a".repeat(64)), "a".repeat(64));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
describe("private RAG generations", () => {
  it("retains project provenance for project-bound orchestration chats", async () => {
    const value = index();
    if (!value.chunks[0]) throw new Error("Missing fixture chunk");
    value.chunks[0].source.project = "/registered/project";
    const generation = randomUUID();
    await store.stage(generation, value);
    await store.publish(generation, summary);
    const manifest = await store.manifest();
    if (!manifest) throw new Error("Missing test manifest");
    expect((await store.load(manifest)).chunks[0]?.source.project).toBe("/registered/project");
  });
  it("loads and ranks the maximum 10,000-chunk index without truncation", async () => {
    const base = index();
    const chunks = Array.from({ length: 10_000 }, (_, message) => ({
      ...base.chunks[0],
      message,
    })) as RagIndex["chunks"];
    const vectors = new Float32Array(10_000 * 768);
    for (let i = 0; i < 10_000; i++) vectors[i * 768] = 1;
    const generation = randomUUID();
    await store.stage(generation, { chunks, vectors });
    await store.publish(generation, { ...summary, chunks: 10_000 });
    const manifest = await store.manifest();
    if (!manifest) throw new Error("Missing test manifest");
    const loaded = await store.load(manifest);
    expect(loaded.chunks.length).toBe(10_000);
    expect(topMatches(base.vectors, loaded.vectors, 768, 10).map((match) => match.index)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
  });
  it("preserves the previous manifest after a failed atomic replacement", async () => {
    const old = randomUUID(),
      next = randomUUID();
    await store.stage(old, index());
    await store.publish(old, summary);
    await store.stage(next, index());
    const replace = vi
      .spyOn(platform, "atomicReplace")
      .mockRejectedValueOnce(new Error("disk write failed"));
    try {
      await expect(store.publish(next, summary)).rejects.toThrow("disk write failed");
    } finally {
      replace.mockRestore();
    }
    expect((await store.manifest())?.generation).toBe(old);
  });
  it("persists across restart and isolates neighboring databases", async () => {
    expect(await store.manifest()).toBeNull();
    const id = randomUUID();
    await store.stage(id, index());
    expect(await store.manifest()).toBeNull();
    await store.publish(id, summary);
    const restart = new RagStore(store.root, store.databaseKey);
    const manifest = await restart.manifest();
    expect(manifest?.summary).toEqual(summary);
    if (!manifest) throw new Error("Missing test manifest");
    expect(await restart.load(manifest)).toEqual(index());
    expect(
      await new RagStore(
        join(directory, ".code60_workspace", "rag", "b".repeat(64)),
        "b".repeat(64),
      ).manifest(),
    ).toBeNull();
    if (process.platform !== "win32") expect((await stat(store.path(id))).mode & 0o777).toBe(0o600);
  });
  it("keeps the previous generation after aborted publication and write failure", async () => {
    const old = randomUUID(),
      next = randomUUID();
    await store.stage(old, index());
    await store.publish(old, summary);
    await store.stage(next, index());
    const abort = new AbortController();
    abort.abort();
    await expect(store.publish(next, summary, abort.signal)).rejects.toThrow();
    expect((await store.manifest())?.generation).toBe(old);
    await expect(store.stage(next, index())).rejects.toThrow();
    expect((await store.manifest())?.generation).toBe(old);
  });
  it.each(["dimension", "nan", "source", "span", "model", "format", "databaseKey", "base64"])(
    "rejects invalid %s data",
    async (kind) => {
      const id = randomUUID();
      await store.stage(id, index());
      await store.publish(id, summary);
      const raw = JSON.parse(await readFile(store.path(id), "utf8"));
      if (kind === "dimension") raw.vectors = "AAAA";
      if (kind === "nan") {
        const data = Buffer.from(raw.vectors, "base64");
        data.writeFloatLE(NaN, 0);
        raw.vectors = data.toString("base64");
      }
      if (kind === "source") raw.chunks[0].source.runId = "../foreign";
      if (kind === "span") raw.chunks[0].end = 1;
      if (kind === "model") raw.model = "another-space";
      if (kind === "format") raw.format = 2;
      if (kind === "databaseKey") raw.databaseKey = "b".repeat(64);
      if (kind === "base64") raw.vectors = "bad?";
      await writeFile(store.path(id), JSON.stringify(raw));
      const manifest = await store.manifest();
      if (!manifest) throw new Error("Missing test manifest");
      await expect(store.load(manifest)).rejects.toThrow();
    },
  );
  it("bounds reads, refuses links and clears only derived files, even when corrupt", async () => {
    await store.directory();
    const foreign = join(store.root, "keep.txt");
    await writeFile(foreign, "original");
    const notGenerated = join(store.root, `${"a".repeat(36)}.json`);
    await writeFile(notGenerated, "not a UUID");
    await expect(readRagFile(foreign, 2)).rejects.toThrow();
    if (process.platform !== "win32") {
      const link = join(store.root, "link");
      await symlink(foreign, link);
      await expect(readRagFile(link, 100)).rejects.toThrow();
    }
    await writeFile(join(store.root, "current.json"), "broken");
    await expect(store.manifest()).rejects.toThrow();
    await store.clear();
    expect(await store.manifest()).toBeNull();
    expect(await readFile(foreign, "utf8")).toBe("original");
    expect(await readFile(notGenerated, "utf8")).toBe("not a UUID");
    expect(() => store.path("../x")).toThrow();
  });
});
