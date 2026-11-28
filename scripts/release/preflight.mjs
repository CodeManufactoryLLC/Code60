import { appendFile } from "node:fs/promises";
import { candidate, git, versionOf } from "./common.mjs";

const eventName = process.env.GITHUB_EVENT_NAME || "workflow_dispatch";
const ref = process.env.GITHUB_REF || "";
let tag = process.env.RELEASE_TAG || "";

if (eventName === "push") {
  if (!ref.startsWith("refs/tags/"))
    throw new Error("Tag push releases must run from a refs/tags/* ref");
  const refTag = ref.slice("refs/tags/".length);
  if (tag && tag !== refTag)
    throw new Error(`RELEASE_TAG (${tag}) does not match GITHUB_REF (${ref})`);
  tag = refTag;
} else if (ref !== "refs/heads/main") {
  throw new Error("Dispatch releases from main only");
}

versionOf(tag);
const { sha, version, prerelease } = candidate(tag);
const created = git("show", "-s", "--format=%cI", sha);
await appendFile(
  process.env.GITHUB_OUTPUT,
  `sha=${sha}\nversion=${version}\nprerelease=${prerelease}\ncreated=${created}\n`,
);
console.log(
  `Validated ${tag} at ${sha}. Native and Linux Node/browser/package checks must pass before release artifacts are accepted.`,
);
