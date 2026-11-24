import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { backendControl, managementRequest } from "../gateway/index.js";
import {
  acquirePayload,
  createInstallationParents,
  installationFileCode,
  lockInstallation,
  newerStableRelease,
  type PayloadDescriptor,
  readStableBootstrap,
  runInstallationCommand,
  type StableBootstrap,
} from "../platform/index.js";
import {
  type ActivationRecord,
  managedInstallation,
  readActivation,
  shellQuote,
} from "./install-state.js";
import { installManagedRelease } from "./installation.js";
import {
  readUpdateProgress,
  type UpdateRecord,
  type UpdateSnapshot,
  writeUpdateProgress,
} from "./update-state.js";

const execute = promisify(execFile);
interface ServiceStatus {
  installed: boolean;
  nativeState?: string;
  runtimeCurrent?: boolean;
  service?: Record<string, unknown> | null;
}
export interface UpdatePorts {
  interactive: boolean;
  confirm(message: string, signal: AbortSignal): Promise<boolean>;
  write(message: string): void;
  bootstrap(parent: string, signal: AbortSignal): Promise<StableBootstrap>;
  acquire(
    descriptor: PayloadDescriptor,
    parent: string,
    signal: AbortSignal,
  ): Promise<{ root: string; owned: string }>;
  service(action: "status" | "stop", consent?: boolean): Promise<ServiceStatus>;
  summary(): Promise<Record<string, unknown>>;
  alive(pid: number): boolean;
  repair(launcher: string, signal: AbortSignal): Promise<void>;
  activatedStatus(launcher: string, signal: AbortSignal): Promise<ServiceStatus>;
  deadlineMs: number;
  runtimeDirectory?: string;
  checkpoint?(record: UpdateRecord): Promise<void>;
}
export function updateFlags(args: readonly string[]) {
  const action = args[0] === "status" || args[0] === "recover" ? args[0] : "update";
  const flags = action === "update" ? args : args.slice(1);
  if (
    new Set(flags).size !== flags.length ||
    flags.some((flag) => flag !== "--yes") ||
    (action === "status" && flags.length)
  )
    throw Error(
      "Use code60 update [--yes], code60 update status, or code60 update recover [--yes].",
    );
  return { action, yes: flags.includes("--yes") };
}

export function createUpdatePorts(env: NodeJS.ProcessEnv): UpdatePorts {
  return {
    runtimeDirectory: fileURLToPath(new URL("../bootstrap/", import.meta.url)),
    interactive: !!process.stdin.isTTY && !!process.stdout.isTTY,
    confirm: async (message, signal) => {
      const input = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return /^y(?:es)?$/i.test((await input.question(`${message} [y/N] `, { signal })).trim());
      } finally {
        input.close();
      }
    },
    write: (message) => {
      process.stdout.write(message);
    },
    bootstrap: (parent, signal) => readStableBootstrap({ parent, signal }),
    acquire: (descriptor, parent, signal) => acquirePayload(descriptor, { parent, signal }),
    service: (action, consent) => backendControl(env, action, consent),
    summary: () => managementRequest(env, "update-summary"),
    alive: (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        if (installationFileCode(error) === "ESRCH") return false;
        throw error;
      }
    },
    repair: async (launcher, signal) => {
      const result = await runInstallationCommand(
        launcher,
        ["service", "repair", "--yes"],
        env,
        signal,
      );
      if (result !== 0) throw Error(`Updated service registration failed (exit ${result})`);
    },
    activatedStatus: async (launcher, signal) => {
      const result = await execute(launcher, ["service", "status"], {
        env,
        cwd: "/",
        signal,
        timeout: 15000,
        maxBuffer: 64 * 1024,
      });
      const value = JSON.parse(result.stdout) as ServiceStatus;
      if (!value || typeof value.installed !== "boolean")
        throw Error("Invalid updated service status");
      return value;
    },
    deadlineMs: 30000,
  };
}
function validPid(pid: unknown): pid is number {
  return typeof pid === "number" && Number.isSafeInteger(pid) && pid > 0;
}
function requireService(status: ServiceStatus, currentRuntime = true) {
  if (
    !status.installed ||
    !["running", "stopped"].includes(status.nativeState ?? "") ||
    (currentRuntime && status.runtimeCurrent !== true) ||
    (status.nativeState === "running" && !validPid(status.service?.pid)) ||
    (status.nativeState === "stopped" && status.service)
  )
    throw Error(
      "Backend registration or process ownership is unavailable or conflicting; preserve state and inspect code60 service status",
    );
}
async function consent(ports: UpdatePorts, yes: boolean, message: string, signal: AbortSignal) {
  signal.throwIfAborted();
  ports.write(`${message}\n`);
  if (yes) return true;
  if (!ports.interactive) {
    ports.write(
      "No backend change was authorized. Rerun with Code60's trailing --yes or use an interactive terminal.\n",
    );
    return false;
  }
  const approved = await ports.confirm("Proceed with this backend interruption?", signal);
  signal.throwIfAborted();
  return approved;
}
async function quiescent(ports: UpdatePorts, pid: number | null, signal: AbortSignal) {
  const deadline = Date.now() + ports.deadlineMs;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const status = await ports.service("status");
    if (
      status.installed &&
      status.nativeState === "stopped" &&
      !status.service &&
      (!pid || !ports.alive(pid))
    )
      return;
    await delay(100, undefined, { signal });
  }
  throw Error(
    "Backend quiescence and process exit could not be verified; activation was not changed",
  );
}
async function ready(ports: UpdatePorts, launcher: string, version: string, signal: AbortSignal) {
  const deadline = Date.now() + ports.deadlineMs;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const status = await ports.activatedStatus(launcher, signal).catch(() => null);
    if (
      status?.installed &&
      status.runtimeCurrent === true &&
      status.nativeState === "running" &&
      validPid(status.service?.pid) &&
      status.service?.appVersion === version
    )
      return;
    await delay(100, undefined, { signal });
  }
  throw Error(
    "Activated backend did not reach authenticated readiness; use explicit update recovery",
  );
}
const identityOf = (receipt: ActivationRecord) => ({
  generation: receipt.generation,
  version: receipt.release.version,
  sha256: receipt.release.archive.sha256,
});

