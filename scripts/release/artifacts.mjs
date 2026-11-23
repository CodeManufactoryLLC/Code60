import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { digest, versionOf } from "./common.mjs";

export async function writeManifest(directory, tag, sha) {
  const { version } = versionOf(tag);
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Invalid release commit");
  const name = `code60-${version}.tgz`;
  const sha256 = await digest(join(directory, name));
  const manifest = {
    version,
    sha,
    runtime: "Node 24",
    platforms: ["macOS arm64", "Linux x64"],
    archive: { name, sha256 },
  };
  await writeFile(join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(directory, "SHA256SUMS.txt"), `${sha256}  ${name}\n`);
  return manifest;
}
export async function verify(directory, tag, sha) {
  const { version } = versionOf(tag);
  const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
  const name = `code60-${version}.tgz`;
  if (
    manifest.version !== version ||
    manifest.sha !== sha ||
    manifest.runtime !== "Node 24" ||
    manifest.archive?.name !== name
  )
    throw new Error("Release manifest identity mismatch");
  const expected = ["manifest.json", "SHA256SUMS.txt", name].sort();
  if (JSON.stringify((await readdir(directory)).sort()) !== JSON.stringify(expected))
    throw new Error("Unexpected release files");
  const sha256 = await digest(join(directory, name));
  if (
    manifest.archive.sha256 !== sha256 ||
    (await readFile(join(directory, "SHA256SUMS.txt"), "utf8")) !== `${sha256}  ${name}\n`
  )
    throw new Error("Release checksum mismatch");
  return manifest;
}
