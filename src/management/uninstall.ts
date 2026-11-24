import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { backendControl, managementRequest } from "../gateway/index.js";
import {
  installationFileCode,
  installationLink,
  lockInstallation,
  type RemovalServiceProof,
  type reserveRemovedBackend,
} from "../platform/index.js";
import {
  installationPaths,
  readInstallation,
  shellQuote,
  supportedInstallationRuntime,
} from "./install-state.js";
import { type RemovalState, readRemovalState } from "./removal-state.js";
import { finishManagedRemoval, prepareManagedRemoval } from "./removal-support.js";
import { applyShellRemoval, planShellRemoval } from "./shell-removal.js";
import { planManagedRemoval } from "./uninstall-plan.js";

interface ServiceStatus {
  installed: boolean;
  nativeState?: string;
  runtimeCurrent?: boolean;
  service?: Record<string, unknown> | null;
}
interface Guard {
  pid: number | null;
  executable: string;
  entrypoint: string;
  appVersion: string;
}
export interface UninstallPorts {
  interactive: boolean;
  confirm(message: string, signal: AbortSignal): Promise<boolean>;
  write(message: string): void;
  status(): Promise<ServiceStatus>;
  summary(): Promise<Record<string, unknown>>;
  prepare(): Promise<Record<string, unknown>>;
  remove(guard: Guard): Promise<RemovalServiceProof>;
  reserve?: typeof reserveRemovedBackend;
  runtimeDirectory?: string;
  signal?: AbortSignal;
  checkpoint?(state: RemovalState): Promise<void>;
}
function portsFor(env: NodeJS.ProcessEnv): UninstallPorts {
  return {
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
    status: () => backendControl(env, "status"),
    summary: () => managementRequest(env, "uninstall-summary"),
    prepare: () => managementRequest(env, "prepare-uninstall"),
    remove: async (guard) => {
      const result = await backendControl(env, "uninstall", true, guard);
      if (result.installed !== false || !("removal" in result) || !result.removal)
        throw Error("Owned backend removal did not produce verified recovery scope");
      return result.removal;
    },
  };
}
const pid = (value: unknown): value is number =>
  Number.isInteger(value) && Number(value) > 0 && Number(value) <= 2 ** 31 - 1;
function assertIdleSummary(summary: Record<string, unknown>, expectedPid: number) {
  const workflows = summary.workflows as Record<string, unknown> | undefined;
  if (
    summary.pid !== expectedPid ||
    summary.interactiveActive !== false ||
    summary.scheduledActive !== false ||
    summary.schedulerAvailable !== true ||
    summary.scheduledUncertain !== false ||
    !workflows ||
    workflows.active !== 0 ||
    workflows.uncertain !== 0 ||
    !Number.isInteger(workflows.completed) ||
    Number(workflows.completed) < 0
  )
    throw Error(
      "Application, scheduled work or workflows are active or uncertain; resolve them before uninstalling",
    );
}

