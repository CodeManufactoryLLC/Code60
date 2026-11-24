import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { cp, mkdir, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { architecture, environment, evidence, execute, prefix } from "./support.mjs";

architecture();
const size = (await stat("/input/package.tgz")).size;
const server = createServer((request, response) => {
  if (request.url === "/corrupt.tgz") {
    response.end("intentionally corrupt package fixture");
  } else if (request.url === "/package.tgz" && ["GET", "HEAD"].includes(request.method)) {
    response.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": size });
    if (request.method === "HEAD") response.end();
    else
      createReadStream("/input/package.tgz")
        .on("error", () => response.destroy())
        .pipe(response);
  } else response.writeHead(404).end();
});
server.requestTimeout = 10_000;
await new Promise((ready, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", ready);
});
const origin = `http://127.0.0.1:${server.address().port}`;
const env = { ...environment("/work/installer-home"), ONNXRUNTIME_NODE_INSTALL: "skip" };
await mkdir(env.HOME, { recursive: true, mode: 0o700 });
const install = (target, url) =>
  execute(
    "/usr/local/bin/npm",
    ["install", "--prefix", target, "--omit=dev", "--no-audit", "--no-fund", url],
    { env, cwd: "/work", timeout: 6 * 60_000, maxBuffer: 8 * 1024 * 1024 },
  );
try {
  await assert.rejects(install("/work/corrupt-prefix", `${origin}/corrupt.tgz`));
  await install(prefix, `${origin}/package.tgz`);
  await mkdir(`${prefix}/node_modules/code60/fixtures`, { recursive: true });
  for (const name of ["fake-agent.mjs", "fake-agent-app.mjs"])
    await cp(`/harness/${name}`, `${prefix}/node_modules/code60/fixtures/${name}`);
  const { stdout } = await execute(
    "/usr/local/bin/npm",
    ["ls", "--prefix", prefix, "--omit=dev", "--all", "--json"],
    {
      env,
      timeout: 30_000,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  await writeFile("/evidence/production-dependencies.json", stdout, { mode: 0o600 });
  await evidence("installation", {
    nonRoot: true,
    artifactFixture: "loopback HTTP",
    corruptArchiveRejected: true,
    registry: env.NPM_CONFIG_REGISTRY,
  });
} finally {
  server.closeAllConnections();
  await new Promise((ready) => server.close(ready));
}
