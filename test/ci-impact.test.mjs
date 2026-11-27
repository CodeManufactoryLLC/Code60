import { execFileSync } from "node:child_process";
import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { changedPaths, checkGate, classify, selectedJobs } from "../scripts/ci-impact.mjs";

const full = classify(null);
it.each([
  ["docs/runbooks/setup.md", ["instructions"]],
  ["knowledge/reference/capabilities.md", ["instructions"]],
  ["docs/review/after.png", ["instructions"]],
  ["src/renderer/Page.tsx", ["check", "browser"]],
  ["test/core-reconnect.test.ts", ["check"]],
  [
    "src/application/rag-model.ts",
    [
      "check",
      "package",
      "clean-install",
      "payload-smoke",
      "clean-payload",
      "mac-package",
      "mac-payload",
    ],
  ],
  [
    "src/gateway/registration.ts",
    [
      "check",
      "browser",
      "setup",
      "shell",
      "managed",
      "clean-setup",
      "update",
      "clean-update",
      "clean-uninstall",
      "mac-setup",
      "mac-shell",
      "mac-update",
      "mac-uninstall",
    ],
  ],
  ["src/management/update.ts", ["check", "update", "clean-update", "mac-update"]],
  ["test/update-installed.e2e.ts", ["check", "update", "clean-update", "mac-update"]],
  ["scripts/test-uninstall.mjs", ["check", "clean-uninstall", "mac-uninstall"]],
  ["test/clean-install/uninstall.mjs", ["check", "clean-uninstall"]],
  ["test/clean-install/install-managed.mjs", ["check", "managed"]],
  ["package-lock.json", full],
  [".github/workflows/ci.yml", full],
  ["scripts/ci-impact.mjs", full],
  ["future/unknown.md", full],
  ["packaging/icon.png", full],
])("routes %s", (path, expected) => expect(classify([path])).toEqual(expected));

it("unions different owners and defaults missing or empty changes to full", () => {
  expect(classify(["README.md", "src/renderer/A.tsx", "src/management/update.ts"])).toEqual([
    "check",
    "browser",
    "update",
    "clean-update",
    "mac-update",
  ]);
  expect(selectedJobs(classify(["src/management/update.ts"]))).toEqual([
    "check",
    "payload",
    "payload-acceptance",
    "update",
    "mac",
  ]);
  expect(selectedJobs(classify(["test/clean-install/uninstall.mjs"]))).toEqual([
    "check",
    "payload",
    "uninstall",
  ]);
  expect(selectedJobs(classify(["test/clean-install/install-managed.mjs"]))).toEqual([
    "check",
    "payload",
    "payload-clean-install",
  ]);
  expect(selectedJobs(full)).toEqual([
    "check",
    "browser",
    "package",
    "clean-install",
    "payload",
    "payload-acceptance",
    "payload-clean-install",
    "update",
    "uninstall",
    "mac",
  ]);
  expect(classify([])).toEqual(full);
});

it("reads both sides of renames, deletions and the correct event range", () => {
  const cwd = mkdtempSync(join(tmpdir(), "ci-impact-"));
  const git = (...args) =>
    execFileSync(
      "git",
      [
        "-c",
        "user.name=CI",
        "-c",
        "user.email=ci@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "core.hooksPath=/dev/null",
        ...args,
      ],
      { cwd, encoding: "utf8" },
    ).trim();
  try {
    git("init", "-b", "base");
    writeFileSync(join(cwd, "old"), "old");
    writeFileSync(join(cwd, "gone"), "gone");
    git("add", ".");
    git("commit", "-m", "base");
    const common = git("rev-parse", "HEAD");
    git("switch", "-c", "feature");
    renameSync(join(cwd, "old"), join(cwd, "new\nname"));
    git("rm", "gone");
    git("add", ".");
    git("commit", "-m", "feature");
    const head = git("rev-parse", "HEAD");
    git("switch", "base");
    writeFileSync(join(cwd, "only-on-base"), "base");
    git("add", ".");
    git("commit", "-m", "advance");
    const base = git("rev-parse", "HEAD");
    const expected = ["gone", "new\nname", "old"];
    expect(
      changedPaths({ pull_request: { base: { sha: base }, head: { sha: head } } }, cwd),
    ).toEqual(expected);
    expect(changedPaths({ before: common, after: head }, cwd)).toEqual(expected);
    expect(changedPaths({ before: base, after: head }, cwd)).toContain("only-on-base");
    expect(changedPaths({ before: "0".repeat(40), after: head }, cwd)).toBeNull();
    expect(changedPaths({ before: "f".repeat(40), after: head }, cwd)).toBeNull();
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

it("accepts only expected skips and successful required jobs", () => {
  const plan = classify(["README.md"]);
  const needs = Object.fromEntries(
    selectedJobs(full).map((key) => [key, { result: key === "check" ? "success" : "skipped" }]),
  );
  needs.impact = { result: "success" };
  expect(() => checkGate(plan, needs)).not.toThrow();
  for (const result of ["failure", "cancelled", "skipped", undefined])
    expect(() => checkGate(plan, { ...needs, check: { result } })).toThrow();
  expect(() => checkGate(plan, { ...needs, impact: { result: "failure" } })).toThrow();
});
