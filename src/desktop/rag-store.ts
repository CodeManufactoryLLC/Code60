import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { RagHit, RagSummary } from "../bridge/index.js";
import { checkedVector, RAG_CHUNKER } from "../core/index.js";
import { atomicReplace, privateDirectory, writePrivateFile } from "../platform/index.js";

export const RAG_LIMITS = {
  indexBytes: 96 * 1_048_576,
  sourceBytes: 128 * 1_048_576,
  chunks: 10_000,
  conversations: 2000,
};
const MODEL_IDENTITY =
  "jina-v2-base-code:516f4baf13dec4ddddda8631e019b5737c8bc250:q8:mean:normalized:768";
const sourceSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("conversation"),
  runId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  conversation: z.enum(["chat", "worker"]),
  title: z.string().max(4096),
  agent: z.string().min(1).max(200),
  project: z.string().min(1).max(4096).nullable(),
});
const chunkSchema = z
  .strictObject({
    source: sourceSchema,
    message: z.number().int().nonnegative(),
    role: z.enum(["user", "assistant"]),
    at: z.string().max(100),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    text: z.string().min(1).max(1_048_576),
  })
  .refine(
    (c) =>
      c.end > c.start &&
      c.text.length === c.end - c.start &&
      (c.source.conversation === "chat" || c.source.project !== null),
  );
const summarySchema = z.strictObject({
  builtAt: z.string().datetime(),
  conversations: z.number().int().nonnegative().max(RAG_LIMITS.conversations),
  chunks: z.number().int().nonnegative().max(RAG_LIMITS.chunks),
});
const manifestSchema = z.strictObject({
  format: z.literal(1),
  databaseKey: z.string().regex(/^[a-f0-9]{64}$/),
  generation: z.string().uuid(),
  model: z.literal(MODEL_IDENTITY),
  chunker: z.literal(JSON.stringify(RAG_CHUNKER)),
  summary: summarySchema,
});
export type RagManifest = z.infer<typeof manifestSchema>;
export type StoredChunk = Omit<RagHit, "score">;
export interface RagIndex {
  chunks: StoredChunk[];
  vectors: Float32Array;
}

/** Bounded same-handle reads, refusing links, special files and concurrent growth. */
export async function readRagFile(path: string, limit: number): Promise<string> {
  // Validate the opened handle, not the path, so a swapped file cannot pass the checks.
  const file = await open(
    path,
    constants.O_RDONLY |
      constants.O_NONBLOCK |
      (process.platform === "win32" ? 0 : constants.O_NOFOLLOW),
  );
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > limit) throw new Error("RAG source is unsafe or too large");
    if (process.platform === "win32") {
      // Windows has no O_NOFOLLOW: refuse a link, or a path that no longer names this handle.
      const entry = await lstat(path);
      if (entry.isSymbolicLink() || entry.dev !== info.dev || entry.ino !== info.ino)
        throw new Error("RAG source changed while opening");
    }
    const data = Buffer.alloc(info.size + 1);
    let count = 0;
    while (count < data.length) {
      const part = await file.read(data, count, data.length - count, count);
      if (!part.bytesRead) break;
      count += part.bytesRead;
    }
    if (count !== info.size) throw new Error("RAG source changed while reading");
    return data.subarray(0, count).toString("utf8");
  } finally {
    await file.close();
  }
}

