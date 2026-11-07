import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";
import { assetNames, digest, git, json, versionOf } from "./common.mjs";

// Stapling the DMG changes its bytes after electron-builder wrote the YAML.
export async function refreshDmgMetadata(directory, version) {
  const [name, , metadataName] = assetNames(version, "mac");
  const path = join(directory, metadataName);
  const metadata = parse(await readFile(path, "utf8"));
  const entry = metadata?.files?.find((file) => file.url === name);
  if (!entry) throw new Error("Missing DMG update metadata");
  const bytes = await readFile(join(directory, name));
  entry.sha512 = createHash("sha512").update(bytes).digest("base64");
  if (entry.size !== undefined) entry.size = bytes.length;
  if (metadata.path === name) metadata.sha512 = entry.sha512;
  // JSON is a YAML subset and preserves all other metadata fields.
  await writeFile(path, `${JSON.stringify(metadata, null, 2)}\n`);
}

export async function verifyUpdateMetadata(directory, version, platform) {
  const names = assetNames(version, platform);
  const metadata = parse(await readFile(join(directory, names.at(-1)), "utf8"));
  const expected = names.filter((name) => !name.endsWith(".yml"));
  if (
    metadata?.version !== version ||
    !Array.isArray(metadata.files) ||
    metadata.files.length !== expected.length ||
    new Set(metadata.files.map((file) => file.url)).size !== expected.length
  )
    throw new Error("Invalid update metadata");
  for (const file of metadata.files) {
    if (!expected.includes(file.url)) throw new Error("Unexpected update URL");
    const bytes = await readFile(join(directory, file.url));
    if (
      file.sha512 !== createHash("sha512").update(bytes).digest("base64") ||
      (file.size !== undefined && file.size !== bytes.length)
    )
      throw new Error("Update metadata checksum mismatch");
  }
  const primary = metadata.files.find((file) => file.url === metadata.path);
  if (!primary || primary.sha512 !== metadata.sha512)
    throw new Error("Invalid primary update artifact");
}

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
  await verifyUpdateMetadata(destination, version, platform);
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
    await verifyUpdateMetadata(directory, version, platform);
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
