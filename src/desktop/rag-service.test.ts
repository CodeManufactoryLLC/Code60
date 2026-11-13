import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type RagExecutor, RagService } from "./rag-service.js";
import { RagStore } from "./rag-store.js";
import type { RagConversation } from "./rag-worker.js";

let directory: string;
const summary = { builtAt: "2026-01-01T00:00:00.000Z", conversations: 0, chunks: 0 };
const empty = async () => [] as RagConversation[];
const execute: RagExecutor = async (work, signal, progress) => {
  signal.throwIfAborted();
  progress({ phase: "Embedding", completed: 1, total: 1 });
  if (work.action === "build") {
    await new RagStore(work.root, work.databaseKey).stage(work.generation, {
      chunks: [],
      vectors: new Float32Array(),
    });
    return summary;
  }
  return { databaseKey: work.databaseKey, generation: randomUUID(), hits: [] };
};
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "code60-rag-service-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
function setup(worker: RagExecutor = execute) {
  const service = new RagService("/unused", worker);
  service.select(join(directory, "database.sqlite"));
  const identity = () => ({
    databaseKey: service.snapshot().databaseKey ?? "",
    requestId: randomUUID(),
  });
  return { service, identity };
}
describe("RAG lifecycle", () => {
  it("cancels Clear while confirmation is pending and ignores a late approval", async () => {
    const { service, identity } = setup();
    await service.rebuild(identity(), empty);
    let approve: (value: boolean) => void = () => {};
    const confirm = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          approve = resolve;
        }),
    );
    const clearing = service.clear(identity(), confirm);
    const rejected = expect(clearing).rejects.toThrow("cancelled");
    await vi.waitFor(() => expect(confirm).toHaveBeenCalled());
    await service.cancel();
    await rejected;
    expect(service.snapshot().operation).toBeNull();
    approve(true);
    await Promise.resolve();
    expect((await service.status()).index).toEqual(summary);
  });
  it("publishes repeated snapshots, restores status and clears with native approval only", async () => {
    const { service, identity } = setup();
    const notices = vi.fn();
    const unsubscribe = service.subscribe(notices);
    expect((await service.status()).index).toBeNull();
    await service.rebuild(identity(), empty);
    expect(service.snapshot().index).toEqual(summary);
    const root = join(directory, ".code60_workspace", "rag", identity().databaseKey);
    await writeFile(join(root, `${randomUUID()}.tmp`), "abandoned publication");
    await writeFile(join(root, `${randomUUID()}.json`), "abandoned generation");
    await service.rebuild(identity(), empty);
    expect(await readdir(root)).toHaveLength(2);
    expect((await readdir(root)).filter((n) => n.endsWith(".json"))).toHaveLength(2);
    const restart = setup().service;
    expect((await restart.status()).index).toEqual(summary);
    expect((await service.retrieve({ ...identity(), text: "query" })).hits).toEqual([]);
    expect(await service.clear(identity(), async () => false)).toBe(false);
    expect(service.snapshot().index).toEqual(summary);
    expect(await service.clear(identity(), async () => true)).toBe(true);
    expect((await service.status()).index).toBeNull();
    expect(notices).toHaveBeenCalled();
    unsubscribe();
  });
  it("preserves the previous index on unreadable sources or worker failure", async () => {
    let fail = false;
    const { service, identity } = setup(async (...args) => {
      if (fail) throw new Error("RAG operation failed");
      return execute(...args);
    });
    await service.rebuild(identity(), empty);
    await expect(
      service.rebuild(identity(), async () => {
        throw new Error("missing project");
      }),
    ).rejects.toThrow();
    expect((await service.status()).index).toEqual(summary);
    fail = true;
    await expect(service.rebuild(identity(), empty)).rejects.toThrow("failed");
    expect((await service.status()).index).toEqual(summary);
  });
  it("keeps mutations single-flight, ignores stale cancellation and discards cancelled work", async () => {
    const { service, identity } = setup();
    const request = identity();
    let started = false;
    const pending = service.rebuild(request, async (signal) => {
      started = true;
      await new Promise<void>((_, reject) =>
        signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }),
      );
      return [];
    });
    const rejection = expect(pending).rejects.toThrow("cancelled");
    await vi.waitFor(() => expect(started).toBe(true));
    await expect(service.rebuild(identity(), empty)).rejects.toThrow("current RAG operation");
    await service.cancel(randomUUID());
    expect(service.snapshot().operation?.requestId).toBe(request.requestId);
    await service.cancel(request.requestId);
    await rejection;
    expect(service.snapshot().operation).toBeNull();
    await service.rebuild(identity(), empty);
    await service.cancel(request.requestId);
    expect(service.snapshot().index).toEqual(summary);
  });
  it("rejects stale databases and cancelled late worker results", async () => {
    let release: (() => void) | undefined;
    const { service, identity } = setup(async (...args) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return execute(...args);
    });
    const old = identity();
    const pending = service.rebuild(old, empty);
    const rejected = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const cancellation = service.cancel();
    release?.();
    await cancellation;
    await rejected;
    service.select(join(directory, "other.sqlite"));
    await expect(service.retrieve({ ...old, text: "query" })).rejects.toThrow("database changed");
    expect((await service.status()).index).toBeNull();
  });
  it("reports corrupt status and recovers with explicit rebuild", async () => {
    const { service, identity } = setup();
    await service.rebuild(identity(), empty);
    const root = join(directory, ".code60_workspace", "rag", identity().databaseKey);
    await writeFile(join(root, "current.json"), "corrupt");
    expect((await service.status()).error).toContain("cannot be read");
    await service.rebuild(identity(), empty);
    expect((await service.status()).error).toBeNull();
  });
});
