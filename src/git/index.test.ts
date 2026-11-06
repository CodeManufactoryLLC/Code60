import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
    await symlink(external, join(wt, "external-link"));
    await symlink(parent, join(wt, "directory-link"));
    await writeFile(join(wt, "ignored.txt"), "ignored content");

    const worktrees = await g.listWorktrees(repo);
    expect(worktrees).toHaveLength(2);
    const linked = worktrees.find((worktree) => worktree.path === wt);
    expect(linked).toMatchObject({
      path: wt,
      branch: "code60/r1",
      sizeBytes:
        Buffer.byteLength("one\n") +
        Buffer.byteLength("bee\n") +
        Buffer.byteLength("ignored.txt\n") +
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
    const detached = join(dir, "detached\nworktree");
    const missing = join(dir, "missing");
    git(repo, "worktree", "add", "--detach", detached, "HEAD");
    git(repo, "worktree", "add", "--detach", missing, "HEAD");
    await rm(missing, { recursive: true });
    const worktrees = await g.listWorktrees(detached);
    expect(worktrees.map((worktree) => worktree.path)).toEqual([repo, detached]);
    expect(worktrees[1]?.branch).toBeNull();
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
