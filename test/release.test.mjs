import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verify } from "../scripts/release/artifacts.mjs";
import {
  assetNames,
  digest,
  newerStable,
  run,
  signingReady,
  validateCandidate,
  versionOf,
} from "../scripts/release/common.mjs";
import { staple } from "../scripts/release/staple.mjs";

const sha = "a".repeat(40);

it.runIf(process.platform === "win32")(
  "routes the native helper through the Windows signing transformer",
  () => {
    const resources = JSON.parse(
      run(
        process.execPath,
        ["-p", "JSON.stringify(require('./scripts/packaging-config.cjs').extraResources)"],
        {
          cwd: fileURLToPath(new URL("..", import.meta.url)),
          env: { ...process.env, CODE60_RELEASE: "0" },
        },
      ),
    );
    expect(resources.find((resource) => resource.to === "native")).toEqual({
      from: "native/win32/x64",
      to: "native",
      filter: ["code60-host.exe"],
    });
  },
);

describe("Apple ticket delivery", () => {
  it("retries temporary service failures and stops after success", async () => {
    const error = Object.assign(new Error("connection lost"), { status: 68 });
    const execute = vi
      .fn()
      .mockImplementationOnce(() => {
        throw error;
      })
      .mockReturnValue("");
    const wait = vi.fn();
    await staple("installer.dmg", execute, wait);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenLastCalledWith("/usr/bin/xcrun", [
      "stapler",
      "staple",
      "installer.dmg",
    ]);
    expect(wait).toHaveBeenCalledWith(15_000);
  });
  it.each([68, 65])("fails closed for persistent stapler result %s", async (status) => {
    const error = Object.assign(new Error("stapling failed"), { status });
    const execute = vi.fn(() => {
      throw error;
    });
    const wait = vi.fn();
    await expect(staple("installer.dmg", execute, wait)).rejects.toBe(error);
    expect(execute).toHaveBeenCalledTimes(status === 68 ? 3 : 1);
    expect(wait.mock.calls).toEqual(status === 68 ? [[15_000], [30_000]] : []);
  });
});
const candidate = {
  tag: "v0.2.0",
  sha,
  onMain: true,
  manifest: { version: "0.2.0" },
  lock: { version: "0.2.0", packages: { "": { version: "0.2.0" } } },
};
const ready = {
  HAS_CSC_LINK: "true",
  HAS_CSC_KEY_PASSWORD: "true",
  HAS_APPLE_API_KEY: "true",
  HAS_APPLE_API_KEY_ID: "true",
  HAS_APPLE_API_ISSUER: "true",
  HAS_WIN_CSC_LINK: "true",
  HAS_WIN_CSC_KEY_PASSWORD: "true",
  HAS_WIN_SIGNING_THUMBPRINT: "true",
  RELEASE_MAINTAINER: "Code60 Test <ci@example.invalid>",
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
  it("accepts stable and prerelease semantic versions", () => {
    expect(versionOf("v1.2.3").prerelease).toBe(false);
    expect(versionOf("v1.2.3-beta.1+build.2").prerelease).toBe(true);
    expect(validateCandidate(candidate).version).toBe("0.2.0");
  });
  it("rejects changed tags, invalid ancestry, version mismatches and existing publications", () => {
    for (const change of [
      { sha: "" },
      { expectedSha: "b".repeat(40) },
      { onMain: false },
      { manifest: { version: "0.2.1" } },
      { lock: { version: "0.2.0", packages: { "": { version: "0.1.0" } } } },
      { release: { draft: false } },
      { release: { draft: true, target_commitish: "b".repeat(40) } },
    ])
      expect(() => validateCandidate({ ...candidate, ...change })).toThrow();
    expect(() =>
      validateCandidate({ ...candidate, release: { draft: true, target_commitish: sha } }),
    ).not.toThrow();
  });
  it("requires all signing settings and real maintainer metadata", () => {
    expect(() => signingReady(ready)).not.toThrow();
    for (const key of Object.keys(ready))
      expect(() => signingReady({ ...ready, [key]: "" })).toThrow();
  });
  it("does not mark prereleases or older/equal stable versions as latest", () => {
    expect(newerStable("v1.10.0", ["v1.9.0", "v1.11.0-beta.1"])).toBe(true);
    expect(newerStable("v1.9.0", ["v1.10.0"])).toBe(false);
    expect(newerStable("v1.10.0-beta.2", ["v1.9.0"])).toBe(false);
    expect(newerStable("v1.10.0", ["v1.10.0"])).toBe(false);
  });
});

async function artifacts() {
  const directory = await mkdtemp(join(tmpdir(), "code60-artifacts-"));
  directories.push(directory);
  for (const platform of ["mac", "linux", "win"]) {
    const assets = [];
    for (const name of assetNames("0.2.0", platform)) {
      await writeFile(join(directory, name), `installer ${name}`);
      assets.push({ name, sha256: await digest(join(directory, name)) });
    }
    await writeFile(
      join(directory, `manifest-${platform}.json`),
      JSON.stringify({
        tag: "v0.2.0",
        sha,
        platform,
        assets,
        ...(platform === "win" ? { signaturesVerified: true } : {}),
      }),
    );
  }
  return directory;
}
describe("release artifact promotion", () => {
  it("requires every installer from the same exact commit", async () => {
    const directory = await artifacts();
    expect(await verify(directory, "v0.2.0", sha)).toHaveLength(4);
    await expect(verify(directory, "v0.2.0", "b".repeat(40))).rejects.toThrow("identity");
  });
  it("rejects changed bytes, missing installers, missing manifests and unexpected files", async () => {
    for (const change of ["modified", "missing", "manifest", "extra"]) {
      const directory = await artifacts();
      const file = join(directory, assetNames("0.2.0", "linux")[0]);
      if (change === "modified") await writeFile(file, "changed");
      if (change === "missing") await rm(file);
      if (change === "manifest") await rm(join(directory, "manifest-mac.json"));
      if (change === "extra") await writeFile(join(directory, "unexpected"), "extra");
      await expect(verify(directory, "v0.2.0", sha)).rejects.toThrow();
    }
  });
  it("rejects duplicate entries instead of accepting a missing target", async () => {
    const directory = await artifacts();
    const path = join(directory, "manifest-linux.json");
    const manifest = JSON.parse(await readFile(path, "utf8"));
    manifest.assets[1] = manifest.assets[0];
    await writeFile(path, JSON.stringify(manifest));
    await expect(verify(directory, "v0.2.0", sha)).rejects.toThrow();
  });
});
