import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { verify } from "./artifacts.mjs";
import {
  candidate,
  github,
  newerStable,
  releases,
  unsignedWindowsBeta,
  versionOf,
} from "./common.mjs";

const tag = process.env.RELEASE_TAG || "";
const sha = process.env.RELEASE_SHA;
const { prerelease } = versionOf(tag);
const all = await releases();
let release = all.find((item) => item.tag_name === tag);
candidate(tag, release, sha);
const directory = "release-assets";
const assets = await verify(directory, tag, sha);
await writeFile(
  join(directory, "SHA256SUMS"),
  assets.map(({ name, sha256 }) => `${sha256}  ${name}\n`).join(""),
);
const generated = await github("/releases/generate-notes", {
  method: "POST",
  body: JSON.stringify({ tag_name: tag, target_commitish: sha }),
});
const windows = unsignedWindowsBeta(versionOf(tag).version)
  ? "**Windows x64 beta — UNSIGNED:** the NSIS installer has no Code60 Authenticode signature and Windows may show an unknown-publisher/SmartScreen warning. It passed native x64 Windows Server 2025 installer tests. Install only if you accept this beta limitation."
  : "**Windows 11 x64:** run the signed NSIS installer as your standard user.";
const body = `${generated.body}\n\n## Installation\n\n- **macOS Apple Silicon:** open the signed and notarized DMG and drag Code60 to Applications.\n- **Linux x64 (Ubuntu 24.04 verified):** install the DEB with \`sudo apt install ./Code60-*-linux-x64.deb\`, or make the AppImage executable and launch it (requires FUSE).\n- ${windows} No administrator rights, PATH changes or CLI installation are required.\n- The desktop includes its own runtime. Install Git and your chosen agent CLI separately and authenticate the agent before use. For GUI launches, configure an absolute agent executable path if it is not on PATH.\n- Use Settings → Updates to check, download, then explicitly install and restart. Agents stop before installation; configuration and project databases are preserved. Linux DEB updates require PolicyKit authorization. Older versions without Updates must be upgraded manually. No headless CLI installation is included.\n\nVerify downloads against SHA256SUMS. See [release instructions](https://github.com/${process.env.GITHUB_REPOSITORY}/blob/${sha}/RELEASING.md) for prerequisites and configuration.\n\nSource commit: \`${sha}\`.\n`;
if (!release) {
  release = await github("/releases", {
    method: "POST",
    body: JSON.stringify({
      tag_name: tag,
      target_commitish: sha,
      name: tag,
      body,
      draft: true,
      prerelease,
    }),
  });
}
// A matching draft may remain after a failed attempt. Never touch published releases.
const fresh = await github(`/releases/${release.id}`);
if (!fresh.draft || fresh.target_commitish !== sha)
  throw new Error("Release is no longer a matching draft");
for (const asset of fresh.assets)
  await github(`/releases/assets/${asset.id}`, { method: "DELETE" });
for (const name of [
  ...assets.map((asset) => asset.name),
  "SHA256SUMS",
  "manifest-linux.json",
  "manifest-mac.json",
  "manifest-win.json",
]) {
  const data = await readFile(join(directory, name));
  const upload = new URL(release.upload_url.split("{")[0]);
  if (upload.protocol !== "https:" || upload.hostname !== "uploads.github.com")
    throw new Error("Unexpected GitHub upload endpoint");
  upload.searchParams.set("name", name);
  const response = await fetch(upload, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GH_TOKEN}`,
      "Content-Type": "application/octet-stream",
    },
    body: data,
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`Upload failed for ${name}: ${response.status}`);
}
// Revalidate immediately before making downloads public, including newer releases.
const current = await releases();
const draft = current.find((item) => item.id === release.id);
if (!draft) throw new Error("Release draft disappeared");
candidate(tag, draft, sha);
const expected = [
  ...assets.map((asset) => asset.name),
  "SHA256SUMS",
  "manifest-linux.json",
  "manifest-mac.json",
  "manifest-win.json",
].sort();
if (JSON.stringify(draft.assets.map((asset) => asset.name).sort()) !== JSON.stringify(expected))
  throw new Error("Release uploads incomplete");
await github(`/releases/${release.id}`, {
  method: "PATCH",
  body: JSON.stringify({
    body,
    draft: false,
    prerelease,
    make_latest: newerStable(
      tag,
      current.filter((item) => !item.draft && !item.prerelease).map((item) => item.tag_name),
    )
      ? "true"
      : "false",
  }),
});
console.log(`Published ${tag} with all tested installers.`);
