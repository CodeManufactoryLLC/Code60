import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import {
  createInstallationParents,
  executableInstallationFile,
  findRuntimeProcesses,
  installationDirectory,
  installationFileCode,
  installationSnapshot,
  installationTreeIdentity,
  installedEngineVersions,
  inventoryInstallationRemoval,
  lockInstallation,
  type RemovalServiceProof,
  removeInstallationInventory,
  removeRecordedInstallationLink,
  reserveRemovedBackend,
  resolveTransmissionRuntime,
  runtimeFileProcesses,
  snapshotRemovalLink,
  syncInstallationDirectory,
  verifyInstallationNode,
  verifyInstallationRemovalRemainder,
  writeInstallationFile,
} from "../platform/index.js";
import {
  type InstallationRecord,
  installationDigest,
  readInstallation,
  shellQuote,
  supportedInstallationRuntime,
} from "./install-state.js";
import {
  type RemovalReceipt,
  type RemovalState,
  readRemovalState,
  validateRemovalReceipt,
  writeRemovalProgress,
} from "./removal-state.js";
import type { planManagedRemoval } from "./uninstall-plan.js";

type Plan = NonNullable<Awaited<ReturnType<typeof planManagedRemoval>>>;
const exists = (path: string) =>
  lstat(path).catch((error: unknown) => {
    if (installationFileCode(error) !== "ENOENT") throw error;
    return null;
  });
function engineEnvironment(record: InstallationRecord) {
  return { HOME: record.home, XDG_DATA_HOME: dirname(record.root) };
}
async function captureEngines(
  record: InstallationRecord,
  service: RemovalServiceProof,
  signal?: AbortSignal,
) {
  const engines: RemovalReceipt["engines"] = [];
  for (const version of installedEngineVersions()) {
    try {
      const { node, entry, root } = await resolveTransmissionRuntime(
        engineEnvironment(record),
        version,
        signal,
      );
      engines.push({ version, node, entry, root });
    } catch (error) {
      if (
        installationFileCode(error) !== "CODE60_ENGINE_UNAVAILABLE" ||
        (await exists(join(dirname(service.root), "workflows", `transmission-${version}`)))
      )
        throw error;
    }
  }
  return engines;
}
async function verifyEngines(receipt: RemovalReceipt, signal?: AbortSignal) {
  const workflowRoot = join(dirname(receipt.service.root), "workflows");
  if (await exists(workflowRoot)) {
    await installationDirectory(workflowRoot, false, true);
    for (const name of await readdir(workflowRoot)) {
      if (
        name.startsWith("transmission-") &&
        !receipt.engines.some((engine) => name === `transmission-${engine.version}`)
      )
        throw Error("Unrecognized engine state appeared; preserve installation files");
    }
  }
  for (const engine of receipt.engines) {
    const runtime = await resolveTransmissionRuntime(
      engineEnvironment(receipt.installation),
      engine.version,
      signal,
    );
    if (
      runtime.root !== engine.root ||
      runtime.node !== engine.node ||
      runtime.entry !== engine.entry ||
      (await findRuntimeProcesses([engine.node, engine.entry, "engine"], signal)).length
    )
      throw Error("Engine ownership or absence changed; preserve installation files");
    const root = join(workflowRoot, `transmission-${engine.version}`);
    if (await exists(root)) {
      await installationDirectory(root, false, true);
      if (await exists(join(root, "endpoint.json")))
        throw Error("Engine endpoint reappeared; preserve installation files");
      const files: string[] = [];
      for (const name of [
        "owner.sqlite",
        "workflows.sqlite",
        "workflows.sqlite-wal",
        "workflows.sqlite-shm",
      ]) {
        const path = join(root, name);
        if (await exists(path)) files.push(path);
        else if (name === "owner.sqlite" || name === "workflows.sqlite")
          throw Error("Engine evidence disappeared; preserve installation files");
      }
      if ((await runtimeFileProcesses(files, signal)).length)
        throw Error("Engine evidence is still open; preserve installation files");
    }
  }
}

