import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verify, writeManifest } from "../scripts/release/artifacts.mjs";
import { newerStable, validateCandidate, versionOf } from "../scripts/release/common.mjs";

const sha = "a".repeat(40);
const candidate = {
  tag: "v0.2.0",
  sha,
  onMain: true,
  manifest: { version: "0.2.0" },
  lock: { version: "0.2.0", packages: { "": { version: "0.2.0" } } },
};
const directories = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
describe("release validation", () => {
  it.each(["", "main", "--help", "v01.2.3", "v1.2.3-01", "v1.2", "v1.2.3\nsha=bad", "v1.2.3;id"])(
    "rejects invalid tag %j",
    (tag) => expect(() => versionOf(tag)).toThrow(),
  );
  it("accepts semantic release identities and compares stable versions", () => {
    expect(versionOf("v1.2.3")).toMatchObject({ version: "1.2.3", prerelease: false });
    expect(versionOf("v1.0.0-alpha.1")).toMatchObject({
      version: "1.0.0-alpha.1",
      prerelease: true,
    });
    expect(versionOf("v1.2.3-beta.1").prerelease).toBe(true);
    expect(newerStable("v1.10.0", ["v1.9.0", "v1.11.0-beta.1"])).toBe(true);
    expect(newerStable("v1.9.0", ["v1.10.0"])).toBe(false);
    expect(newerStable("v1.10.0-beta.2", ["v1.9.0"])).toBe(false);
    expect(newerStable("v1.10.0", ["v1.10.0"])).toBe(false);
  });
  it("pins manifest, lockfile, main ancestry and unpublished release identity", () => {
    expect(validateCandidate(candidate).version).toBe("0.2.0");
    for (const patch of [
      { sha: "bad" },
      { expectedSha: "b".repeat(40) },
      { onMain: false },
      { manifest: { version: "0.3.0" } },
      { release: { draft: false } },
      { release: { draft: true, target_commitish: "b".repeat(40) } },
    ])
      expect(() => validateCandidate({ ...candidate, ...patch })).toThrow();
  });
});
it("verifies npm release identities, checksums and exact contents", async () => {
  const directory = await mkdtemp(join(tmpdir(), "code60-release-"));
  directories.push(directory);
  await writeFile(join(directory, "code60-0.2.0.tgz"), "synthetic npm package");
  await writeManifest(directory, candidate.tag, sha);
  expect((await verify(directory, candidate.tag, sha)).archive.name).toBe("code60-0.2.0.tgz");
  await expect(verify(directory, candidate.tag, "b".repeat(40))).rejects.toThrow("identity");
  await writeFile(join(directory, "code60-0.2.0.tgz"), "changed");
  await expect(verify(directory, candidate.tag, sha)).rejects.toThrow("checksum");
  await writeManifest(directory, candidate.tag, sha);
  await writeFile(join(directory, "unexpected"), "x");
  await expect(verify(directory, candidate.tag, sha)).rejects.toThrow("Unexpected");
});
it("ships a Node 24 management executable without Electron or native installers", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  expect(manifest.bin).toEqual({ code60: "dist/management/main.js" });
  expect(manifest.os).toEqual(["darwin", "linux"]);
  expect(manifest.main).toBeUndefined();
  expect(manifest.engines.node).toBe(">=24 <25");
  for (const group of [manifest.dependencies, manifest.devDependencies])
    for (const name of ["electron", "electron-builder", "electron-updater"])
      expect(group[name]).toBeUndefined();
  for (const name of ["package:mac", "package:linux", "test:desktop"])
    expect(manifest.scripts[name]).toBeUndefined();
});