export async function runUpdate(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  injected?: UpdatePorts,
) {
  const flags = updateFlags(args);
  const installed = await managedInstallation(env);
  if (!installed) throw Error("Code60 has no managed installation. Run distribution setup first");
  const { record, receipt } = installed;
  if (
    !injected &&
    fileURLToPath(new URL("./cli.js", import.meta.url)) !==
      join(receipt.release.path, "dist/management/cli.js")
  )
    throw Error("Run update through the current persistent Code60 launcher");
  const ports = injected ?? createUpdatePorts(env);
  if (flags.action === "status") {
    const progress = await readUpdateProgress(record);
    ports.write(
      `${JSON.stringify({ installedVersion: receipt.release.version, generation: receipt.generation, update: progress?.value ?? null })}\n`,
    );
    return;
  }
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20 * 60_000)]);
  let interrupted: number | undefined;
  const interrupt = () => {
    interrupted = 130;
    controller.abort();
  };
  const terminate = () => {
    interrupted = 143;
    controller.abort();
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", terminate);
  let release: (() => Promise<void>) | undefined;
  let progress: UpdateSnapshot | null = null;
  let ownsProgress = false;
  let changedBackend = false;
  const save = async (value: UpdateRecord) => {
    progress = await writeUpdateProgress(record, value, progress);
    ownsProgress = true;
    await ports.checkpoint?.(progress.value);
  };
  const currentRecord = () => {
    if (!progress) throw Error("Update progress is missing");
    return progress.value;
  };
  const phase = async (next: UpdateRecord["phase"]) => {
    signal.throwIfAborted();
    if (!progress) throw Error("Update progress is missing");
    await save({
      ...progress.value,
      phase: next,
      outcome: next === "ready" || next === "aborted" ? "complete" : "running",
    });
    signal.throwIfAborted();
  };
  try {
    release = await lockInstallation(record.root, "setup");
    progress = await readUpdateProgress(record);
    if (flags.action === "recover") {
      if (!progress || progress.value.outcome === "complete") {
        ports.write("No unfinished update requires recovery.\n");
        return;
      }
      const saved = progress.value;
      const previous = await readActivation(record, `activations/${saved.previous.generation}`);
      if (JSON.stringify(identityOf(previous)) !== JSON.stringify(saved.previous))
        throw Error("Previous update activation identity changed");
      const isPrevious = receipt.generation === saved.previous.generation;
      if (
        !isPrevious &&
        (!saved.candidate ||
          JSON.stringify(identityOf(receipt)) !== JSON.stringify(saved.candidate))
      )
        throw Error(
          "Current activation does not belong to this update; preserve state for manual inspection",
        );
      if (isPrevious && ["activated", "repairing", "ready"].includes(saved.phase))
        throw Error(
          "Current activation contradicts recorded publication; preserve the pointer and update record for manual inspection",
        );
      if (
        !(await consent(
          ports,
          flags.yes,
          `Recover the current Code60 ${receipt.release.version} registration. Interactive and scheduled work may stop; no database downgrade or workflow replay is performed.`,
          signal,
        ))
      )
        return;
      // Recovery serializes against file installation as well as post-install
      // setup. Uncertain locks are deliberately never reclaimed here.
      const releaseInstallation = await lockInstallation(record.root);
      try {
        const observed = await managedInstallation(env);
        if (observed?.receipt.generation !== receipt.generation)
          throw Error("Activation changed before recovery; preserve the update record");
        ownsProgress = true;
        changedBackend = true;
        const launcher = join(record.root, "activations", receipt.generation, "code60");
        await ports.repair(launcher, signal);
        await ready(ports, launcher, receipt.release.version, signal);
        await phase(isPrevious ? "aborted" : "ready");
      } finally {
        await releaseInstallation();
      }
      ports.write(
        `Code60 ${receipt.release.version} recovered. Open the browser with ${shellQuote(record.launcher)} open.\n`,
      );
      return;
    }
    if (progress && progress.value.outcome !== "complete")
      throw Error(
        "An unfinished update requires code60 update status and code60 update recover; no new candidate was acquired",
      );
    const status = await ports.service("status");
    requireService(status);
    await save({
      schema: 1,
      installationId: record.id,
      attempt: randomUUID(),
      previous: identityOf(receipt),
      candidate: null,
      phase: "checking",
      outcome: "running",
    });
    const staging = join(record.root, ".staging");
    await createInstallationParents(staging, true);
    const bootstrap = await ports.bootstrap(staging, signal);
    if (!newerStableRelease(bootstrap.version, receipt.release.version)) {
      if (
        bootstrap.version === receipt.release.version &&
        bootstrap.descriptor.archive.sha256 !== receipt.release.archive.sha256
      )
        throw Error(
          "The stable descriptor conflicts with this installed version; no replacement was attempted",
        );
      await phase("aborted");
      ports.write(
        `Code60 ${receipt.release.version} is current or newer than the stable release; no changes made.\n`,
      );
      return;
    }
    await save({
      ...currentRecord(),
      candidate: {
        generation: null,
        version: bootstrap.version,
        sha256: bootstrap.descriptor.archive.sha256,
      },
      phase: "acquiring",
    });
    class DeclinedUpdate extends Error {}
    try {
      await installManagedRelease({
        env,
        signal,
        ...(ports.runtimeDirectory ? { runtimeDirectory: ports.runtimeDirectory } : {}),
        artifact: {
          identity: bootstrap.descriptor,
          acquire: ({ parent }) => ports.acquire(bootstrap.descriptor, parent, signal),
        },
        update: {
          expectedGeneration: receipt.generation,
          beforePublish: async ({ candidate }) => {
            await save({ ...currentRecord(), candidate: identityOf(candidate), phase: "prepared" });
            signal.throwIfAborted();
            const before = await ports.service("status");
            requireService(before);
            const pid = validPid(before.service?.pid) ? before.service.pid : null;
            let summary = "Backend is stopped.";
            if (pid) {
              const active = await ports.summary();
              if (
                active.pid !== pid ||
                typeof active.interactiveActive !== "boolean" ||
                ![true, false, null].includes(active.scheduledActive as boolean | null) ||
                typeof active.schedulerAvailable !== "boolean"
              )
                throw Error("Backend interruption summary could not be authenticated");
              summary = `Interactive work: ${active.interactiveActive ? "active" : "idle"}. Scheduled work: ${active.scheduledActive === null || !active.schedulerAvailable ? "unavailable" : active.scheduledActive ? "active" : "idle"}.`;
            }
            if (
              !(await consent(
                ports,
                flags.yes,
                `Verified Code60 ${bootstrap.version}. ${summary} Updating stops interactive and scheduled work, including work started after this inspection. Approved independent workflows keep their pinned engines.`,
                signal,
              ))
            )
              throw new DeclinedUpdate();
            await phase("stopping");
            signal.throwIfAborted();
            changedBackend = true;
            await ports.service("stop", true);
            await quiescent(ports, pid, signal);
            await phase("stopped");
            await phase("publishing");
          },
        },
        checkpoint: async (checkpoint) => {
          if (checkpoint !== "published") return;
          await phase("activated");
          const candidate = currentRecord().candidate;
          if (!candidate?.generation) throw Error("Published activation identity is missing");
          const observed = await managedInstallation(env);
          if (observed?.receipt.generation !== candidate.generation)
            throw Error("Published activation changed; preserve both generations");
          const launcher = join(record.root, "activations", candidate.generation, "code60");
          await phase("repairing");
          await ports.repair(launcher, signal);
          await ready(ports, launcher, bootstrap.version, signal);
          await phase("ready");
        },
      });
    } catch (error) {
      if (!(error instanceof DeclinedUpdate)) throw error;
      await phase("aborted");
      ports.write("Update declined. The previous activation and backend were preserved.\n");
      return;
    }
    ports.write(
      `Code60 ${bootstrap.version} is ready. Previous files were retained. Run ${shellQuote(record.launcher)} open to reconnect.\n`,
    );
  } catch (error) {
    let failure = error;
    if (ownsProgress && progress) {
      try {
        await save({
          ...progress.value,
          phase: changedBackend
            ? progress.value.phase === "ready" || progress.value.phase === "aborted"
              ? "repairing"
              : progress.value.phase
            : "aborted",
          outcome: changedBackend ? (signal.aborted ? "interrupted" : "failed") : "complete",
        });
      } catch (journal) {
        failure = new AggregateError(
          [error, journal],
          "Update failed and durable progress could not be recorded; preserve existing records",
        );
      }
    }
    throw new Error(
      `${failure instanceof Error ? failure.message : "Update failed"}. Installed generations and user state were preserved. Inspect ${shellQuote(record.launcher)} update status; recover with ${shellQuote(record.launcher)} update recover.`,
      { cause: failure },
    );
  } finally {
    try {
      await release?.();
    } finally {
      process.removeListener("SIGINT", interrupt);
      process.removeListener("SIGTERM", terminate);
      if (interrupted) process.exitCode = interrupted;
    }
  }
}
