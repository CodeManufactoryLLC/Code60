import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";

const directories = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

it("resolves annotated tags and rejects missing tags or commits outside remote main", async () => {
  const directory = await mkdtemp(join(tmpdir(), "code60-release-git-"));
  directories.push(directory);
  const origin = join(directory, "origin.git");
  const checkout = join(directory, "checkout");
  const git = (args, cwd = directory) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git(["init", "--bare", "-q", origin]);
  git(["clone", "-q", origin, checkout]);
  git(["checkout", "-b", "main"], checkout);
  git(["config", "user.name", "Code60 Test"], checkout);
  git(["config", "user.email", "ci@example.invalid"], checkout);
  await writeFile(join(checkout, "package.json"), JSON.stringify({ version: "0.2.0" }));
  await writeFile(
    join(checkout, "package-lock.json"),
    JSON.stringify({ version: "0.2.0", packages: { "": { version: "0.2.0" } } }),
  );
  git(["add", "."], checkout);
  git(["commit", "-qm", "Version"], checkout);
  const sha = git(["rev-parse", "HEAD"], checkout);
  git(["tag", "-a", "v0.2.0", "-m", "Release"], checkout);
  git(["push", "-q", "origin", "main", "--tags"], checkout);
  const module = new URL("../scripts/release/common.mjs", import.meta.url).href;
  const validate = (tag) =>
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { candidate } from ${JSON.stringify(module)}; console.log(candidate(process.argv[1]).sha);`,
        tag,
      ],
      { cwd: checkout, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  expect(validate("v0.2.0")).toBe(sha);
  expect(() => validate("v9.9.9")).toThrow();
  git(["checkout", "-b", "unmerged"], checkout);
  git(["commit", "--allow-empty", "-qm", "Not on main"], checkout);
  git(["tag", "v0.2.1"], checkout);
  git(["push", "-q", "origin", "v0.2.1"], checkout);
  expect(() => validate("v0.2.1")).toThrow(/must belong to main/);
});
