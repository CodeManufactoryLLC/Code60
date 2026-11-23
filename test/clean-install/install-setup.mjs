import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { cp, mkdir, readFile, symlink } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { application, evidence, fakeAgent } from "./support.mjs";

await mkdir("/work/home", { mode: 0o700 });
await cp("/harness/bootstrap", "/work/bootstrap-cache", { recursive: true });
const env = {
  HOME: "/work/home",
  PATH: "/harness/bin:/usr/local/bin:/usr/bin:/bin",
  SHELL: "/bin/bash",
  XDG_DATA_HOME: "/installation",
  XDG_CONFIG_HOME: "/work/home/config",
  XDG_STATE_HOME: "/work/home/state",
};
const { bootstrapMain } = await import(pathToFileURL("/work/bootstrap-cache/bin/code60.mjs").href);
assert.equal(
  await bootstrapMain(["setup", "--no-open"], {
    env,
    acquisition: { transport: () => createReadStream("/input/package.tgz") },
  }),
  0,
);
await mkdir("/installation/fixtures");
for (const name of ["fake-agent.mjs", "fake-agent-app.mjs"])
  await cp(`/harness/${name}`, `/installation/fixtures/${name}`);
await symlink(`${application}/node_modules`, "/installation/fixtures/node_modules");
assert.equal(fakeAgent, "/installation/fixtures/fake-agent.mjs");
await cp(`${application}/production-dependencies.json`, "/evidence/production-dependencies.json");
await cp(`${application}/payload.json`, "/evidence/payload-provenance.json");
await evidence("installation", {
  setup: true,
  nonRoot: true,
  filesOnlyStage: true,
  noProviderVerification: true,
  productionDependencies: JSON.parse(await readFile(`${application}/package.json`, "utf8")).version,
});
