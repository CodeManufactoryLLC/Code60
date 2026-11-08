import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { ReviewSnapshotFile } from "../core/index.js";
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
