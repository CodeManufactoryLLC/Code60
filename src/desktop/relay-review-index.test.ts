import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RelayReviewEntry } from "../bridge/index.js";
import { RelayReviewIndex } from "./relay-review-index.js";
import * as storage from "./relay-storage.js";

let root: string;
let conversationId: string;
const entry = (title: string): RelayReviewEntry => ({
  id: randomUUID(),
  taskId: randomUUID(),
  targetId: randomUUID(),
  generation: 1,
  title,
  targetLabel: "/target",
  labelTruncated: false,
  workspaceMode: "worktree",
  at: "2026-11-12T00:00:00.000Z",
});
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "code60-relay-review-index-"));
  conversationId = randomUUID();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

it("pages across full bounded index files without loading the lifetime collection", async () => {
  const index = await RelayReviewIndex.open(root, conversationId);
  const entries = Array.from({ length: 129 }, (_, i) => ({
    ...entry(`Review ${i}`),
    // Worst JSON escaping at every bounded text field, including the full 128-row page.
    title: "\u0001".repeat(160),
    targetLabel: "\u0001".repeat(512),
  }));
  await Promise.all(entries.map((item) => index.append(item)));
  expect(Buffer.byteLength(await readFile(join(root, "page-0.json"), "utf8"))).toBeLessThan(
    1_048_576,
  );
  const reopened = await RelayReviewIndex.open(root, conversationId);
  let page = await reopened.read();
  const ids = page.entries.map((item) => item.id);
  expect(ids).toEqual([entries[128]?.id]);
  for (;;) {
    if (!page.next) break;
    page = await reopened.read(page.next);
    expect(page.entries.length).toBeLessThanOrEqual(32);
    ids.push(...page.entries.map((item) => item.id));
  }
  expect(ids).toEqual(entries.map((item) => item.id).reverse());
});
it("pins an older page boundary while new entries are appended", async () => {
  const index = await RelayReviewIndex.open(root, conversationId);
  const entries = Array.from({ length: 40 }, (_, i) => entry(`Review ${i}`));
  for (const item of entries) await index.append(item);
  const first = await index.read();
  expect(first.entries).toHaveLength(32);
  await index.append(entry("Newer"));
  const rest = await index.read(first.next ?? undefined);
  expect(rest.entries.map((item) => item.id)).toEqual(
    entries
      .slice(0, 8)
      .map((item) => item.id)
      .reverse(),
  );
  expect(rest.next).toBeNull();
});
it("keeps retries idempotent, validates identities and refuses unavailable cursor positions", async () => {
  const index = await RelayReviewIndex.open(root, conversationId);
  const item = entry("One");
  await index.append(item);
  await index.append(item);
  expect((await index.read()).entries).toHaveLength(1);
  await expect(index.append({ ...item, title: "Other" })).rejects.toThrow("another identity");
  await expect(index.read({ page: 1 })).rejects.toThrow("unavailable");
  await expect(index.read({ page: 0, before: 2 })).rejects.toThrow("unavailable");
  await expect(index.read({ page: -1 })).rejects.toThrow();
  await expect(RelayReviewIndex.open(root, randomUUID())).rejects.toThrow("another conversation");
});
it("opens only the latest index page and reports a corrupt older page when explicitly requested", async () => {
  const index = await RelayReviewIndex.open(root, conversationId);
  for (let i = 0; i < 129; i++) await index.append(entry(`Review ${i}`));
  await writeFile(join(root, "page-0.json"), "Malformed older page", { mode: 0o600 });
  const reopened = await RelayReviewIndex.open(root, conversationId);
  expect((await reopened.read()).entries).toHaveLength(1);
  await expect(reopened.read({ page: 0 })).rejects.toThrow();
});
it("preserves an index whose manifest disappeared instead of silently resetting it", async () => {
  await RelayReviewIndex.open(root, conversationId);
  await rm(join(root, "manifest.json"));
  await expect(RelayReviewIndex.open(root, conversationId)).rejects.toThrow("metadata is missing");
});
it("finishes an interrupted rollover on reopen without losing or duplicating its entry", async () => {
  const index = await RelayReviewIndex.open(root, conversationId);
  for (let i = 0; i < 129; i++) await index.append(entry(`Review ${i}`));
  const pending = (await index.read()).entries[0];
  await storage.writeRelayState(
    join(root, "manifest.json"),
    { format: 1, conversationId, page: 0 },
    { format: 1, conversationId, page: 1 },
  );
  const reopened = await RelayReviewIndex.open(root, conversationId);
  expect((await reopened.read()).entries).toEqual([pending]);
  if (!pending) throw new Error("Missing pending publication");
  await reopened.append(pending);
  expect((await reopened.read()).entries).toEqual([pending]);
});
it("finishes a failed manifest write before accepting a different entry", async () => {
  const index = await RelayReviewIndex.open(root, conversationId);
  for (let i = 0; i < 128; i++) await index.append(entry(`Review ${i}`));
  const write = storage.writeRelayState;
  let failed = false;
  vi.spyOn(storage, "writeRelayState").mockImplementation(async (...args) => {
    if (!failed && args[0] === join(root, "manifest.json")) {
      failed = true;
      throw new Error("Interrupted manifest");
    }
    return write(...args);
  });
  const pending = entry("Interrupted");
  await expect(index.append(pending)).rejects.toThrow("Interrupted manifest");
  const latest = entry("Later");
  await index.append(latest);
  expect((await index.read()).entries).toEqual([latest, pending]);
});
it("preserves an ambiguous next page instead of resetting or hiding it", async () => {
  await RelayReviewIndex.open(root, conversationId);
  const path = join(root, "page-1.json");
  const data = { format: 1, conversationId, page: 1, entries: [entry("Unverified")] };
  await storage.writeRelayState(path, data, undefined, 1_048_576);
  await expect(RelayReviewIndex.open(root, conversationId)).rejects.toThrow("ambiguous");
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual(data);
});
