import { randomUUID } from "node:crypto";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReviewSnapshotFile } from "../core/index.js";
import { privateDirectory } from "../platform/index.js";
import { readRelayState } from "./relay-storage.js";
import { ReviewStore } from "./reviews.js";

let root: string;
let store: ReviewStore;
const file = (modified: string): ReviewSnapshotFile => ({
  path: "same.ts",
  oldPath: "same.ts",
  status: "modified",
  original: "before\n",
  modified,
  fingerprint: modified,
});
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "code60-reviews-"));
  store = await ReviewStore.open(root, "/project");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const review = await store.create("chat-a", 1, "Validation task");
  await store.addWorker(review.id, "worker-a", "Validation");
  await store.addWorker(review.id, "worker-b", "Tests");
  await store.capture(review.id, [
    { runId: "worker-a", files: [file("first\n")] },
    { runId: "worker-b", files: [file("second\n")] },
  ]);
  const revision = store.get(review.id).revisions[0];
  if (!revision) throw new Error("Missing revision");
  return { review, revision, identity: { project: "/project", reviewId: review.id } };
}
it("loads one Relay review and its immutable contents without scanning sibling records", async () => {
  const conversationId = randomUUID();
  const recordId = randomUUID();
  const read = vi.fn((path: string) => readRelayState(path, 16 * 1_048_576));
  const options = { recordId, read };
  const selected = await ReviewStore.open(root, conversationId, { ...options, create: true });
  const provenance = {
    conversationId,
    generation: 4,
    taskId: randomUUID(),
    targetId: randomUUID(),
    cwd: "/target",
    device: "1",
    inode: "9007199254740993",
    workspaceMode: "worktree" as const,
    baseline: "a".repeat(40),
  };
  const created = await selected.create(conversationId, 2, "Target changes", provenance);
  expect(created.id).toBe(recordId);
  await selected.addWorker(recordId, "worker", "Target worker", 1);
  await selected.capture(recordId, [{ runId: "worker", files: [file("captured\n")] }]);
  const revision = selected.get(recordId).revisions[0];
  if (!revision) throw new Error("Missing revision");
  await writeFile(join(selected.root, `${randomUUID()}.json`), "Malformed sibling", {
    mode: 0o600,
  });
  read.mockClear();
  const reopened = await ReviewStore.open(root, conversationId, options);
  expect(read).toHaveBeenCalledExactlyOnceWith(join(selected.root, `${recordId}.json`));
  expect(reopened.list()).toHaveLength(1);
  expect(reopened.get(recordId)).toMatchObject({
    relay: provenance,
    workers: [{ runId: "worker", turn: 1 }],
  });
  expect((await reopened.content(recordId, revision.id, "worker:same.ts")).modified).toBe(
    "captured\n",
  );
  expect(read).toHaveBeenLastCalledWith(join(selected.root, `${revision.id}.rev`));
  await reopened.addWorker(recordId, "worker", "Target worker", 2);
  expect(reopened.get(recordId).workers).toMatchObject([{ runId: "worker", turn: 2 }]);
  expect((await reopened.content(recordId, revision.id, "worker:same.ts")).modified).toBe(
    "captured\n",
  );
  await expect(reopened.create(conversationId, 3, "Overwrite")).rejects.toThrow("already exists");
});
it("requires an explicit scoped creation and refuses malformed or stale record identities", async () => {
  const recordId = randomUUID();
  await expect(ReviewStore.open(root, "/project", { recordId })).rejects.toMatchObject({
    code: "ENOENT",
  });
  await expect(ReviewStore.open(root, "/project", { recordId: "" })).rejects.toThrow();
  await expect(ReviewStore.open(root, "/project", { recordId: "../escape" })).rejects.toThrow();
  const first = await ReviewStore.open(root, "/project", { recordId, create: true });
  const stale = await ReviewStore.open(root, "/project", { recordId, create: true });
  await first.create(null, 1, "Preserve");
  await expect(stale.create(null, 2, "Overwrite")).rejects.toThrow("already exists");
  expect((await ReviewStore.open(root, "/project", { recordId })).get(recordId).title).toBe(
    "Preserve",
  );
});
it("persists separate worker versions and keeps immutable content after later captures and restart", async () => {
  const { review, revision } = await fixture();
  expect(revision.files.map((file) => file.key)).toEqual(["worker-a:same.ts", "worker-b:same.ts"]);
  await store.capture(review.id, [{ runId: "worker-a", files: [file("corrected\n")] }]);
  store = await ReviewStore.open(root, "/project");
  expect((await store.content(review.id, revision.id, "worker-a:same.ts")).modified).toBe(
    "first\n",
  );
  expect((await store.content(review.id, revision.id, "worker-b:same.ts")).modified).toBe(
    "second\n",
  );
  await expect(store.content(review.id, revision.id, "../../secret")).rejects.toThrow(
    "Unknown file",
  );
  expect((await ReviewStore.open(root, "/other")).list()).toEqual([]);
});
it("computes line counts for only the requested immutable revision without persisting them", async () => {
  const { review, revision } = await fixture();
  const captured = await store.withLineStats(review.id, revision.id);
  expect(captured.revisions[0]?.files).toMatchObject([
    { key: "worker-a:same.ts", additions: 1, deletions: 1 },
    { key: "worker-b:same.ts", additions: 1, deletions: 1 },
  ]);
  expect(store.get(review.id).revisions[0]?.files[0]).not.toHaveProperty("additions");

  await store.capture(review.id, [{ runId: "worker-a", files: [file("new\nlines\n")] }]);
  const latest = store.get(review.id).revisions.at(-1);
  if (!latest) throw new Error("Missing latest revision");
  expect((await store.withLineStats(review.id, latest.id)).revisions.at(-1)?.files).toMatchObject([
    { key: "worker-a:same.ts", additions: 2, deletions: 1 },
  ]);
  expect((await store.withLineStats(review.id, revision.id)).revisions[0]?.files[0]).toMatchObject({
    key: "worker-a:same.ts",
    additions: 1,
    deletions: 1,
  });
});
it("marks line counts unavailable for limited snapshot content", async () => {
  const review = await store.create("chat-a", 1, "Limited file");
  const limited = { ...file("after\n"), limitation: "Binary content" };
  await store.capture(review.id, [{ runId: "worker-a", files: [limited] }]);
  const revision = store.get(review.id).revisions[0];
  if (!revision) throw new Error("Missing revision");
  expect((await store.withLineStats(review.id, revision.id)).revisions[0]?.files[0]).toMatchObject({
    lineCountsUnavailable: true,
  });
});
it("deduplicates unchanged captures, invalidates reviewed fingerprints, and retains explicit read failures", async () => {
  const { review, revision, identity } = await fixture();
  await store.action({
    type: "reviewed",
    ...identity,
    revisionId: revision.id,
    fileKey: "worker-a:same.ts",
    reviewed: true,
  });
  await store.capture(review.id, [
    { runId: "worker-a", files: [file("first\n")] },
    { runId: "worker-b", files: [file("second\n")] },
  ]);
  expect(store.get(review.id).revisions).toHaveLength(1);
  await store.capture(review.id, [
    { runId: "worker-a", files: [file("changed\n")] },
    { runId: "worker-b", error: "Worktree is missing" },
  ]);
  const next = store.get(review.id);
  expect(next.reviewed["worker-a:same.ts"]).not.toBe(next.revisions.at(-1)?.files[0]?.fingerprint);
  expect(next.revisions.at(-1)?.errors[0]?.message).toBe("Worktree is missing");
});
it("validates anchors, preserves drafts, deduplicates submissions, and requires withdrawal before editing", async () => {
  const { revision, review, identity } = await fixture();
  const comment = {
    type: "comment" as const,
    ...identity,
    id: randomUUID(),
    revisionId: revision.id,
    text: "Handle optional values",
    anchor: {
      revisionId: revision.id,
      fileKey: "worker-a:same.ts",
      side: "modified" as const,
      start: 1,
      end: 1,
    },
  };
  await expect(
    store.action({ ...comment, anchor: { ...comment.anchor, end: 99 } }),
  ).rejects.toThrow("outside");
  await store.action(comment);
  await expect(
    store.action({ type: "resolve", ...identity, id: comment.id, resolved: true }),
  ).rejects.toThrow("Unsent");
  const submit = {
    type: "submit" as const,
    ...identity,
    id: randomUUID(),
    revisionId: revision.id,
  };
  await store.action(submit);
  await store.action(submit);
  expect(store.get(review.id).submissions).toHaveLength(1);
  await expect(store.action({ ...comment, text: "edit" })).rejects.toThrow("Withdraw");
  await store.mutate(review.id, (current) => {
    const batch = current.submissions[0];
    if (batch) batch.state = "failed";
  });
  await expect(store.action({ ...comment, text: "edit failed batch" })).rejects.toThrow("Withdraw");
  expect(await store.feedback(review.id, submit.id)).toContain('"first"');
  expect(await store.feedback(review.id, submit.id)).toContain("Worker worker-a; same.ts");
  await store.action({ type: "withdraw", ...identity, id: submit.id });
  await store.action({ ...comment, text: "Revised feedback" });
  const restored = await ReviewStore.open(root, "/project");
  expect(restored.get(review.id).comments[0]?.text).toBe("Revised feedback");
  expect(restored.get(review.id).submissions[0]?.state).toBe("withdrawn");
});
it("never automatically replays feedback after restart and retains provenance on reconnect", async () => {
  const { revision, review, identity } = await fixture();
  await store.action({
    type: "comment",
    ...identity,
    id: randomUUID(),
    revisionId: revision.id,
    text: "General feedback",
  });
  await store.action({ type: "submit", ...identity, id: randomUUID(), revisionId: revision.id });
  const restored = await ReviewStore.open(root, "/project");
  expect(restored.get(review.id).submissions[0]?.state).toBe("failed");
  await restored.action({ type: "reconnect", ...identity, chatId: "chat-b" });
  expect(restored.get(review.id)).toMatchObject({ originChatId: "chat-a", chatId: "chat-b" });
});
it("rejects corrupt records rather than silently presenting an empty review", async () => {
  const { review } = await fixture();
  await writeFile(join(store.root, `${review.id}.json`), "{}");
  await expect(ReviewStore.open(root, "/project")).rejects.toThrow();
});

