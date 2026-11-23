import { appendFile } from "node:fs/promises";
import { candidate, versionOf } from "./common.mjs";

if (process.env.GITHUB_REF !== "refs/heads/main")
  throw new Error("Dispatch releases from main only");
const tag = process.env.RELEASE_TAG || "";
versionOf(tag);
const { sha, version, prerelease } = candidate(tag);
await appendFile(
  process.env.GITHUB_OUTPUT,
  `sha=${sha}\nversion=${version}\nprerelease=${prerelease}\n`,
);
console.log(
  `Validated ${tag} at ${sha}. Native and Linux Node/browser/package checks must pass before release artifacts are accepted.`,
);
