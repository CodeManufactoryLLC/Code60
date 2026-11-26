import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { runCommand } from "./distribution/command.mjs";
import { packageDockerImage } from "./package-docker.mjs";

const execute = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const OWNER_LABEL = "com.code60.docker-test.run";

async function docker(args, { signal, timeout = 120_000 } = {}) {
  const { stdout } = await execute("docker", args, {
    signal,
    timeout,
    maxBuffer: 16 * 1024 ** 2,
  });
  return stdout;
}

async function freeLoopbackPort() {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate host port.");
  await new Promise((done) => probe.close(() => done()));
  return address.port;
}

async function rawHttp(port, method, path, headers = {}, body) {
  return await new Promise((resolveResponse, reject) => {
    const req = httpRequest({ hostname: "127.0.0.1", port, method, path, headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () =>
        resolveResponse({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf8"),
        }),
      );
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

export async function cleanupDockerTest(runId) {
  const list = async (kind) =>
    (
      await docker([
        kind,
        "ls",
        ...(kind === "container" || kind === "image" ? ["--all"] : []),
        "--quiet",
        "--filter",
        `label=${OWNER_LABEL}=${runId}`,
      ])
    )
      .trim()
      .split(/\s+/)
      .filter(Boolean);

  const failures = [];
  for (const container of await list("container")) {
    try {
      await docker(["stop", "--time", "20", container]).catch(() => {});
      await docker(["rm", "--force", container]);
    } catch (error) {
      failures.push(error);
    }
  }
  for (const image of new Set(await list("image"))) {
    try {
      await docker(["image", "rm", "--force", image]);
    } catch (error) {
      failures.push(error);
    }
  }
  for (const volume of await list("volume")) {
    try {
      await docker(["volume", "rm", volume]);
    } catch (error) {
      failures.push(error);
    }
  }

  const remaining = {
    containers: await list("container"),
    images: await list("image"),
    volumes: await list("volume"),
  };
  if (Object.values(remaining).some((items) => items.length > 0)) {
    failures.push(
      new Error(`Owned Docker test resources remain for ${runId}: ${JSON.stringify(remaining)}`),
    );
  }
  if (failures.length) {
    throw new AggregateError(failures, `Docker test cleanup incomplete for run ${runId}.`);
  }
  return remaining;
}

export function parseTestDockerArgs(args, cwd = repositoryRoot) {
  let descriptorPath;
  let image;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--image") {
      image = args[++i];
      if (!image) throw new Error("--image requires an image reference.");
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (!descriptorPath) {
      descriptorPath = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }
  return {
    descriptorPath: resolve(cwd, descriptorPath ?? "release/payloads/linux-x64.json"),
    image,
  };
}

export async function runDockerAcceptance(options, { signal } = {}) {
  const runId = randomUUID();
  const label = `${OWNER_LABEL}=${runId}`;
  const evidenceDir = join(repositoryRoot, "test-results", "docker", runId);
  await mkdir(evidenceDir, { recursive: true });

  const workspaceDir = await mkdtemp(join(tmpdir(), "code60-docker-ws-"));
  const homeVolume = `code60-docker-test-home-${runId}`;
  const containerName = `code60-docker-test-${runId}`;
  let imageRef = options.image;
  let builtVersion = null;
  let payloadSha256 = null;

  try {
    if (!imageRef) {
      imageRef = `code60-docker-test:${runId.slice(0, 12)}`;
      const built = await packageDockerImage(
        {
          descriptorPath: options.descriptorPath,
          tags: [imageRef],
          labels: [label],
          requireClean: false,
        },
        { signal },
      );
      builtVersion = built.version;
      payloadSha256 = built.sha256;
    }

    // 1. Verify non-root user, read-only /opt/code60, executable PTY helper, and offline embeddings.
    const probeScript = join(repositoryRoot, "scripts", "distribution", "probe-native.mjs");
    const checkOut = await docker(
      [
        "run",
        "--rm",
        "--platform",
        "linux/amd64",
        "--network",
        "none",
        "--label",
        label,
        "--mount",
        `type=bind,src=${probeScript},dst=/tmp/probe-native.mjs,readonly`,
        "--entrypoint",
        "/bin/sh",
        imageRef,
        "-eu",
        "-c",
        [
          'test "$(id -u)" -ne 0',
          "! touch /opt/code60/.write-check 2>/dev/null",
          "test -x /opt/code60/dist/platform/code60-pty",
          "node /tmp/probe-native.mjs /opt/code60",
        ].join(" && "),
      ],
      { signal, timeout: 180_000 },
    );
    assert.match(checkOut, /768-dimensional offline model passed/);

    // 2. Start the real container with a remapped loopback host port and custom CODE60_ORIGIN.
    await docker(["volume", "create", "--label", label, homeVolume], { signal });
    const hostPort = await freeLoopbackPort();
    const expectedOrigin = `http://127.0.0.1:${hostPort}`;

    await docker(
      [
        "run",
        "-d",
        "--platform",
        "linux/amd64",
        "--name",
        containerName,
        "--label",
        label,
        "-p",
        `127.0.0.1:${hostPort}:6060`,
        "-e",
        "CODE60_PORT=6060",
        "-e",
        `CODE60_ORIGIN=${expectedOrigin}`,
        "-e",
        "CODE60_WORKSPACE_ROOTS=/workspaces",
        "-v",
        `${homeVolume}:/home/node`,
        "-v",
        `${workspaceDir}:/workspaces`,
        imageRef,
      ],
      { signal },
    );

    const waitForHealth = async (name) => {
      const deadline = Date.now() + 60_000;
      let healthy = false;
      while (Date.now() < deadline) {
        signal?.throwIfAborted();
        try {
          await docker(["exec", name, "code60-gateway", "health"], {
            signal,
            timeout: 10_000,
          });
          healthy = true;
          break;
        } catch {
          await delay(500, undefined, { signal });
        }
      }
      if (!healthy) {
        const logs = await docker(["logs", name]).catch(() => "(logs unavailable)");
        throw new Error(`Container gateway (${name}) did not become healthy in time.\n${logs}`);
      }
    };

    const inspectPersistedDatabase = async (name) => {
      const raw = await docker(
        [
          "exec",
          name,
          "node",
          "--input-type=module",
          "-e",
          [
            'const fs = await import("node:fs/promises");',
            'const { managementRequest } = await import("/opt/code60/dist/gateway/index.js");',
            'const status = await managementRequest(process.env, "status");',
            'const prefs = JSON.parse(await fs.readFile("/home/node/.local/state/code60/desktop.json", "utf8"));',
            "const stat = await fs.stat(prefs.database);",
            'const handle = await fs.open(prefs.database, "r");',
            "const header = Buffer.alloc(16);",
            "try { await handle.read(header, 0, 16, 0); } finally { await handle.close(); }",
            'console.log(JSON.stringify({ database: status.database, path: prefs.database, ino: String(stat.ino), mode: stat.mode & 0o777, sqliteHeader: header.toString("utf8") }));',
          ].join(" "),
        ],
        { signal },
      );
      return JSON.parse(raw);
    };

    // 3. Wait for in-container loopback health check to pass.
    await waitForHealth(containerName);

    // 4. Verify browser HTML, /api/connection, strict Host/Origin, and external management block.
    const indexRes = await rawHttp(hostPort, "GET", "/", { Host: `127.0.0.1:${hostPort}` });
    assert.equal(indexRes.status, 200);
    assert.match(indexRes.body, /<!doctype html>/i);

    const connRes = await rawHttp(hostPort, "GET", "/api/connection", {
      Host: `127.0.0.1:${hostPort}`,
    });
    assert.equal(connRes.status, 200);

    const badHost = await rawHttp(hostPort, "GET", "/api/connection", {
      Host: "evil.example:6060",
    });
    assert.equal(badHost.status, 403);

    const badOrigin = await rawHttp(
      hostPort,
      "POST",
      "/api/connect",
      {
        Host: `127.0.0.1:${hostPort}`,
        Origin: "https://evil.example",
        "Content-Type": "application/json",
      },
      JSON.stringify({ version: 1 }),
    );
    assert.equal(badOrigin.status, 403);

    const externalMgmt = await rawHttp(hostPort, "POST", "/management/status", {
      Host: `127.0.0.1:${hostPort}`,
    });
    assert.equal(externalMgmt.status, 403);

    // 5. Verify default database initialized on startup and enable pairing via loopback management CLI.
    const expectedDatabasePath = "/home/node/.local/share/code60/databases/default.sqlite";
    const initialDb = await inspectPersistedDatabase(containerName);
    assert.deepEqual(initialDb.database, { state: "ready" });
    assert.equal(initialDb.path, expectedDatabasePath);
    assert.equal(initialDb.mode, 0o600);
    assert.equal(initialDb.sqliteHeader, "SQLite format 3\0");

    const pairingOn = await docker(["exec", containerName, "code60", "pairing", "on", "--yes"], {
      signal,
    });
    assert.equal(JSON.parse(pairingOn).requirePairing, true);

    const pairOutput = await docker(["exec", containerName, "code60-gateway", "pair"], { signal });
    assert.ok(pairOutput.includes(`Open ${expectedOrigin}`));
    assert.match(pairOutput, /Pairing code \(valid for 60 seconds\): \S+/);

    // 6. Verify graceful SIGTERM shutdown exits 0 and remove the original container.
    await docker(["stop", "--time", "20", containerName], { signal });
    const exitCode = (
      await docker(["inspect", "--format", "{{.State.ExitCode}}", containerName], { signal })
    ).trim();
    assert.equal(exitCode, "0");
    await docker(["rm", containerName], { signal });

    // 7. Recreate a fresh container against the same named volume and verify DB + settings persist.
    const recreatedName = `${containerName}-recreated`;
    await docker(
      [
        "run",
        "-d",
        "--platform",
        "linux/amd64",
        "--name",
        recreatedName,
        "--label",
        label,
        "-p",
        `127.0.0.1:${hostPort}:6060`,
        "-e",
        "CODE60_PORT=6060",
        "-e",
        `CODE60_ORIGIN=${expectedOrigin}`,
        "-e",
        "CODE60_WORKSPACE_ROOTS=/workspaces",
        "-v",
        `${homeVolume}:/home/node`,
        "-v",
        `${workspaceDir}:/workspaces`,
        imageRef,
      ],
      { signal },
    );
    await waitForHealth(recreatedName);

    const persistedDb = await inspectPersistedDatabase(recreatedName);
    assert.deepEqual(persistedDb.database, { state: "ready" });
    assert.equal(persistedDb.path, expectedDatabasePath);
    assert.equal(persistedDb.ino, initialDb.ino);
    assert.equal(persistedDb.mode, 0o600);
    assert.equal(persistedDb.sqliteHeader, "SQLite format 3\0");

    const pairingStatus = await docker(["exec", recreatedName, "code60", "pairing", "status"], {
      signal,
    });
    assert.equal(JSON.parse(pairingStatus).requirePairing, true);

    await docker(["stop", "--time", "20", recreatedName], { signal });
    const recreatedExitCode = (
      await docker(["inspect", "--format", "{{.State.ExitCode}}", recreatedName], { signal })
    ).trim();
    assert.equal(recreatedExitCode, "0");

    const report = {
      runId,
      image: imageRef,
      version: builtVersion,
      payloadSha256,
      hostPort,
      expectedOrigin,
      checks: {
        nonRootAndReadOnlyApp: true,
        offlineEmbeddingsProbe: true,
        ptyHelperExecutable: true,
        gatewayHealth: true,
        browserAssetsAndConnection: true,
        hostAndOriginRejection: true,
        externalManagementRejected: true,
        defaultDatabaseReady: true,
        pairingToggleAndCode: true,
        gracefulSigtermExit0: true,
        recreatedContainerPersistence: true,
      },
      completedAt: new Date().toISOString(),
    };
    await writeFile(join(evidenceDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Docker acceptance passed (${runId}). Evidence: ${evidenceDir}`);
    return report;
  } finally {
    await rm(workspaceDir, { recursive: true, force: true });
    await cleanupDockerTest(runId);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCommand(async (signal) => {
    const options = parseTestDockerArgs(process.argv.slice(2));
    await runDockerAcceptance(options, { signal });
  });
}
