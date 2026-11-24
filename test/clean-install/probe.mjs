import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { application, architecture, cli, evidence, fresh, processes, waitFor } from "./support.mjs";

const mode = process.argv[2];
architecture(mode === "architecture" ? process.argv[3] : "x64");
const http = async (port, path = "/", headers = {}) =>
  new Promise((ready, reject) => {
    const req = request(
      { hostname: "127.0.0.1", port: Number(port), path, headers },
      (response) => {
        let body = "";
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () =>
          ready({ status: response.statusCode, body, headers: response.headers }),
        );
        response.on("error", reject);
      },
    );
    req.once("error", reject);
    req.setTimeout(5000, () => req.destroy(new Error("Installed HTTP check timed out")));
    req.end();
  });

if (mode === "ready" || mode === "assets") {
  const connection = await waitFor(() =>
    readFile("/work/control/public.json", "utf8")
      .then(JSON.parse)
      .catch((error) => {
        if (error.code !== "ENOENT") throw error;
        return null;
      }),
  );
  assert.ok(Number.isInteger(connection.port) && connection.port > 0 && connection.port <= 65535);
  const page = await http(connection.port);
  assert.equal(page.status, 200, "Installed browser assets are unavailable");
  assert.match(page.body, /<html/);
  const assets = [...page.body.matchAll(/(?:src|href)="((?:\.\/|\/)[^"?]+\.(?:js|css))"/g)].map(
    (match) => match[1],
  );
  assert.ok(assets.length > 0, "Installed HTML contains no bundled assets");
  for (const asset of assets) {
    const result = await http(connection.port, asset.replace(/^\./, ""));
    assert.equal(result.status, 200, `Missing installed asset: ${asset}`);
    assert.ok(result.body.length > 0);
  }
  assert.equal((await http(connection.port, "/", { Host: "invalid.example" })).status, 403);
  assert.equal(
    (await http(connection.port, "/api/connection", { Origin: "https://invalid.example" })).status,
    403,
  );
  await evidence("assets", { assets: assets.length, wrongHost: 403, wrongOrigin: 403 });
} else if (mode === "cli") {
  const env = await fresh("/work/cli-home");
  const installed = JSON.parse(await readFile(`${application}/package.json`, "utf8"));
  assert.equal(installed.name, "code60");
  const require = createRequire(`${application}/package.json`);
  for (const name of ["vite", "vitest", "@playwright/test", "@devcontainers/cli"])
    assert.throws(() => require.resolve(name), { code: "MODULE_NOT_FOUND" });
  assert.match((await cli(["--help"], env)).stdout, /code60 service/);
  assert.equal(JSON.parse((await cli(["service", "status"], env)).stdout).installed, false);
  await assert.rejects(cli(["open"], env), /Install the login backend/);
  assert.equal(JSON.parse((await cli(["pairing", "status"], env)).stdout).requirePairing, false);
  for (const [value, expected] of [
    ["on", true],
    ["off", false],
  ])
    assert.equal(
      JSON.parse((await cli(["pairing", value, "--yes"], env)).stdout).requirePairing,
      expected,
    );
  await evidence("cli", {
    version: installed.version,
    help: true,
    serviceInstalled: false,
    pairing: true,
    developmentDependencies: "absent",
  });
} else if (mode === "model") {
  await stat(`${application}/models/jinaai/jina-embeddings-v2-base-code/config.json`).catch(() => {
    throw new Error("Installed bundled model assets are missing");
  });
  globalThis.fetch = async () => {
    throw new Error("Network forbidden during installed embedding check");
  };
  const { loadRagModel } = await import(
    pathToFileURL(`${application}/dist/application/rag-model.js`).href
  );
  const embedder = await loadRagModel(`${application}/models`);
  const vector = await embedder.embedQuery("clean installed offline model");
  assert.equal(vector.length, 768);
  assert.ok([...vector].every(Number.isFinite));
  assert.ok(Math.abs(Math.hypot(...vector) - 1) < 0.001);
  await evidence("model", {
    dimensions: vector.length,
    finite: true,
    externalNetworking: "disabled",
    javascriptFetch: "forbidden",
  });
} else if (mode === "request-stop") {
  await writeFile("/work/control/stop", "stop");
} else if (mode === "stopped") {
  await waitFor(() => stat("/work/control/stopped.json").catch(() => null));
} else if (mode === "verify-cleanup") {
  const { runtime } = JSON.parse(await readFile("/work/control/stopped.json", "utf8"));
  const infrastructure = [1, process.pid, runtime];
  await waitFor(async () => (await processes(new Set(infrastructure))).length === 0, 5000).catch(
    async () => {
      await evidence("leak-detected", {
        remaining: await processes(new Set(infrastructure)),
        infrastructure,
      });
      throw new Error("Installed process leak detected");
    },
  );
  await evidence("process-cleanup", {
    backendProviderAndHelperProcessesGone: true,
    remaining: [],
    infrastructure,
  });
  const calls = (
    await readFile("/work/supervisor.jsonl", "utf8").catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return "";
    })
  )
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(JSON.parse);
  const setup = JSON.parse(await readFile("/harness/layout.json", "utf8")).setup;
  const uninstall = JSON.parse(await readFile("/harness/layout.json", "utf8")).uninstall;
  assert.ok(
    calls.every(
      (call) =>
        call.name === "systemctl" &&
        call.args[0] === "--user" &&
        (call.args[1] === "show" ||
          (setup && ["daemon-reload", "enable", "start"].includes(call.args[1])) ||
          (uninstall &&
            call.args[1] === "disable" &&
            JSON.stringify(call.args) === '["--user","disable","--now","code60-backend.service"]')),
    ),
    "Unexpected supervisor/opener mutation",
  );
  await evidence("supervisor", { calls, nativeServiceValidation: "not performed" });
} else if (mode === "leak") {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    detached: true,
    stdio: "ignore",
  });
  await new Promise((ready, reject) => {
    child.once("spawn", ready);
    child.once("error", reject);
  });
  child.unref();
} else if (mode !== "architecture") throw new Error("Unknown acceptance probe");
