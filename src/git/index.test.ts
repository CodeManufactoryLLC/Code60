import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as gitExec from "./exec.js";
import { createGit, parseNameStatus, parseWorktrees } from "./index.js";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

let dir: string;
let repo: string;

beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), "code60-git-")));
  repo = join(dir, "repo");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  git(repo, "config", "user.email", "test@example.com");
  git(repo, "config", "user.name", "Test");
  git(repo, "config", "commit.gpgsign", "false");
  await writeFile(join(repo, "a.txt"), "one\n");
  await writeFile(join(repo, "b.txt"), "bee\n");
  await writeFile(join(repo, ".gitignore"), "ignored.txt\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "init");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

describe("git", () => {
  const g = createGit();

  it("reports the repository's top level and common directory", async () => {
    expect(await g.repoInfo(repo)).toEqual({ topLevel: repo, commonDir: join(repo, ".git") });
    await expect(g.repoInfo(dir)).rejects.toThrow(/not inside a Git working tree/);
  });

  it("resolves revisions to commits and rejects bad ones", async () => {
    const head = git(repo, "rev-parse", "HEAD").trim();
    expect(await g.resolveCommit(repo, "HEAD")).toBe(head);
    await expect(g.resolveCommit(repo, "nope")).rejects.toThrow(/unknown revision 'nope'/);
    await expect(g.resolveCommit(repo, "--all")).rejects.toThrow(/invalid revision/);
  });

  it("lists worktrees and measures regular files without Git metadata or symlinks", async () => {
    const base = await g.resolveCommit(repo, "HEAD");
    const parent = join(dir, "worktrees with spaces");
    const wt = join(parent, "r1");
    await mkdir(parent);
    await g.addWorktree({ repoDir: repo, path: wt, branch: "code60/r1", base });
    await mkdir(join(wt, "nested"));
    await writeFile(join(wt, "nested", "data.txt"), "nested data");
    const external = join(dir, "external.txt");
    await writeFile(external, "outside");
    if (process.platform !== "win32") await symlink(external, join(wt, "external-link"));
    await symlink(
      parent,
      join(wt, "directory-link"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await writeFile(join(wt, "ignored.txt"), "ignored content");

    const worktrees = await g.listWorktrees(repo);
    expect(worktrees).toHaveLength(2);
    const linked = worktrees.find((worktree) => worktree.path === wt);
    expect(linked).toMatchObject({
      path: wt,
      branch: "code60/r1",
      sizeBytes:
        (await readFile(join(wt, "a.txt"))).length +
        (await readFile(join(wt, "b.txt"))).length +
        (await readFile(join(wt, ".gitignore"))).length +
        Buffer.byteLength("ignored content") +
        Buffer.byteLength("nested data"),
    });
    expect(worktrees.find((worktree) => worktree.path === repo)?.sizeBytes).toBe(
      Buffer.byteLength("one\nbee\nignored.txt\n"),
    );
    expect(linked?.createdAt === null || Number.isFinite(Date.parse(linked?.createdAt ?? ""))).toBe(
      true,
    );
  });

  it("lists externally created detached worktrees and skips missing paths", async () => {
    const detached = join(
      dir,
      process.platform === "win32" ? "detached 雪 worktree" : "detached\nworktree",
    );
    const missing = join(dir, "missing");
    git(repo, "worktree", "add", "--detach", detached, "HEAD");
    git(repo, "worktree", "add", "--detach", missing, "HEAD");
    await rm(missing, { recursive: true });
    const worktrees = await g.listWorktrees(detached);
    expect(worktrees.map((worktree) => worktree.path)).toEqual([repo, detached]);
    expect(worktrees[1]?.branch).toBeNull();
  });

  it("omits unrequested sizes and stops a hidden scan without returning a partial total", async () => {
    const unrequested = vi.fn(() => true);
    const inventory = await g.listWorktrees(repo, { sizes: false, current: unrequested });
    expect(inventory).toMatchObject([{ path: repo, sizeBytes: null }]);
    expect(unrequested).not.toHaveBeenCalled();
    let checks = 0;
    const interrupted = await g.listWorktrees(repo, { current: () => ++checks < 3 });
    expect(checks).toBe(3);
    expect(interrupted).toMatchObject([{ path: repo, sizeBytes: null }]);
    expect((await g.listWorktrees(repo))[0]?.sizeBytes).toBeGreaterThan(0);
  });

  it("parses NUL-delimited worktree fields, ignoring bare entries", () => {
    expect(
      parseWorktrees(
        "worktree /bare\0bare\0\0worktree /tree with\nspaces\0HEAD abc\0branch refs/heads/topic\0locked reason\0\0worktree /detached\0HEAD def\0detached\0\0",
      ),
    ).toEqual([
      { path: "/tree with\nspaces", branch: "topic" },
      { path: "/detached", branch: null },
    ]);
  });

  it("adds a worktree, diffs it with untracked files and commits, then removes it", async () => {
    const base = await g.resolveCommit(repo, "HEAD");
    const wt = join(dir, "repo.worktrees", "r1");
    await g.addWorktree({ repoDir: repo, path: wt, branch: "code60/r1", base });
    expect(git(wt, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("code60/r1");
    expect((await g.repoInfo(wt)).commonDir).toBe(join(repo, ".git"));

    await writeFile(join(wt, "a.txt"), "two\n");
    await writeFile(join(wt, "new.txt"), "fresh\n");
    await writeFile(join(wt, "ignored.txt"), "skip\n");
    await writeFile(join(wt, "committed.txt"), "agent commit\n");
    git(wt, "add", "committed.txt");
    git(wt, "-c", "user.email=a@b", "-c", "user.name=A", "commit", "-q", "-m", "agent");
    git(wt, "rm", "-q", "b.txt");
    const indexBefore = await readFile(join(repo, ".git", "worktrees", "r1", "index"));

    const diff = await g.diff(wt, base);
    expect(diff).toMatch(/^\+two$/m);
    expect(diff).toMatch(/^\+fresh$/m);
    expect(diff).toMatch(/^\+agent commit$/m);
    expect(diff).toMatch(/deleted file mode/);
    expect(diff).not.toMatch(/skip/);

    const files = await g.changedFiles(wt, base);
    expect(files.sort((x, y) => x.path.localeCompare(y.path))).toEqual([
      { path: "a.txt", status: "modified" },
      { path: "b.txt", status: "deleted" },
      { path: "committed.txt", status: "added" },
      { path: "new.txt", status: "untracked" },
    ]);
    expect(await readFile(join(repo, ".git", "worktrees", "r1", "index"))).toEqual(indexBefore);
    expect(git(wt, "status", "--porcelain")).toMatch(/^\?\? new.txt$/m);

    await g.removeWorktree(repo, wt, "code60/r1");
    expect(existsSync(wt)).toBe(false);
    expect(git(repo, "branch", "--list", "code60/r1").trim()).toBe("");
    await expect(g.removeWorktree(repo, wt, "code60/r1")).resolves.toBeUndefined();
  });

  it("removes a worktree whose directory the user already deleted", async () => {
    const base = await g.resolveCommit(repo, "HEAD");
    const wt = join(dir, "repo.worktrees", "r2");
    await g.addWorktree({ repoDir: repo, path: wt, branch: "code60/r2", base });
    await rm(wt, { recursive: true, force: true });
    await g.removeWorktree(repo, wt, "code60/r2");
    expect(git(repo, "worktree", "list")).not.toMatch(/r2/);
    expect(git(repo, "branch", "--list", "code60/r2").trim()).toBe("");
  });

  it("refuses branches the tool did not create", async () => {
    await expect(g.removeWorktree(repo, join(dir, "x"), "main")).rejects.toThrow(/refusing/);
  });
});

describe("parseNameStatus", () => {
  it("parses renames and marks untracked additions", () => {
    const out = ["M", "a", "R100", "old", "new", "A", "u", "A", "c", ""].join("\0");
    expect(parseNameStatus(out, new Set(["u"]))).toEqual([
      { path: "a", status: "modified" },
      { path: "new", status: "renamed" },
      { path: "u", status: "untracked" },
      { path: "c", status: "added" },
    ]);
  });
});

describe("cancelled snapshot indexes", () => {
  it.each([
    ["diff", "add"],
    ["diff", "diff"],
    ["reviewSnapshot", "add"],
    ["reviewSnapshot", "write-tree"],
    ["reviewSnapshot", "cat-file"],
  ] as const)("removes the temporary index after cancelling %s in %s", async (operation, stage) => {
    const g = createGit();
    const base = await g.resolveCommit(repo, "HEAD");
    await writeFile(join(repo, "a.txt"), "changed\n");
    const originalIndex = await readFile(join(repo, ".git", "index"));
    const abort = new AbortController();
    const execute = gitExec.runGit;
    let temporary = "";
    let stalled = false;
    vi.spyOn(gitExec, "runGit").mockImplementation(async (args, cwd, options) => {
      temporary = options?.env?.GIT_INDEX_FILE ?? temporary;
      if (args[0] === stage) {
        stalled = true;
        expect(existsSync(temporary)).toBe(true);
        // Hold this phase in flight until the test cancels it.
        return new Promise<string>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), {
            once: true,
          });
        });
      }
      return execute(args, cwd, options);
    });
    const pending = g[operation]?.(repo, base, abort.signal);
    const rejected = expect(pending).rejects.toThrow("cancelled");
    await vi.waitFor(() => expect(stalled).toBe(true));
    abort.abort(new Error("cancelled"));
    await rejected;
    expect(existsSync(dirname(temporary))).toBe(false);
    expect(await readFile(join(repo, ".git", "index"))).toEqual(originalIndex);
    expect(await readFile(join(repo, "a.txt"), "utf8")).toBe("changed\n");
  });
});

it("captures immutable structured review files with rename, binary and size limits without changing the index", async () => {
  const g = createGit();
  const base = await g.resolveCommit(repo, "HEAD");
  const index = await readFile(join(repo, ".git", "index"));
  git(repo, "mv", "b.txt", "renamed.txt");
  const staged = await readFile(join(repo, ".git", "index"));
  await writeFile(join(repo, "a.txt"), "after\n");
  await writeFile(join(repo, "binary.bin"), Buffer.from([0, 1, 2]));
  await writeFile(join(repo, "large.txt"), "x".repeat(1_048_577));
  const snapshot = await g.reviewSnapshot?.(repo, base);
  expect(snapshot?.files).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: "a.txt",
        original: "one\n",
        modified: "after\n",
        status: "modified",
      }),
      expect.objectContaining({ path: "renamed.txt", oldPath: "b.txt", status: "renamed" }),
      expect.objectContaining({ path: "binary.bin", limitation: "Binary or non-UTF-8 file" }),
      expect.objectContaining({ path: "large.txt", limitation: "File exceeds 1 MiB" }),
    ]),
  );
  expect(await readFile(join(repo, ".git", "index"))).toEqual(staged);
  expect(staged).not.toEqual(index);
  await writeFile(join(repo, "a.txt"), "later\n");
  expect(snapshot?.files.find((file) => file.path === "a.txt")?.modified).toBe("after\n");
});
