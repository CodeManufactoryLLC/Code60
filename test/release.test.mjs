import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { refreshDmgMetadata, verify, verifyUpdateMetadata } from "../scripts/release/artifacts.mjs";
import {
  assetNames,
  digest,
  newerStable,
  run,
  signingReady,
  unsignedWindowsBeta,
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

async function artifacts(version = "0.2.0", unsigned = false) {
  const directory = await mkdtemp(join(tmpdir(), "code60-artifacts-"));
  directories.push(directory);
  for (const platform of ["mac", "linux", "win"]) {
    const assets = [];
    const names = assetNames(version, platform);
    const files = names
      .filter((name) => !name.endsWith(".yml"))
      .map((name) => ({
        url: name,
        sha512: createHash("sha512").update(`installer ${name}`).digest("base64"),
      }));
    for (const name of names) {
      await writeFile(
        join(directory, name),
        name.endsWith(".yml")
          ? JSON.stringify({ version, files, path: files[0].url, sha512: files[0].sha512 })
          : `installer ${name}`,
      );
      assets.push({ name, sha256: await digest(join(directory, name)) });
    }
    await writeFile(
      join(directory, `manifest-${platform}.json`),
      JSON.stringify({
        tag: `v${version}`,
        sha,
        platform,
        assets,
        ...(platform === "win"
          ? {
              signaturesVerified: !unsigned,
              ...(unsigned
                ? {
                    signing: "unsigned-beta",
                    nativeX64: true,
                    installedAppVerified: true,
                    verifiedOn: { platform: "win32", arch: "x64", release: "10.0.26100" },
                  }
                : {}),
            }
          : {}),
      }),
    );
  }
  return directory;
}
describe("release artifact promotion", () => {
  it("refreshes only the DMG checksum after Apple stapling", async () => {
    const directory = await artifacts();
    const name = assetNames("0.2.0", "mac")[0];
    await writeFile(join(directory, name), "stapled final DMG");
    await expect(verifyUpdateMetadata(directory, "0.2.0", "mac")).rejects.toThrow("checksum");
    await refreshDmgMetadata(directory, "0.2.0");
    await expect(verifyUpdateMetadata(directory, "0.2.0", "mac")).resolves.toBeUndefined();
  });
  it("includes stable and prerelease updater metadata on every platform", () => {
    for (const [platform, suffix] of [
      ["mac", "-mac"],
      ["linux", "-linux"],
      ["win", ""],
    ]) {
      expect(assetNames("0.2.0", platform).at(-1)).toBe(`latest${suffix}.yml`);
      expect(assetNames("0.2.0-beta.5", platform).at(-1)).toBe(`beta${suffix}.yml`);
    }
  });
  it("rejects stale metadata, foreign URLs and incorrect checksums", async () => {
    const directory = await artifacts();
    const path = join(directory, "latest-mac.yml");
    const original = JSON.parse(await readFile(path, "utf8"));
    for (const mutate of [
      (data) => {
        data.version = "0.1.0";
      },
      (data) => {
        data.files[0].url = "https://example.invalid/foreign.zip";
      },
      (data) => {
        data.files[0].sha512 = "bad";
      },
      (data) => {
        data.files.pop();
      },
      (data) => {
        data.path = "../foreign.zip";
      },
    ]) {
      const data = structuredClone(original);
      mutate(data);
      await writeFile(path, JSON.stringify(data));
      await expect(verifyUpdateMetadata(directory, "0.2.0", "mac")).rejects.toThrow();
    }
  });
  it("requires every installer from the same exact commit", async () => {
    const directory = await artifacts();
    expect(await verify(directory, "v0.2.0", sha, {})).toHaveLength(8);
    await expect(verify(directory, "v0.2.0", "b".repeat(40), {})).rejects.toThrow("identity");
  });
  it("rejects changed bytes, missing installers, missing manifests and unexpected files", async () => {
    for (const change of ["modified", "missing", "manifest", "extra"]) {
      const directory = await artifacts();
      const file = join(directory, assetNames("0.2.0", "linux")[0]);
      if (change === "modified") await writeFile(file, "changed");
      if (change === "missing") await rm(file);
      if (change === "manifest") await rm(join(directory, "manifest-mac.json"));
      if (change === "extra") await writeFile(join(directory, "unexpected"), "extra");
      await expect(verify(directory, "v0.2.0", sha, {})).rejects.toThrow();
    }
  });
  it("rejects duplicate entries instead of accepting a missing target", async () => {
    const directory = await artifacts();
    const path = join(directory, "manifest-linux.json");
    const manifest = JSON.parse(await readFile(path, "utf8"));
    manifest.assets[1] = manifest.assets[0];
    await writeFile(path, JSON.stringify(manifest));
    await expect(verify(directory, "v0.2.0", sha, {})).rejects.toThrow();
  });
});

describe("explicit unsigned Windows betas", () => {
  const unsigned = { CODE60_UNSIGNED_WINDOWS_BETA: "1" };
  it("requires opt-in and a beta tag, retaining all Apple requirements", () => {
    expect(unsignedWindowsBeta("0.2.0-beta.5", {})).toBe(false);
    expect(unsignedWindowsBeta("0.2.0-beta.5", unsigned)).toBe(true);
    for (const version of ["0.2.0", "0.2.0-rc.1", "0.2.0-alpha.1", "bad"])
      expect(() => unsignedWindowsBeta(version, unsigned)).toThrow();
    expect(() =>
      unsignedWindowsBeta("0.2.0-beta.5", { CODE60_UNSIGNED_WINDOWS_BETA: "true" }),
    ).toThrow();
    const env = {
      ...ready,
      ...unsigned,
      RELEASE_TAG: "v0.2.0-beta.5",
      HAS_WIN_CSC_LINK: "",
      HAS_WIN_CSC_KEY_PASSWORD: "",
      HAS_WIN_SIGNING_THUMBPRINT: "",
    };
    expect(() => signingReady(env)).not.toThrow();
    expect(() => signingReady({ ...env, HAS_APPLE_API_KEY: "" })).toThrow();
    expect(() => signingReady({ ...env, CODE60_UNSIGNED_WINDOWS_BETA: "0" })).toThrow();
    expect(() => signingReady({ ...env, RELEASE_TAG: "v0.2.0" })).toThrow();
  });
  it("promotes only the explicit signing mode with native installer verification", async () => {
    const directory = await artifacts("0.2.0-beta.5", true);
    await expect(verify(directory, "v0.2.0-beta.5", sha, unsigned)).resolves.toHaveLength(8);
    await expect(verify(directory, "v0.2.0-beta.5", sha, {})).rejects.toThrow("signature");
    const path = join(directory, "manifest-win.json");
    const original = JSON.parse(await readFile(path, "utf8"));
    for (const change of [
      { nativeX64: false },
      { installedAppVerified: false },
      { signing: "authenticode" },
      { signaturesVerified: true },
    ]) {
      await writeFile(path, JSON.stringify({ ...original, ...change }));
      await expect(verify(directory, "v0.2.0-beta.5", sha, unsigned)).rejects.toThrow("signature");
    }
    const signed = await artifacts("0.2.0-beta.5");
    await expect(verify(signed, "v0.2.0-beta.5", sha, unsigned)).rejects.toThrow("signature");
  });
});
