import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const config = parse(await readFile(new URL("../.github/dependabot.yml", import.meta.url), "utf8"));

describe("dependency update automation", () => {
  it("covers the npm manifest and lockfile and GitHub Actions from the repository root", async () => {
    expect(config.version).toBe(2);
    expect(config.updates.map((update) => update["package-ecosystem"]).sort()).toEqual([
      "github-actions",
      "npm",
    ]);
    for (const update of config.updates) expect(update.directory).toBe("/");

    const manifest = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    );
    const lock = JSON.parse(
      await readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
    );
    expect(lock.packages[""].dependencies).toEqual(manifest.dependencies);
    expect(lock.packages[""].devDependencies).toEqual(manifest.devDependencies);
  });

  it("opens bounded weekly update PRs against the default branch without ignoring dependencies", () => {
    for (const update of config.updates) {
      expect(update.schedule).toEqual({
        interval: "weekly",
        day: "monday",
        time: "09:00",
        timezone: "Etc/UTC",
      });
      expect(update["open-pull-requests-limit"]).toBeGreaterThan(0);
      expect(update["open-pull-requests-limit"]).toBeLessThanOrEqual(10);
      expect(update["target-branch"]).toBeUndefined();
      expect(update.ignore).toBeUndefined();
      expect(update.allow).toBeUndefined();
    }
  });

  it("groups routine updates but leaves major upgrades and security fixes independent", () => {
    const npm = config.updates.find((update) => update["package-ecosystem"] === "npm");
    expect(
      Object.values(npm.groups)
        .map((group) => group["dependency-type"])
        .sort(),
    ).toEqual(["development", "production"]);

    const actions = config.updates.find(
      (update) => update["package-ecosystem"] === "github-actions",
    );
    expect(Object.values(actions.groups)).toHaveLength(1);
    expect(Object.values(actions.groups)[0].patterns).toEqual(["*"]);

    for (const update of config.updates) {
      for (const group of Object.values(update.groups)) {
        expect(group["update-types"]).toEqual(["minor", "patch"]);
        expect(group["applies-to"] ?? "version-updates").toBe("version-updates");
      }
    }
  });
});
