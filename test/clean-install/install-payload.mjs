import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { cp, mkdir, readFile, rename, rm } from "node:fs/promises";
import { createServer, get } from "node:http";
import { acquirePayload } from "../../scripts/distribution/acquire.mjs";
import { application, architecture, evidence, prefix } from "./support.mjs";

architecture();
const descriptor = JSON.parse(await readFile("/input/descriptor.json", "utf8"));
const server = createServer((_request, response) => {
  createReadStream("/input/package.tgz")
    .on("error", () => response.destroy())
    .pipe(response);
});
server.requestTimeout = 10_000;
await new Promise((ready, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", ready);
});
try {
  const transport = (_url, { signal }) =>
    new Promise((ready, reject) => {
      const request = get(`http://127.0.0.1:${server.address().port}/payload`, { signal }, ready);
      request.once("error", reject);
    });
  await assert.rejects(
    acquirePayload({ ...descriptor, arch: "arm64" }, { parent: "/installation", transport }),
    /descriptor|platform/i,
  );
  await assert.rejects(
    acquirePayload(
      { ...descriptor, archive: { ...descriptor.archive, sha256: "0".repeat(64) } },
      { parent: "/installation", transport },
    ),
    /checksum/,
  );
  const candidate = await acquirePayload(descriptor, { parent: "/installation", transport });
  await mkdir(`${prefix}/node_modules`, { recursive: true });
  await rename(candidate.root, application);
  await rm(candidate.owned, { recursive: true });
  await mkdir(`${application}/fixtures`);
  for (const name of ["fake-agent.mjs", "fake-agent-app.mjs"])
    await cp(`/harness/${name}`, `${application}/fixtures/${name}`);
  await cp(`${application}/production-dependencies.json`, "/evidence/production-dependencies.json");
  await cp(`${application}/payload.json`, "/evidence/payload-provenance.json");
  await evidence("installation", {
    nonRoot: true,
    artifactFixture: "loopback HTTP",
    checksumRejected: true,
    wrongPlatformRejected: true,
    dependencyResolution: false,
    installScripts: false,
    nativeCompilation: false,
  });
} finally {
  server.closeAllConnections();
  await new Promise((ready) => server.close(ready));
}
