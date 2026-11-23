import { readFile } from "node:fs/promises";
import { descriptorPair, targets } from "../distribution/descriptor.mjs";

const manifest = JSON.parse(await readFile("package.json", "utf8"));
const values = await Promise.all(
  targets.map(async (target) =>
    JSON.parse(await readFile(`release/payloads/${target}.json`, "utf8")),
  ),
);
descriptorPair(values, manifest.version);
if (
  !/^[a-f0-9]{40}$/.test(process.env.RELEASE_SHA ?? "") ||
  values.some((value) => value.dirty || value.commit !== process.env.RELEASE_SHA)
)
  throw new Error("Release payloads must be clean and match the selected release commit");
console.log(
  "Both platform release identities verified; bootstrap packaging verifies archive bytes.",
);