async function removeUnpublishedSupport(
  owned: { path: string; identity: { dev: string; ino: string } },
  plannedFiles: ReadonlyMap<string, string>,
) {
  const inventory = await inventoryInstallationRemoval(owned.path);
  const directories = new Set(["", "runtime", "runtime/management", "runtime/platform"]);
  if (
    JSON.stringify(await installationTreeIdentity(owned.path)) !== JSON.stringify(owned.identity) ||
    inventory.entries.some((entry) =>
      entry.type === "directory"
        ? !directories.has(entry.path)
        : entry.type !== "file" || plannedFiles.get(entry.path) !== entry.sha256,
    )
  )
    throw Error(`Unpublished recovery support changed; preserved it for inspection: ${owned.path}`);
  await removeInstallationInventory(owned.path, inventory);
}

/** Caller has completed consented service removal. Publication makes recovery independent of the app. */
export async function prepareManagedRemoval(
  plan: Plan,
  service: RemovalServiceProof,
  options: {
    signal?: AbortSignal;
    runtimeDirectory?: string;
    checkpoint?(directory: string): Promise<void>;
  } = {},
) {
  supportedInstallationRuntime();
  options.signal?.throwIfAborted();
  const { record } = plan;
  const release = await lockInstallation(record.root);
  let owned: { path: string; identity: { dev: string; ino: string } } | undefined;
  let published = false;
  const plannedFiles = new Map<string, string>();
  let failure: unknown;
  let result: RemovalState | undefined;
  try {
    const previous = await readRemovalState(record);
    if (previous && previous.value.phase !== "complete")
      throw Error("Uninstall is already prepared; use its durable recovery command");
    if (
      JSON.stringify(await readInstallation(record)) !== JSON.stringify(record) ||
      JSON.stringify(await snapshotRemovalLink(join(record.root, "current"))) !==
        JSON.stringify(plan.currentLink)
    )
      throw Error("Installation changed since removal planning; preserve files and retry");
    for (const inventory of [...plan.releases, ...plan.activations])
      await verifyInstallationRemovalRemainder(inventory, options.signal);
    const node = await verifyInstallationNode();
    if (node !== plan.current.receipt.node.path) throw Error("Recorded installation Node changed");
    const attempt = randomUUID();
    await createInstallationParents(join(record.root, "removals"), true);
    const directory = join(record.root, "removals", attempt);
    await mkdir(directory, { mode: 0o700 });
    owned = { path: directory, identity: await installationTreeIdentity(directory) };
    await mkdir(join(directory, "runtime"), { mode: 0o700 });
    const files: Record<string, string> = {};
    const source = options.runtimeDirectory ?? fileURLToPath(new URL("../", import.meta.url));
    for (const module of ["management", "platform"]) {
      await mkdir(join(directory, "runtime", module), { mode: 0o700 });
      for (const name of (await readdir(join(source, module))).sort()) {
        if (!/^[a-z-]+\.(?:js|mjs)$/.test(name)) continue;
        if (
          module === "management" &&
          !["removal-state.js", "removal-support.js", "install-state.js"].includes(name)
        )
          continue;
        const path = `runtime/${module}/${name}`;
        const contents = await readFile(join(source, module, name), "utf8");
        plannedFiles.set(path, installationDigest(contents));
        await writeInstallationFile(join(directory, path), contents, null);
        files[path] = installationDigest(contents);
      }
    }
    const packageJson = '{"type":"module"}';
    plannedFiles.set("runtime/package.json", installationDigest(packageJson));
    await writeInstallationFile(join(directory, "runtime/package.json"), packageJson, null);
    files["runtime/package.json"] = installationDigest(packageJson);
    const launcher = `#!/bin/sh\nunset NODE_OPTIONS NODE_PATH\nif [ ! -x ${shellQuote(node)} ]; then printf '%s\\n' 'Recorded Node is unavailable; restore it before uninstall recovery.' >&2; exit 1; fi\nexec ${shellQuote(node)} ${shellQuote(join(directory, "runtime/management/removal-support.js"))} "$@"\n`;
    plannedFiles.set("code60", installationDigest(launcher));
    await executableInstallationFile(join(directory, "code60"), launcher);
    files.code60 = installationDigest(launcher);
    const receipt: RemovalReceipt = {
      schema: 1,
      installation: record,
      rootIdentity: await installationTreeIdentity(record.root),
      attempt,
      generation: plan.current.receipt.generation,
      node,
      service,
      engines: await captureEngines(record, service, options.signal),
      inventories: [...plan.releases, ...plan.activations],
      current: plan.currentLink,
      launcher: plan.launcherLink,
      residuals: [...plan.residuals],
      files,
    };
    validateRemovalReceipt(record, receipt);
    await verifyEngines(receipt, options.signal);
    const text = `${JSON.stringify(receipt)}\n`;
    if (Buffer.byteLength(text) > 64 * 1024 ** 2)
      throw Error("Uninstall receipt exceeded its bound; no application files removed");
    plannedFiles.set("receipt.json", installationDigest(text));
    await writeInstallationFile(join(directory, "receipt.json"), text, null, 0o600, 64 * 1024 ** 2);
    await syncInstallationDirectory(directory);
    await options.checkpoint?.(directory);
    options.signal?.throwIfAborted();
    try {
      result = await writeRemovalProgress(
        record,
        {
          schema: 1,
          installationId: record.id,
          attempt,
          receiptHash: installationDigest(text),
          phase: "prepared",
        },
        previous,
      );
      published = true;
    } catch (error) {
      // A sync failure can follow a successful atomic rename. Preserve possibly
      // published support, including unreadable/uncertain progress, for recovery.
      published = await installationSnapshot(join(record.root, "removal.json"), 4096, true)
        .then((file) => file !== null && JSON.parse(file.text).attempt === attempt)
        .catch(() => true);
      throw error;
    }
  } catch (error) {
    failure = error;
  } finally {
    const errors: unknown[] = [];
    if (owned && !published)
      try {
        await removeUnpublishedSupport(owned, plannedFiles);
      } catch (error) {
        errors.push(error);
      }
    try {
      await release();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length)
      failure = new AggregateError(
        [failure, ...errors].filter(Boolean),
        "Uninstall preparation or owned cleanup failed; preserve recovery evidence",
      );
  }
  if (failure) throw failure;
  if (!result) throw Error("Uninstall preparation did not produce durable recovery support");
  return result;
}

