import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listTreeFiles, parseLsTreeOutput, readBlobs, syncMainBranch } from "./codebase.js";
import { runGit } from "./exec.js";

const dirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

async function git(args: string[], cwd: string): Promise<string> {
  return runGit(args, cwd, {
    env: {
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  });
}

afterEach(async () => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("git codebase sync and tree reader", () => {
  it("parses ls-tree -r -l -z entries and skips symlinks/trees", () => {
    const oid = "a".repeat(40);
    const out = [
      `100644 blob ${oid}      42\tsrc/app.ts`,
      `100755 blob ${oid}     128\tscripts/run.sh`,
      `120000 blob ${oid}      10\tlink.ts`,
      `160000 commit ${oid}       -\tsubmodule`,
    ].join("\0");
    expect(parseLsTreeOutput(out)).toEqual([
      { path: "src/app.ts", oid, size: 42 },
      { path: "scripts/run.sh", oid, size: 128 },
    ]);
  });

  it("indexes local main without remote and reads blobs while skipping binary/symlinks", async () => {
    const repo = await makeTempDir("code60-git-local-");
    await git(["init", "-b", "main"], repo);
    await writeFile(join(repo, "hello.ts"), "export const greet = () => 'hi';\n");
    await writeFile(join(repo, "binary.bin"), Buffer.from([0x00, 0x01, 0x02, 0xff]));
    await symlink("hello.ts", join(repo, "alias.ts"));
    await git(["add", "hello.ts", "binary.bin", "alias.ts"], repo);
    await git(["commit", "-m", "init"], repo);
    await writeFile(join(repo, "untracked.ts"), "not committed");

    const snapshot = await syncMainBranch(repo);
    expect(snapshot.branch).toBe("main");
    expect(snapshot.ref).toBe("refs/heads/main");
    expect(snapshot.hasOrigin).toBe(false);
    expect(snapshot.fetchStatus).toBe("no_remote");

    const files = await listTreeFiles(repo, snapshot.commit);
    expect(files.map((f) => f.path).sort()).toEqual(["binary.bin", "hello.ts"]);

    const blobs = await readBlobs(
      repo,
      files.map((f) => f.oid),
    );
    const hello = files.find((f) => f.path === "hello.ts");
    const bin = files.find((f) => f.path === "binary.bin");
    expect(hello && blobs.get(hello.oid)).toBe("export const greet = () => 'hi';\n");
    expect(bin && blobs.has(bin.oid)).toBe(false);
  });

  it("fetches latest origin/main non-mutatingly without disturbing local branch or dirty worktree", async () => {
    const bare = await makeTempDir("code60-git-origin-");
    const seed = await makeTempDir("code60-git-seed-");
    const clone = await makeTempDir("code60-git-clone-");

    await git(["init", "--bare", "-b", "main"], bare);
    await git(["init", "-b", "main"], seed);
    await git(["remote", "add", "origin", bare], seed);
    await writeFile(join(seed, "v1.ts"), "export const v = 1;\n");
    await git(["add", "v1.ts"], seed);
    await git(["commit", "-m", "v1"], seed);
    await git(["push", "-u", "origin", "main"], seed);

    await git(["clone", bare, clone], tmpdir());
    // Dirty the working tree on local main.
    await writeFile(join(clone, "v1.ts"), "export const v = 999; // dirty local edit\n");

    // Push a new commit to origin/main from seed.
    await writeFile(join(seed, "v2.ts"), "export const v = 2;\n");
    await git(["add", "v2.ts"], seed);
    await git(["commit", "-m", "v2"], seed);
    await git(["push", "origin", "main"], seed);
    const latestRemoteCommit = (await git(["rev-parse", "HEAD"], seed)).trim();
    const localMainBefore = (await git(["rev-parse", "refs/heads/main"], clone)).trim();

    const snapshot = await syncMainBranch(clone);
    expect(snapshot.hasOrigin).toBe(true);
    expect(snapshot.fetchStatus).toBe("fetched");
    expect(snapshot.branch).toBe("main");
    expect(snapshot.ref).toBe("refs/remotes/origin/main");
    expect(snapshot.commit).toBe(latestRemoteCommit);

    // Local branch and dirty working tree must remain untouched.
    expect((await git(["rev-parse", "refs/heads/main"], clone)).trim()).toBe(localMainBefore);
    expect(await readFile(join(clone, "v1.ts"), "utf8")).toContain("dirty local edit");

    const files = await listTreeFiles(clone, snapshot.commit);
    expect(files.map((f) => f.path).sort()).toEqual(["v1.ts", "v2.ts"]);
  });

  it("falls back to local main when origin fetch fails", async () => {
    const repo = await makeTempDir("code60-git-offline-");
    await git(["init", "-b", "main"], repo);
    await git(["remote", "add", "origin", join(repo, "missing-remote.git")], repo);
    await writeFile(join(repo, "a.ts"), "export const a = 1;\n");
    await git(["add", "a.ts"], repo);
    await git(["commit", "-m", "init"], repo);
    const localCommit = (await git(["rev-parse", "HEAD"], repo)).trim();

    const snapshot = await syncMainBranch(repo);
    expect(snapshot.hasOrigin).toBe(true);
    expect(snapshot.fetchStatus).toBe("failed");
    expect(snapshot.fetchWarning).toBeTruthy();
    expect(snapshot.ref).toBe("refs/heads/main");
    expect(snapshot.commit).toBe(localCommit);
  });

  it("falls back to non-main default branch when origin uses master", async () => {
    const bare = await makeTempDir("code60-git-master-origin-");
    const seed = await makeTempDir("code60-git-master-seed-");
    const clone = await makeTempDir("code60-git-master-clone-");

    await git(["init", "--bare", "-b", "master"], bare);
    await git(["init", "-b", "master"], seed);
    await git(["remote", "add", "origin", bare], seed);
    await writeFile(join(seed, "index.ts"), "export const ok = true;\n");
    await git(["add", "index.ts"], seed);
    await git(["commit", "-m", "init"], seed);
    await git(["push", "-u", "origin", "master"], seed);

    await git(["clone", bare, clone], tmpdir());
    const snapshot = await syncMainBranch(clone);
    expect(snapshot.branch).toBe("master");
    expect(snapshot.ref).toBe("refs/remotes/origin/master");
    expect(snapshot.fetchStatus).toBe("fetched");
  });
});
