import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assetNames, digest, git, json, versionOf } from "./common.mjs";

export async function stage(
  platform,
  directory = "release/build",
  destination = `release/staged/${platform}`,
) {
  const tag = process.env.RELEASE_TAG;
  const { version } = versionOf(tag);
  const sha = git("rev-parse", "HEAD");
  if (sha !== process.env.RELEASE_SHA)
    throw new Error("Artifact checkout does not match validated release SHA");
  await mkdir(destination, { recursive: true });
  const assets = [];
  for (const name of assetNames(version, platform)) {
    await copyFile(join(directory, name), join(destination, name));
    assets.push({ name, sha256: await digest(join(destination, name)) });
  }
  let signaturesVerified;
  if (platform === "win") {
    const report = await json("release/windows-verification.json");
    if (
      report.verified !== true ||
      report.nativeX64 !== true ||
      typeof report.certificate !== "string" ||
      report.certificate.toUpperCase() !==
        (process.env.WIN_SIGNING_THUMBPRINT || "").toUpperCase() ||
      report.version !== version ||
      report.installerSha256 !== assets[0].sha256
    )
      throw new Error("Windows signing and installed-app verification is missing");
    signaturesVerified = true;
  }
  await writeFile(
    join(destination, `manifest-${platform}.json`),
    `${JSON.stringify({ tag, sha, platform, assets, signaturesVerified }, null, 2)}\n`,
  );
}
export async function verify(directory, tag, sha) {
  const { version } = versionOf(tag);
  const assets = [];
  for (const platform of ["linux", "mac", "win"]) {
    const manifest = await json(join(directory, `manifest-${platform}.json`));
    if (manifest.tag !== tag || manifest.sha !== sha || manifest.platform !== platform)
      throw new Error("Artifact source identity mismatch");
    if (platform === "win" && manifest.signaturesVerified !== true)
      throw new Error("Windows signature verification is missing");
    const expected = assetNames(version, platform);
    if (!Array.isArray(manifest.assets) || manifest.assets.length !== expected.length)
      throw new Error("Missing or unexpected artifacts");
    for (const name of expected) {
      const entry = manifest.assets.find((asset) => asset.name === name);
      if (
        !entry ||
        !/^[a-f\d]{64}$/.test(entry.sha256) ||
        (await digest(join(directory, name))) !== entry.sha256
      )
        throw new Error(`Artifact checksum mismatch: ${name}`);
      assets.push(entry);
    }
  }
  const expectedFiles = [
    ...assets.map((asset) => asset.name),
    "manifest-linux.json",
    "manifest-mac.json",
    "manifest-win.json",
  ].sort();
  if (JSON.stringify((await readdir(directory)).sort()) !== JSON.stringify(expectedFiles))
    throw new Error("Unexpected files in release artifact download");
  return assets;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await stage(process.argv[2]);
}