/** Gateway-dependent orchestration stays out of the bootstrap's Node-only closure. */
export async function runUninstall(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  injected?: UninstallPorts,
) {
  if (args.length > 1 || args.some((arg) => arg !== "--yes"))
    throw Error("Use code60 uninstall [--yes].");
  supportedInstallationRuntime();
  const paths = await installationPaths(env);
  const present = await lstat(paths.root).catch((error: unknown) => {
    if (installationFileCode(error) !== "ENOENT") throw error;
    return null;
  });
  const ports = injected ?? portsFor(env);
  if (!present) {
    ports.write("No managed Code60 installation was found. No files or services changed.\n");
    return;
  }
  const record = await readInstallation(paths).catch(() => {
    throw Error(
      "Managed installation ownership is unavailable; preserve files and inspect installation.json",
    );
  });
  if (!record)
    throw Error("Managed installation receipt is missing; existing files were preserved");
  const controller = new AbortController();
  const signal = AbortSignal.any([
    controller.signal,
    AbortSignal.timeout(20 * 60_000),
    ...(ports.signal ? [ports.signal] : []),
  ]);
  let interrupted = 0;
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
  let recovery: string | undefined;
  try {
    signal.throwIfAborted();
    let prepared: RemovalState | undefined;
    const release = await lockInstallation(record.root, "setup");
    try {
      const saved = await readRemovalState(record);
      const current = await installationLink(join(record.root, "current"));
      if (saved?.value.phase === "complete" && current === saved.receipt.current.target)
        throw Error(
          "Completed uninstall contradicts the current activation; preserve recovery evidence",
        );
      const resume = saved && (saved.value.phase !== "complete" || current === null);
      const plan = resume ? null : await planManagedRemoval(env, signal);
      if (!resume && !plan) throw Error("Managed application ownership is unavailable");
      if (
        plan &&
        !injected &&
        fileURLToPath(new URL("./cli.js", import.meta.url)) !==
          join(plan.current.receipt.release.path, "dist/management/cli.js")
      )
        throw Error("Run the current installed code60 command before uninstalling this activation");
      const status = resume ? null : await ports.status();
      if (!resume && !status)
        throw Error("Backend status is unavailable; preserve the installation");
      if (
        status &&
        (typeof status.installed !== "boolean" ||
          !["running", "stopped"].includes(status.nativeState ?? "") ||
          (!status.installed && (status.nativeState !== "stopped" || status.service)) ||
          status.runtimeCurrent === false ||
          (status.installed && status.runtimeCurrent !== true) ||
          (status.nativeState === "running" && !pid(status.service?.pid)) ||
          (status.nativeState === "stopped" && status.service))
      )
        throw Error(
          "Backend registration or runtime ownership is uncertain; inspect code60 service status",
        );
      if (status?.service && pid(status.service.pid))
        assertIdleSummary(await ports.summary(), status.service.pid);
      const message = resume
        ? "Resume owned Code60 application removal? Databases, configuration, engine evidence and worktrees will be preserved."
        : "Uninstall Code60? Stop and remove its owned backend service and application files; preserve databases, configuration, engine evidence and worktrees.";
      if (!args.includes("--yes")) {
        if (!ports.interactive)
          throw Error(
            "Uninstall requires explicit consent. Run code60 uninstall --yes; no profiles are edited without interactive approval.",
          );
        if (!(await ports.confirm(message, signal))) {
          ports.write(
            "Uninstall declined. Backend, application files and profiles were preserved.\n",
          );
          return;
        }
      }
      signal.throwIfAborted();
      // Profile approval is deliberately independent of service/file consent.
      try {
        const preview = await planShellRemoval(record);
        if (preview.edits.length) {
          ports.write(
            `Shell profile removal preview:\n${preview.edits.map((edit) => `${edit.path}\n${edit.remove}`).join("\n")}\n`,
          );
          const approved =
            ports.interactive &&
            (await ports.confirm("Remove exactly these Code60 shell profile additions?", signal));
          const result = await applyShellRemoval(record, preview, {
            approved,
            interactive: ports.interactive,
          });
          for (const manual of result.manual) ports.write(`${manual}\n`);
          if (result.applied.length)
            ports.write(
              "Owned profile additions removed. This terminal's PATH is unchanged; open a new terminal to reload profiles.\n",
            );
        } else for (const manual of preview.manual) ports.write(`${manual}\n`);
      } catch (error) {
        signal.throwIfAborted();
        ports.write(
          "Shell profile cleanup is incomplete or uncertain; remaining content was preserved for manual inspection.\n",
        );
      }
      signal.throwIfAborted();
      if (resume) prepared = saved;
      else if (plan) {
        const processId = status?.service && pid(status.service.pid) ? status.service.pid : null;
        let enginePids: number[] = [];
        if (processId !== null) {
          const result = await ports.prepare();
          if (
            result.quiescent !== true ||
            result.pid !== processId ||
            !Array.isArray(result.enginePids) ||
            result.enginePids.length > 8192 ||
            !result.enginePids.every(pid)
          )
            throw Error("Backend uninstall preparation is uncertain; preserve installation files");
          enginePids = result.enginePids;
        }
        signal.throwIfAborted();
        const proof = await ports.remove({
          pid: processId,
          executable: plan.current.receipt.node.path,
          entrypoint: join(plan.current.receipt.release.path, "dist/gateway/main.js"),
          appVersion: plan.current.receipt.release.version,
        });
        signal.throwIfAborted();
        proof.pids = [
          ...new Set([...proof.pids, ...enginePids, ...(processId === null ? [] : [processId])]),
        ];
        prepared = await prepareManagedRemoval(plan, proof, {
          signal,
          ...(ports.runtimeDirectory ? { runtimeDirectory: ports.runtimeDirectory } : {}),
        });
      }
      if (!prepared) throw Error("No durable uninstall preparation was produced");
      recovery = `${shellQuote(join(prepared.directory, "code60"))} uninstall --yes`;
      ports.write(`Recovery command (also works if this terminal closes): ${recovery}\n`);
      await ports.checkpoint?.(prepared);
      signal.throwIfAborted();
    } finally {
      await release();
    }
    const result = await finishManagedRemoval(record, {
      signal,
      ...(ports.reserve ? { reserve: ports.reserve } : {}),
    });
    ports.write(
      `Code60 application removed. Databases, configuration, run records, engine evidence and worktrees were preserved.\n${result.residuals.map((path) => `Preserved unrelated resource: ${path}\n`).join("")}`,
    );
  } catch (error) {
    throw Error(
      `${error instanceof Error ? error.message : "Uninstall failed"}. Remaining files and user data were preserved. ${recovery ? `Resume: ${recovery}` : `Inspect ${join(record.root, "removal.json")} and code60 service status before retrying.`}`,
      { cause: error },
    );
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", terminate);
    if (interrupted) process.exitCode = interrupted;
  }
}
