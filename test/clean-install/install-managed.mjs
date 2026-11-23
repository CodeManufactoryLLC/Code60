import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { cp, mkdir, readFile, rm, stat, symlink } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { application, evidence, execute, fakeAgent, launcher } from "./support.mjs";

const cache = "/work/bootstrap-cache";
await cp("/harness/bootstrap", cache, { recursive: true });
await mkdir("/installation/customer-home", { mode: 0o700 });
await mkdir(`${cache}/node_modules/.bin`, { recursive: true });
await symlink("../../bin/code60.mjs", `${cache}/node_modules/.bin/code60`);
const api = await import(pathToFileURL(`${cache}/lib/index.mjs`).href);
const env = {
  HOME: "/installation/customer-home",
  PATH: `${cache}/node_modules/.bin:/usr/local/bin:/usr/bin:/bin`,
  SHELL: "/bin/bash",
};
const options = { env, acquisition: { transport: () => createReadStream("/input/package.tgz") } };
const installed = await api.installPayload(options);
assert.equal(installed.release, application);
const again = await api.installPayload({
  ...options,
  acquisition: {
    transport: () => {
      throw Error("Repeat installation downloaded");
    },
  },
});
assert.equal(again.reused, true);
await rm(cache, { recursive: true });
await assert.rejects(stat(cache), { code: "ENOENT" });
const preview = await api.planShellIntegration(env);
const integration = await api.applyShellIntegration(preview, { approved: true, interactive: true });
assert.equal(integration.manual.length, 0);
const help = await execute(launcher, ["--help"], { cwd: "/", env, timeout: 15000 });
assert.match(help.stdout, /code60 service/);
const bare = await execute("/bin/bash", ["--login", "-i", "-c", "code60 --help"], {
  cwd: "/",
  env,
  timeout: 15000,
});
assert.match(bare.stdout, /code60 service/);
await mkdir("/installation/fixtures");
for (const name of ["fake-agent.mjs", "fake-agent-app.mjs"])
  await cp(`/harness/${name}`, `/installation/fixtures/${name}`);
await symlink(`${application}/node_modules`, "/installation/fixtures/node_modules");
assert.equal(fakeAgent, "/installation/fixtures/fake-agent.mjs");
await cp(`${application}/production-dependencies.json`, "/evidence/production-dependencies.json");
await cp(`${application}/payload.json`, "/evidence/payload-provenance.json");
await evidence("installation", {
  managed: true,
  nonRoot: true,
  persistentLauncher: launcher,
  bootstrapCacheRemoved: true,
  reusedWithoutDownload: true,
  noServiceInstalled: true,
  productionDependencies: JSON.parse(await readFile(`${application}/package.json`, "utf8")).version,
});
