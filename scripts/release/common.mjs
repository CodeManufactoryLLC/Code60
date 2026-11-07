import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export function run(command, args, options = {}) {
  const output = execFileSync(command, args, {
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
    ...options,
  });
  return output?.trim() ?? "";
}
export const git = (...args) => run("git", args);
export const json = async (path) => JSON.parse(await readFile(path, "utf8"));
export async function digest(path) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}
export function versionOf(tag) {
  const match =
    /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?$/.exec(
      tag,
    );
  if (!match || match[4]?.split(".").some((part) => /^\d+$/.test(part) && /^0\d/.test(part))) {
    throw new Error("Expected an existing semantic version tag such as v0.2.0 or v0.2.0-beta.1");
  }
  return { version: tag.slice(1), prerelease: Boolean(match[4]), parts: match.slice(1, 4) };
}
export function newerStable(candidate, published) {
  const a = versionOf(candidate);
  if (a.prerelease) return false;
  return published.every((tag) => {
    let b;
    try {
      b = versionOf(tag);
    } catch {
      return true;
    }
    if (b.prerelease) return true;
    for (let i = 0; i < 3; i++) {
      if (BigInt(a.parts[i]) !== BigInt(b.parts[i])) return BigInt(a.parts[i]) > BigInt(b.parts[i]);
    }
    return false;
  });
}
export function validateCandidate({ tag, sha, expectedSha, manifest, lock, onMain, release }) {
  const version = versionOf(tag);
  if (!/^[a-f\d]{40}$/.test(sha)) throw new Error("Invalid release commit");
  if (expectedSha && sha !== expectedSha) throw new Error("Release tag changed after validation");
  if (!onMain) throw new Error("Release commit must belong to main");
  if (
    manifest.version !== version.version ||
    lock.version !== version.version ||
    lock.packages?.[""]?.version !== version.version
  ) {
    throw new Error("Tag, package.json and package-lock.json versions must agree");
  }
  if (release && !release.draft)
    throw new Error("Release is already published; never replace published assets");
  if (release && release.target_commitish !== sha)
    throw new Error("Existing draft belongs to a different commit");
  return version;
}
export function signingReady(env) {
  const required = [
    "HAS_CSC_LINK",
    "HAS_CSC_KEY_PASSWORD",
    "HAS_APPLE_API_KEY",
    "HAS_APPLE_API_KEY_ID",
    "HAS_APPLE_API_ISSUER",
    "HAS_WIN_CSC_LINK",
    "HAS_WIN_CSC_KEY_PASSWORD",
    "HAS_WIN_SIGNING_THUMBPRINT",
  ];
  if (required.some((key) => env[key] !== "true"))
    throw new Error("Missing signing configuration; see RELEASING.md");
  if (!/^.+ <[^<>\s]+@[^<>\s]+>$/.test(env.RELEASE_MAINTAINER || ""))
    throw new Error("Set RELEASE_MAINTAINER to Name <email>");
}
export function assetNames(version, platform) {
  const channel = versionOf(`v${version}`).prerelease
    ? version.split("-")[1].split(".")[0]
    : "latest";
  if (platform === "linux")
    return [
      `Code60-${version}-linux-x64.deb`,
      `Code60-${version}-linux-x64.AppImage`,
      `${channel}-linux.yml`,
    ];
  if (platform === "mac")
    return [
      `Code60-${version}-mac-arm64.dmg`,
      `Code60-${version}-mac-arm64.zip`,
      `${channel}-mac.yml`,
    ];
  if (platform === "win") return [`Code60-${version}-win-x64.exe`, `${channel}.yml`];
  throw new Error("Unknown installer platform");
}
export async function github(path, options = {}) {
  const response = await fetch(
    `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}${path}`,
    {
      ...options,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${process.env.GH_TOKEN}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(60_000),
    },
  );
  if (!response.ok) throw new Error(`GitHub request failed (${response.status}) for ${path}`);
  return response.status === 204 ? null : response.json();
}
export async function releases() {
  const all = [];
  for (let page = 1; ; page++) {
    const batch = await github(`/releases?per_page=100&page=${page}`);
    all.push(...batch);
    if (batch.length < 100) return all;
  }
}
export function candidate(tag, release, expectedSha) {
  versionOf(tag); // Validate before using the tag as a Git argument.
  git(
    "fetch",
    "--no-tags",
    "origin",
    "+refs/heads/main:refs/remotes/origin/main",
    `+refs/tags/${tag}:refs/tags/${tag}`,
  );
  const sha = git("rev-parse", `refs/tags/${tag}^{commit}`);
  let onMain = true;
  try {
    git("merge-base", "--is-ancestor", sha, "refs/remotes/origin/main");
  } catch {
    onMain = false;
  }
  const version = validateCandidate({
    tag,
    sha,
    expectedSha,
    onMain,
    release,
    manifest: JSON.parse(git("show", `${sha}:package.json`)),
    lock: JSON.parse(git("show", `${sha}:package-lock.json`)),
  });
  return { sha, ...version };
}