/** The recovery receipt, not cwd, npm cache, caller XDG or an intact release, owns cleanup. */
export async function finishManagedRemoval(
  record: InstallationRecord,
  options: {
    signal?: AbortSignal;
    checkpoint?(path: string): Promise<void>;
    reserve?: typeof reserveRemovedBackend;
  } = {},
) {
  supportedInstallationRuntime();
  options.signal?.throwIfAborted();
  const unlockSetup = await lockInstallation(record.root, "setup");
  let unlockInstall: (() => Promise<void>) | undefined;
  let reserved: Awaited<ReturnType<typeof reserveRemovedBackend>> | undefined;
  let failure: unknown;
  let result: { removed: true; residuals: string[]; recovery: string } | undefined;
  try {
    unlockInstall = await lockInstallation(record.root);
    let state = await readRemovalState(record);
    if (!state) throw Error("No durable uninstall receipt exists");
    if ((await verifyInstallationNode()) !== state.receipt.node)
      throw Error("Recorded uninstall Node changed; restore it before recovery");
    const current = await snapshotRemovalLink(join(record.root, "current"));
    if (current && JSON.stringify(current) !== JSON.stringify(state.receipt.current))
      throw Error(
        "Installation was reactivated or current ownership changed; use its current command",
      );
    reserved = await (options.reserve ?? reserveRemovedBackend)(
      state.receipt.service,
      options.signal,
    );
    await verifyEngines(state.receipt, options.signal);
    if (state.value.phase === "complete") {
      if (
        current ||
        (
          await Promise.all(state.receipt.inventories.map((inventory) => exists(inventory.root)))
        ).some(Boolean)
      )
        throw Error("Installation was reactivated; old uninstall recovery cannot remove it");
      result = {
        removed: true,
        residuals: [
          ...new Set([
            ...state.receipt.residuals,
            ...((await exists(record.launcher)) ? [record.launcher] : []),
          ]),
        ],
        recovery: join(state.directory, "code60"),
      };
    } else {
      for (const inventory of state.receipt.inventories)
        await verifyInstallationRemovalRemainder(inventory, options.signal);
      if (state.value.phase === "prepared")
        state = await writeRemovalProgress(record, { ...state.value, phase: "removing" }, state);
      for (const inventory of state.receipt.inventories) {
        await reserved.verify();
        await verifyEngines(state.receipt, options.signal);
        await removeInstallationInventory(inventory.root, inventory, options);
      }
      await reserved.verify();
      await verifyEngines(state.receipt, options.signal);
      const residuals = [...state.receipt.residuals];
      if (state.receipt.launcher) {
        const launcher = await snapshotRemovalLink(record.launcher).catch(() => null);
        if (launcher && JSON.stringify(launcher) === JSON.stringify(state.receipt.launcher))
          await removeRecordedInstallationLink(record.launcher, state.receipt.launcher);
        else if (await exists(record.launcher)) residuals.push(record.launcher);
      }
      await removeRecordedInstallationLink(join(record.root, "current"), state.receipt.current);
      await reserved.verify();
      await writeRemovalProgress(record, { ...state.value, phase: "complete" }, state);
      result = {
        removed: true,
        residuals: [...new Set(residuals)],
        recovery: join(state.directory, "code60"),
      };
    }
  } catch (error) {
    failure = error;
  } finally {
    const errors: unknown[] = [];
    for (const release of [reserved?.release, unlockInstall, unlockSetup])
      if (release) {
        try {
          await release();
        } catch (error) {
          errors.push(error);
        }
      }
    if (errors.length)
      failure = new AggregateError(
        [failure, ...errors].filter(Boolean),
        "Uninstall cleanup failed; remaining files and recovery evidence were preserved",
      );
  }
  if (failure) throw failure;
  if (!result) throw Error("Uninstall cleanup did not complete");
  return result;
}

