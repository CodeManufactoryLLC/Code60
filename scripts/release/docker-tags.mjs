import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { versionOf } from "./common.mjs";

export const DEFAULT_DOCKERHUB_REPOSITORY = "mjholliday/code60";

const REPOSITORY_RE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*\/[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export function normalizeDockerRepository(value) {
  const repository =
    value === undefined || value.trim() === "" ? DEFAULT_DOCKERHUB_REPOSITORY : value.trim();
  if (!REPOSITORY_RE.test(repository))
    throw new Error(
      `Invalid Docker Hub repository '${repository}'. Expected '<namespace>/<name>' in lowercase.`,
    );
  return repository;
}

/**
 * Derive Docker image tags from a validated Code60 release tag.
 * Stable vX.Y.Z publishes exact, minor, major, and latest tags.
 * Prerelease vX.Y.Z-beta.N publishes only the exact prerelease tag and never moves latest.
 */
export function dockerTagsForRelease(releaseTag, repositoryInput) {
  const repository = normalizeDockerRepository(repositoryInput);
  const { version, prerelease } = versionOf(releaseTag);
  if (prerelease) {
    return {
      repository,
      version,
      prerelease,
      tags: [`${repository}:${version}`],
    };
  }
  const [major, minor] = version.split(".");
  return {
    repository,
    version,
    prerelease,
    tags: [
      `${repository}:${version}`,
      `${repository}:${major}.${minor}`,
      `${repository}:${major}`,
      `${repository}:latest`,
    ],
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const releaseTag = process.env.RELEASE_TAG || "";
  const result = dockerTagsForRelease(releaseTag, process.env.DOCKERHUB_REPOSITORY);
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `repository=${result.repository}\nversion=${result.version}\nprerelease=${result.prerelease}\ntags<<EOF\n${result.tags.join("\n")}\nEOF\n`,
    );
  } else {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
}