export class RagStore {
  constructor(
    readonly root: string,
    readonly databaseKey: string,
  ) {}
  async directory() {
    const { dirname } = await import("node:path");
    for (const path of [dirname(dirname(this.root)), dirname(this.root), this.root]) {
      const existing = await lstat(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (existing && (!existing.isDirectory() || existing.isSymbolicLink()))
        throw new Error("Unsafe RAG storage");
      await privateDirectory(path);
      const info = await lstat(path);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Unsafe RAG storage");
    }
  }
  async manifest(): Promise<RagManifest | null> {
    await this.directory();
    let text: string;
    try {
      text = await readRagFile(join(this.root, "current.json"), 4096);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new Error("The RAG index cannot be read. Rebuild or clear it.");
    }
    const result = manifestSchema.safeParse(JSON.parse(text));
    if (!result.success || result.data.databaseKey !== this.databaseKey)
      throw new Error("The RAG index is incompatible. Rebuild or clear it.");
    return result.data;
  }
  async load(manifest: RagManifest): Promise<RagIndex> {
    const data = JSON.parse(
      await readRagFile(this.path(manifest.generation), RAG_LIMITS.indexBytes),
    );
    if (
      !data ||
      typeof data !== "object" ||
      data.format !== 1 ||
      data.databaseKey !== this.databaseKey ||
      data.model !== MODEL_IDENTITY ||
      data.chunker !== JSON.stringify(RAG_CHUNKER) ||
      data.generation !== manifest.generation ||
      !Array.isArray(data.chunks) ||
      data.chunks.length !== manifest.summary.chunks ||
      typeof data.vectors !== "string" ||
      /[^A-Za-z0-9+/=]/.test(data.vectors)
    )
      throw new Error("Invalid RAG index. Rebuild or clear it.");
    const chunks = z.array(chunkSchema).max(RAG_LIMITS.chunks).parse(data.chunks);
    const bytes = Buffer.from(data.vectors, "base64");
    if (bytes.length !== chunks.length * 768 * 4 || bytes.toString("base64") !== data.vectors)
      throw new Error("Invalid RAG vector dimensions");
    const vectors = new Float32Array(bytes.length / 4);
    for (let i = 0; i < vectors.length; i++) vectors[i] = bytes.readFloatLE(i * 4);
    for (let i = 0; i < chunks.length; i++)
      checkedVector(vectors.subarray(i * 768, (i + 1) * 768), 768);
    const identities = new Set(chunks.map((c) => JSON.stringify(c.source)));
    if (identities.size > manifest.summary.conversations)
      throw new Error("Invalid RAG source identities");
    return { chunks, vectors };
  }
  path(generation: string) {
    z.string().uuid().parse(generation);
    return join(this.root, `${generation}.json`);
  }
  async stage(generation: string, index: RagIndex): Promise<void> {
    await this.directory();
    if (index.chunks.length > RAG_LIMITS.chunks)
      throw new Error("RAG supports at most 10,000 chunks");
    const bytes = Buffer.alloc(index.vectors.length * 4);
    index.vectors.forEach((n, i) => {
      bytes.writeFloatLE(n, i * 4);
    });
    const text = JSON.stringify({
      format: 1,
      databaseKey: this.databaseKey,
      generation,
      model: MODEL_IDENTITY,
      chunker: JSON.stringify(RAG_CHUNKER),
      chunks: index.chunks,
      vectors: bytes.toString("base64"),
    });
    if (Buffer.byteLength(text) > RAG_LIMITS.indexBytes)
      throw new Error("RAG index exceeds 96 MiB");
    await writePrivateFile(this.path(generation), text, { flag: "wx", mode: 0o600 });
  }
  async publish(generation: string, summary: RagSummary, signal?: AbortSignal): Promise<void> {
    const manifest = manifestSchema.parse({
      format: 1,
      databaseKey: this.databaseKey,
      generation,
      model: MODEL_IDENTITY,
      chunker: JSON.stringify(RAG_CHUNKER),
      summary,
    });
    const tmp = join(this.root, `${randomUUID()}.tmp`);
    try {
      await writePrivateFile(tmp, JSON.stringify(manifest), { mode: 0o600, flag: "wx" });
      signal?.throwIfAborted();
      await atomicReplace(tmp, join(this.root, "current.json"));
    } finally {
      await rm(tmp, { force: true });
    }
  }
  async remove(generation: string) {
    await rm(this.path(generation), { force: true });
  }
  async prune(keep?: string) {
    if (keep !== undefined) this.path(keep);
    await this.directory();
    const { readdir } = await import("node:fs/promises");
    for (const name of await readdir(this.root)) {
      const generated =
        /\.(json|tmp)$/.test(name) &&
        z.uuid().safeParse(name.slice(0, name.endsWith(".json") ? -5 : -4)).success;
      if (generated && name !== `${keep}.json`) await rm(join(this.root, name), { force: true });
    }
  }
  async clear() {
    // Clearing also recovers corrupt indexes. Only derived, generated RAG filenames are eligible.
    await this.prune();
    await rm(join(this.root, "current.json"), { force: true });
  }
}
