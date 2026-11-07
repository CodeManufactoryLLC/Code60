import { execFileSync } from "node:child_process";

/** Seed test data without requiring or changing the developer's Git identity. */
export function commitFixture(directory: string): void {
  const git = (args: string[], input?: string) =>
    execFileSync("git", args, {
      cwd: directory,
      encoding: "utf8",
      ...(input ? { input } : {}),
    }).trim();
  const tree = git(["write-tree"]);
  const commit = git(
    ["hash-object", "-t", "commit", "-w", "--stdin"],
    `tree ${tree}\nauthor Code60 Fixture <fixture@example.invalid> 1700000000 +0000\ncommitter Code60 Fixture <fixture@example.invalid> 1700000000 +0000\n\nInitial fixture\n`,
  );
  git(["update-ref", "HEAD", commit]);
}
