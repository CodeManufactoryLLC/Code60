import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as exec from "./exec.js";
import { gitSetup } from "./setup.js";

let root: string;
const author = { name: "Setup Test", email: "setup@example.invalid" };
const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "code60-setup-")));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});
it("distinguishes a plain folder, unborn repository and committed repository", async () => {
  expect((await gitSetup.readiness(root)).status).toBe("not_repository");
  await gitSetup.initialize(root);
  expect((await gitSetup.readiness(root)).status).toBe("no_commits");
  git("config", "commit.gpgsign", "false");
  await gitSetup.commit(root, [], author);
  expect((await gitSetup.readiness(root)).status).toBe("ready");
  expect(git("ls-tree", "--name-only", "HEAD")).toBe("");
});
it("previews ignored files without initializing the project and commits only selected files", async () => {
  await writeFile(join(root, ".gitignore"), "ignored.txt\n");
  await writeFile(join(root, "ignored.txt"), "ignored");
  await writeFile(join(root, "selected.txt"), "selected");
  await writeFile(join(root, "other.txt"), "other");
  const preview = await gitSetup.preview(root);
  expect(preview.files.map((f) => f.path)).toEqual(
    expect.arrayContaining(["selected.txt", "other.txt", ".gitignore"]),
  );
  expect(preview.files.map((f) => f.path)).not.toContain("ignored.txt");
  expect((await gitSetup.readiness(root)).status).toBe("not_repository");
  await gitSetup.initialize(root);
  git("config", "commit.gpgsign", "false");
  git("add", "--", "other.txt");
  await gitSetup.commit(
    root,
    preview.files.filter((f) => f.path === "selected.txt"),
    author,
  );
  expect(git("ls-tree", "--name-only", "HEAD").trim()).toBe("selected.txt");
  expect(git("diff", "--cached", "--name-only").trim()).toBe("other.txt");
  expect(await readFile(join(root, "other.txt"), "utf8")).toBe("other");
});
it("rejects changed previews before staging or committing", async () => {
  await writeFile(join(root, "file.txt"), "before");
  const preview = await gitSetup.preview(root);
  await gitSetup.initialize(root);
  await writeFile(join(root, "file.txt"), "after");
  await expect(gitSetup.commit(root, preview.files, author)).rejects.toThrow("changed");
  expect(git("ls-files")).toBe("");
  expect((await gitSetup.readiness(root)).status).toBe("no_commits");
});
it("reports inaccessible/broken metadata rather than offering initialization", async () => {
  await writeFile(join(root, ".git"), "gitdir: /nonexistent/code60-test-git-dir");
  expect((await gitSetup.readiness(root)).status).toBe("unavailable");
  await expect(gitSetup.initialize(root)).rejects.toThrow();
});
it("distinguishes missing Git and preserves cancellation", async () => {
  vi.spyOn(exec, "runGit").mockRejectedValue(new exec.GitError("spawn git ENOENT", [], "", null));
  expect((await gitSetup.readiness(root)).status).toBe("missing");
  const abort = new AbortController();
  abort.abort(new Error("cancelled"));
  await expect(gitSetup.readiness(root, abort.signal)).rejects.toThrow("cancelled");
});
it.skipIf(process.platform === "win32")(
  "respects failing hooks and leaves staged files intact without a commit",
  async () => {
    await writeFile(join(root, "file.txt"), "content");
    await gitSetup.initialize(root);
    git("config", "commit.gpgsign", "false");
    await mkdir(join(root, ".git", "hooks"), { recursive: true });
    const hook = join(root, ".git", "hooks", "pre-commit");
    await writeFile(hook, "#!/bin/sh\nexit 1\n");
    await chmod(hook, 0o700);
    git("config", "core.hooksPath", join(root, ".git", "hooks"));
    const preview = await gitSetup.preview(root);
    await expect(gitSetup.commit(root, preview.files, author)).rejects.toThrow();
    expect((await gitSetup.readiness(root)).status).toBe("no_commits");
    expect(git("ls-files").trim()).toBe("file.txt");
  },
  20_000,
);

it("does not offer Code60 private data and rejects bare repositories", async () => {
  await mkdir(join(root, ".code60_workspace"));
  await writeFile(join(root, ".code60_workspace", "transcript"), "private");
  await writeFile(join(root, "db.sqlite"), "private");
  expect((await gitSetup.preview(root, undefined, [join(root, "db.sqlite")])).files).toEqual([]);
  git("init", "--bare", "--quiet");
  expect((await gitSetup.readiness(root)).status).toBe("unavailable");
  await expect(gitSetup.initialize(root)).rejects.toThrow("bare");
});
it("writes missing author settings only locally and respects signing failures", async () => {
  await gitSetup.initialize(root);
  git("config", "--local", "user.name", "");
  git("config", "--local", "user.email", "");
  const preview = await gitSetup.preview(root);
  expect(preview.author).toEqual({ name: "", email: "" });
  git("config", "commit.gpgsign", "true");
  git("config", "gpg.program", join(root, "missing-signer"));
  await expect(gitSetup.commit(root, [], author)).rejects.toThrow();
  expect((await gitSetup.readiness(root)).status).toBe("no_commits");
  expect(git("config", "--local", "user.name").trim()).toBe(author.name);
  expect(git("config", "--local", "user.email").trim()).toBe(author.email);
});
it.skipIf(process.platform === "win32")(
  "cancels a commit and its hook process while preserving staged files",
  async () => {
    await gitSetup.initialize(root);
    git("config", "commit.gpgsign", "false");
    await writeFile(join(root, "file.txt"), "keep");
    const hook = join(root, ".git", "hooks", "pre-commit");
    await writeFile(hook, '#!/bin/sh\necho $$ > "$PWD/.git/hook-pid"\nexec sleep 60\n', {
      mode: 0o700,
    });
    git("config", "core.hooksPath", join(root, ".git", "hooks"));
    const preview = await gitSetup.preview(root);
    const abort = new AbortController();
    const pending = gitSetup.commit(root, preview.files, author, abort.signal);
    const rejected = expect(pending).rejects.toThrow("cancelled");
    let settled = false;
    pending.then(
      () => (settled = true),
      () => (settled = true),
    );
    // Wait for the hook itself, not a fixed delay: Git startup is slow under a loaded suite.
    let pid = 0;
    for (;;) {
      const done = settled;
      pid = Number(await readFile(join(root, ".git", "hook-pid"), "utf8").catch(() => "0"));
      if (pid > 0) break;
      if (done) throw new Error("The commit settled before its hook reported a PID");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    abort.abort(new Error("cancelled"));
    await rejected;
    expect(() => process.kill(pid, 0)).toThrow();
    expect((await gitSetup.readiness(root)).status).toBe("no_commits");
    expect(git("ls-files").trim()).toBe("file.txt");
    expect(await readFile(join(root, "file.txt"), "utf8")).toBe("keep");
  },
  20_000,
);

it("reports a disappeared project as unavailable rather than missing Git", async () => {
  expect((await gitSetup.readiness(join(root, "gone"))).status).toBe("unavailable");
});
