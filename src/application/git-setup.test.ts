import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultDeps } from "../core/index.js";
import { GitSetup } from "./git-setup.js";

let project: string;
const ops = () => {
  const value = defaultDeps().git.setup;
  if (!value) throw new Error("Missing Git setup");
  return value;
};
beforeEach(async () => {
  project = await realpath(await mkdtemp(join(tmpdir(), "code60-guided-git-")));
});
afterEach(async () => {
  await rm(project, { recursive: true, force: true });
});
it("binds file previews and commit selections to a project/session and rejects arbitrary identities", async () => {
  await writeFile(join(project, "hello.txt"), "hello");
  const setup = new GitSetup(ops());
  const session = await setup.begin(project);
  const fileId = session.files[0]?.id as string;
  expect((await setup.previewFile({ project, sessionId: session.sessionId, fileId }))?.text).toBe(
    "hello",
  );
  await expect(
    setup.previewFile({ project: "/other", sessionId: session.sessionId, fileId }),
  ).rejects.toThrow("changed");
  expect(() =>
    setup.commit({
      project,
      sessionId: session.sessionId,
      fileIds: ["unknown"],
      name: "Test",
      email: "test@example.invalid",
    }),
  ).toThrow("Unknown setup file");
  await setup.cancel();
  await expect(
    setup.previewFile({ project, sessionId: session.sessionId, fileId }),
  ).rejects.toThrow("changed");
});
it("cancels and settles preview work before invalidating the session", async () => {
  const entered = vi.fn();
  const setup = new GitSetup({
    ...ops(),
    preview: async (_project, signal) => {
      entered();
      return new Promise((_resolve, reject) =>
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true }),
      );
    },
  });
  const pending = setup.begin(project);
  const rejected = expect(pending).rejects.toThrow("cancelled");
  await vi.waitFor(() => expect(entered).toHaveBeenCalled());
  await setup.cancel(project);
  await rejected;
  expect(setup.busy).toBe(false);
});
it("rechecks HEAD after an uncertain outcome, reports readiness, and never retries the commit", async () => {
  const git = ops();
  await git.initialize(project);
  execFileSync("git", ["-C", project, "config", "commit.gpgsign", "false"]);
  const commit = vi.fn(async (...args: Parameters<typeof git.commit>) => {
    await git.commit(...args);
    throw new Error("Receipt lost");
  });
  const setup = new GitSetup({ ...git, commit });
  const session = await setup.begin(project);
  const result = await setup.commit({
    project,
    sessionId: session.sessionId,
    fileIds: [],
    name: "Test",
    email: "test@example.invalid",
  });
  expect(result.readiness.status).toBe("ready");
  expect(result.error).toContain("Receipt lost");
  expect(commit).toHaveBeenCalledTimes(1);
  expect(() =>
    setup.commit({
      project,
      sessionId: session.sessionId,
      fileIds: [],
      name: "Test",
      email: "test@example.invalid",
    }),
  ).toThrow("changed");
});

it("requires a refreshed selection if files appear after an empty preview", async () => {
  const setup = new GitSetup(ops());
  const session = await setup.begin(project);
  await writeFile(join(project, "new.txt"), "new content");
  const result = await setup.commit({
    project,
    sessionId: session.sessionId,
    fileIds: [],
    name: "Test",
    email: "test@example.invalid",
  });
  expect(result.error).toContain("Project files changed");
  expect(result.readiness.status).toBe("not_repository");
});