async function runRemovalRecovery(directory: string, args: readonly string[]) {
  if (args[0] !== "uninstall" || args.slice(1).some((flag) => flag !== "--yes") || args.length > 2)
    throw Error("Use the printed recovery command: code60 uninstall [--yes]");
  const signalController = new AbortController();
  let interrupted = 0;
  const interrupt = () => {
    interrupted = 130;
    signalController.abort();
  };
  const terminate = () => {
    interrupted = 143;
    signalController.abort();
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", terminate);
  try {
    if (!args.includes("--yes")) {
      if (!process.stdin.isTTY || !process.stdout.isTTY)
        throw Error("Recovery requires explicit --yes; no files removed");
      const input = createInterface({ input: process.stdin, output: process.stdout });
      try {
        if (
          !/^y(?:es)?$/i.test(
            (
              await input.question("Resume owned application removal and preserve data? [y/N] ", {
                signal: signalController.signal,
              })
            ).trim(),
          )
        )
          return;
      } finally {
        input.close();
      }
    }
    const root = dirname(dirname(directory));
    const header = await installationSnapshot(join(root, "installation.json"), 16384, true);
    if (!header) throw Error("Installation receipt is missing; preserve uninstall evidence");
    const record = await readInstallation(JSON.parse(header.text) as InstallationRecord);
    if (!record || record.root !== root) throw Error("Recovery installation scope changed");
    const state = await readRemovalState(record);
    if (!state || state.directory !== directory)
      throw Error("Recovery receipt is no longer the active uninstall attempt");
    const result = await finishManagedRemoval(record, {
      signal: AbortSignal.any([signalController.signal, AbortSignal.timeout(20 * 60_000)]),
    });
    process.stdout.write(
      `Code60 application removed. Databases, configuration, engine evidence and worktrees were preserved.\n${result.residuals.map((path) => `Preserved unrelated resource: ${path}\n`).join("")}`,
    );
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", terminate);
    if (interrupted) process.exitCode = interrupted;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runRemovalRecovery(
    dirname(dirname(dirname(fileURLToPath(import.meta.url)))),
    process.argv.slice(2),
  ).catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Uninstall recovery failed"}\n`,
    );
    process.exitCode ||= 1;
  });
}
