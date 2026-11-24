// Isolated acceptance entry, never shipped. Only artifact transport is injected;
// update, supervisor commands, readiness and launcher execution stay real.
import assert from "node:assert/strict";
import { appendFile, readFile } from "node:fs/promises";
import { get } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [input, ...args] = process.argv.slice(2);
const config = JSON.parse(await readFile(input, "utf8"));
assert.match(config.origin, /^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/);
const platform = await import(
  pathToFileURL(join(config.application, "dist/platform/index.js")).href
);
const { createUpdatePorts, runUpdate } = await import(
  pathToFileURL(join(config.application, "dist/management/update.js")).href
);
const routes = new Map([
  ["https://registry.npmjs.org/code60/latest", "/metadata"],
  [`https://registry.npmjs.org/code60/-/code60-${config.version}.tgz`, "/bootstrap"],
  [config.payloadUrl, "/payload"],
]);
const transport = (url, { signal }) =>
  new Promise((resolve, reject) => {
    const route = routes.get(url);
    if (!route) return reject(Error("Acceptance refuses unexpected artifact acquisition"));
    const request = get(`${config.origin}${route}`, { signal }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(Error("Test artifact unavailable"));
      } else resolve(response);
    });
    request.once("error", reject);
  });
const ports = createUpdatePorts(process.env);
ports.bootstrap = (parent, signal) => platform.readStableBootstrap({ parent, signal, transport });
ports.acquire = (descriptor, parent, signal) =>
  platform.acquirePayload(descriptor, { parent, signal, transport });
let interrupted = false;
ports.checkpoint = async (record) => {
  await appendFile(
    config.progressLog,
    `${JSON.stringify({ attempt: record.attempt, phase: record.phase, outcome: record.outcome })}\n`,
    { mode: 0o600 },
  );
  if (config.interruptPhase === record.phase && !interrupted) {
    interrupted = true;
    process.emit("SIGINT");
  }
};
try {
  await runUpdate(args, process.env, ports);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode ||= 1;
}
