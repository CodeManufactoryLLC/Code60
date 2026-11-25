// Same-host isolation proof: one complete run cleans up while another stays live.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { runCommand } from "./distribution/command.mjs";
import { commandEnvironment, runCleanInstall } from "./test-clean-install.mjs";

const execute = promisify(execFile);
const owner = "com.code60.acceptance.run";
const firstGate = "Clean installation: missing renderer/model detection";
const secondGate = "Clean installation: backend/provider/helper process shutdown";
const gate = () => {
  let release;
  const promise = new Promise((resolveGate) => {
    release = resolveGate;
  });
  return { promise, release };
};
async function observe(first, second, signal) {
  const docker = async (args) =>
    (
      await execute("docker", args, {
        env: commandEnvironment(process.env),
        signal,
        timeout: 10000,
        killSignal: "SIGKILL",
        maxBuffer: 1024 ** 2,
      })
    ).stdout;
  const inventory = async (id) => {
    const values = await Promise.all(
      ["container", "image", "volume"].map(async (kind) => [
        kind,
        (
          await docker([
            kind,
            "ls",
            ...(kind === "volume" ? [] : ["--all"]),
            "--quiet",
            "--filter",
            `label=${owner}=${id}`,
          ])
        )
          .trim()
          .split(/\s+/)
          .filter(Boolean),
      ]),
    );
    return Object.fromEntries(values);
  };
  const [removed, live] = await Promise.all([inventory(first.id), inventory(second.id)]);
  if (
    Object.values(removed).some((items) => items.length) ||
    Object.values(live).some((items) => !items.length)
  )
    throw Object.assign(Error("Concurrent cleanup isolation inventory failed"), {
      observation: { removed, live },
    });
  const runtime = JSON.parse(
    await docker([
      "inspect",
      "--format",
      '{"identity":{{json .Id}},"running":{{json .State.Running}},"owner":{{json (index .Config.Labels "com.code60.acceptance.run")}},"network":{{json .HostConfig.NetworkMode}}}',
      second.runtimeContainer.name,
    ]),
  );
  if (
    runtime.identity !== second.runtimeContainer.identity ||
    runtime.owner !== second.id ||
    !runtime.running ||
    runtime.network !== "none"
  )
    throw Object.assign(Error("Concurrent survivor runtime changed or stopped"), {
      observation: { removed, live, runtime },
    });
  // Real asset/Host/Origin requests on the survivor's own unchanged loopback.
  await docker(["exec", second.runtimeContainer.name, "node", "/harness/probe.mjs", "ready"]);
  return { removed, survivor: { inventory: live, runtime, assetsResponsive: true } };
}

export async function runConcurrentCleanInstall(directory, args, ports = {}) {
  if (args.length !== 2 || args[0] !== "--uninstall" || args[1].startsWith("-"))
    throw Error("Use npm run test:packaged:concurrent -- --uninstall <descriptor.json>");
  const root = await realpath(directory);
  const output = join(root, "test-results/clean-install-concurrent", randomUUID());
  await mkdir(output, { recursive: true, mode: 0o700 });
  const controller = new AbortController();
  const signal = ports.signal
    ? AbortSignal.any([controller.signal, ports.signal])
    : controller.signal;
  const deadline = setTimeout(() => controller.abort(), 20 * 60_000);
  const ready = gate(),
    releaseSurvivor = gate();
  let held, first, second, isolation, failure;
  const metadataByRun = [];
  const install = ports.install ?? runCleanInstall;
  const write = ports.write ?? ((line) => process.stdout.write(`${line}\n`));
  const onAbort = () => {
    ready.release();
    releaseSurvivor.release();
  };
  signal.addEventListener("abort", onAbort, { once: true });
  const guarded = (promise) =>
    promise.catch((error) => {
      controller.abort();
      onAbort();
      throw error;
    });
  const firstRun = guarded(
    Promise.resolve().then(() =>
      install(root, args, {
        signal,
        write: async (message, metadata) => {
          metadataByRun[0] = metadata;
          await write(`First: ${message}`, metadata);
          if (message === firstGate) {
            await ready.promise;
            signal.throwIfAborted();
          }
        },
      }),
    ),
  );
  const secondRun = guarded(
    Promise.resolve()
      .then(() =>
        install(root, args, {
          signal,
          write: async (message, metadata) => {
            metadataByRun[1] = metadata;
            await write(`Second: ${message}`, metadata);
            if (message === secondGate) {
              if (!metadata?.runtimeContainer) throw Error("Concurrent runtime handoff missing");
              held = metadata;
              ready.release();
              await releaseSurvivor.promise;
              signal.throwIfAborted();
            }
          },
        }),
      )
      .then((result) => {
        if (!held) throw Error("Concurrent survivor did not reach its live checkpoint");
        return result;
      }),
  );
  // Observe both promises immediately, including a peer that fails while held.
  const settled = Promise.allSettled([firstRun, secondRun]);
  try {
    first = await firstRun;
    if (!held || first.id === held.id || first.status !== "passed")
      throw Error("Concurrent acceptance identities or progress are invalid");
    signal.throwIfAborted();
    isolation = await (ports.observe ?? observe)(first, held, signal);
    await write("First run cleaned; second runtime and assets independently verified live.");
    releaseSurvivor.release();
    second = await secondRun;
    if (second.id !== held.id || second.status !== "passed")
      throw Error("Concurrent survivor acceptance failed");
  } catch (error) {
    failure = error;
    controller.abort();
    onAbort();
  } finally {
    const results = await settled;
    clearTimeout(deadline);
    signal.removeEventListener("abort", onAbort);
    const failures = results
      .filter((item) => item.status === "rejected")
      .map((item) => item.reason);
    if (failures.length && !failure)
      failure = new AggregateError(failures, "Concurrent acceptance failed");
    const summary = {
      status: failure ? "failed" : "passed",
      output,
      runs: results.map((item, index) =>
        item.status === "fulfilled"
          ? { id: item.value.id, evidence: item.value.output, cleanup: item.value.cleanup }
          : { failed: true, id: metadataByRun[index]?.id, evidence: metadataByRun[index]?.output },
      ),
      isolation: isolation ?? failure?.observation ?? null,
    };
    await writeFile(join(output, "summary.json"), JSON.stringify(summary, null, 2), {
      mode: 0o600,
    });
  }
  if (failure) throw Error(`Concurrent acceptance failed. Evidence: ${output}`, { cause: failure });
  await write(`Concurrent installation acceptance passed. Evidence: ${output}`);
  return { first, second, isolation, output };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCommand((signal) =>
    runConcurrentCleanInstall(
      fileURLToPath(new URL("..", import.meta.url)),
      process.argv.slice(2),
      { signal },
    ),
  );
}