it("persists review revisions near the Windows path limit", async () => {
  // Metadata fits, but the older nested revision layout exceeds the native helper's limit.
  const nested = join(root, "x".repeat(Math.max(1, 130 - root.length - 1)));
  store = await ReviewStore.open(nested, "/project");
  const { review, revision, identity } = await fixture();
  const path = join(store.root, `${revision.id}.rev`);
  expect(path.length).toBeLessThan(248);
  expect(join(store.root, review.id, `${revision.id}.json`).length).toBeGreaterThan(247);
  store = await ReviewStore.open(nested, identity.project);
  expect((await store.content(review.id, revision.id, "worker-a:same.ts")).modified).toBe(
    "first\n",
  );
});

it("reads legacy nested revisions and never falls back from corrupt new content", async () => {
  const { review, revision } = await fixture();
  const flat = join(store.root, `${revision.id}.rev`);
  await privateDirectory(join(store.root, review.id));
  await rename(flat, join(store.root, review.id, `${revision.id}.json`));
  store = await ReviewStore.open(root, "/project");
  expect((await store.content(review.id, revision.id, "worker-a:same.ts")).modified).toBe(
    "first\n",
  );
  expect((await store.withLineStats(review.id, revision.id)).revisions[0]?.files[0]).toMatchObject({
    additions: 1,
    deletions: 1,
  });
  await writeFile(flat, "invalid JSON");
  await expect(store.content(review.id, revision.id, "worker-a:same.ts")).rejects.toThrow();
});

