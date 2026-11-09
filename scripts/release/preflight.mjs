import { appendFile } from "node:fs/promises";
import { candidate, releases, signingReady, versionOf } from "./common.mjs";

if (process.env.GITHUB_REF !== "refs/heads/main")
  throw new Error("Dispatch releases from main only");
const tag = process.env.RELEASE_TAG || "";
versionOf(tag);
signingReady(process.env);
const existing = (await releases()).find((release) => release.tag_name === tag);
const { sha, version, prerelease } = candidate(tag, existing);
await appendFile(
  process.env.GITHUB_OUTPUT,
  `sha=${sha}\nversion=${version}\nprerelease=${prerelease}\n`,
);
console.log(
  `Validated ${tag} at ${sha}. Linux checks must pass before platform installer validation starts.`,
);