it("captures full worker provenance separately from display text and queues only conflict feedback", async () => {
  const { review, revision: legacy, identity } = await fixture();
  const results = [
    { runId: "worker-a", files: [file("first\n")] },
    { runId: "worker-b", files: [file("second\n")] },
  ];
  const sources = results.map(({ runId }) => ({
    runId,
    base: "a".repeat(40),
    commit: "b".repeat(40),
  }));
  await store.capture(review.id, results, sources);
  const revision = store.get(review.id).revisions.at(-1);
  if (!revision) throw new Error("Missing captured revision");
  expect(revision.id).not.toBe(legacy.id);
  await store.capture(review.id, results, sources);
  const draftId = randomUUID();
  await store.action({
    ...identity,
    type: "comment",
    id: draftId,
    revisionId: revision.id,
    text: "Keep this draft",
  });
  await store.requestRevision(review.id, revision.id, "Please preserve the project edit");
  const saved = store.get(review.id);
  expect(saved.revisions).toHaveLength(2);
  expect(saved.comments.find(({ id }) => id === draftId)?.state).toBe("draft");
  const submission = saved.submissions[0];
  if (!submission) throw new Error("Missing revision request");
  const feedback = await store.feedback(review.id, submission.id);
  expect(feedback).toContain("Please preserve the project edit");
  expect(feedback).not.toContain("Keep this draft");

  store = await ReviewStore.open(root, "/project");
  expect(store.get(review.id).revisions.map(({ sources }) => sources)).toEqual([
    undefined,
    sources,
  ]);
});
