import { lstat, readdir } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import {
  type InstallationRemovalInventory,
  type InstallationRemovalLink,
  installationDirectory,
  installationFileCode,
  installationSnapshot,
  inventoryInstallationRemoval,
  snapshotRemovalLink,
} from "../platform/index.js";
import {
  type ActivationRecord,
  currentInstallation,
  installationDigest,
  installationPaths,
  readActivation,
  readInstallation,
  supportedInstallationRuntime,
  verifyBoundNode,
} from "./install-state.js";
import { readUpdateProgress } from "./update-state.js";

interface PayloadFile {
  path: string;
  type: "0" | "2";
  size?: number;
  sha256?: string;
  link?: string;
}
function verifyInventory(inventory: InstallationRemovalInventory, files: Map<string, PayloadFile>) {
  const directories = new Set([""]);
  for (const path of files.keys()) {
    if (
      !path ||
      isAbsolute(path) ||
      Buffer.byteLength(path) > 4096 ||
      /[\\\0\r\n]/.test(path) ||
      path.split("/").some((part) => !part || part === "." || part === "..")
    )
      throw Error("Unsafe removal inventory path; preserve installation");
    let parent = dirname(path);
    while (parent !== ".") {
      directories.add(parent);
      parent = dirname(parent);
    }
  }
  const actual = inventory.entries.filter((entry) => entry.type !== "directory");
  if (
    actual.length !== files.size ||
    inventory.entries.some((entry) => entry.type === "directory" && !directories.has(entry.path))
  )
    throw Error("Application removal inventory contains unowned contents; preserve installation");
  for (const entry of actual) {
    const owned = files.get(entry.path);
    if (
      !owned ||
      (entry.type === "file"
        ? owned.type !== "0" ||
          owned.sha256 !== entry.sha256 ||
          (owned.size !== undefined && owned.size !== entry.size)
        : entry.type !== "link" || owned.type !== "2" || owned.link !== entry.target)
    )
      throw Error("Application removal inventory changed; preserve installation");
  }
}
async function releaseInventory(receipt: ActivationRecord, signal?: AbortSignal) {
  const inventory = await inventoryInstallationRemoval(receipt.release.path, signal);
  const manifest = await installationSnapshot(
    join(receipt.release.path, "payload.json"),
    64 * 1024 ** 2,
  );
  if (!manifest || manifest.identity.hash !== receipt.release.manifestHash)
    throw Error("Payload ownership changed; preserve installation");
  const metadata = JSON.parse(manifest.text) as {
    schemaVersion: number;
    version: string;
    os: string;
    arch: string;
    files: PayloadFile[];
  };
  if (
    metadata.schemaVersion !== 1 ||
    metadata.version !== receipt.release.version ||
    metadata.os !== receipt.release.os ||
    metadata.arch !== receipt.release.arch ||
    !Array.isArray(metadata.files) ||
    metadata.files.length > 200_000
  )
    throw Error("Payload removal identity is invalid; preserve installation");
  const files = new Map<string, PayloadFile>();
  for (const file of metadata.files) {
    if (
      !file ||
      typeof file.path !== "string" ||
      file.path === "payload.json" ||
      files.has(file.path)
    )
      throw Error("Payload removal inventory is invalid; preserve installation");
    files.set(file.path, file);
  }
  files.set("payload.json", {
    path: "payload.json",
    type: "0",
    sha256: receipt.release.manifestHash,
  });
  verifyInventory(inventory, files);
  return inventory;
}
async function activationInventory(root: string, receipt: ActivationRecord, signal?: AbortSignal) {
  const directory = join(root, "activations", receipt.generation);
  const inventory = await inventoryInstallationRemoval(directory, signal);
  const saved = await installationSnapshot(join(directory, "receipt.json"), 65_536, true);
  if (!saved || JSON.stringify(JSON.parse(saved.text)) !== JSON.stringify(receipt))
    throw Error("Activation receipt changed; preserve installation");
  const hashes = {
    code60: receipt.launcherHash,
    "receipt.json": saved.identity.hash,
    "runtime/package.json": installationDigest('{"type":"module"}'),
    ...Object.fromEntries(
      Object.entries(receipt.runtimeFiles).map(([path, hash]) => [`runtime/${path}`, hash]),
    ),
  };
  verifyInventory(
    inventory,
    new Map(Object.entries(hashes).map(([path, sha256]) => [path, { path, type: "0", sha256 }])),
  );
  return inventory;
}

/** Read-only ownership planning. No service, profile, lock or state mutations belong here. */
export async function planManagedRemoval(
  env: NodeJS.ProcessEnv = process.env,
  signal?: AbortSignal,
) {
  supportedInstallationRuntime();
  signal?.throwIfAborted();
  const paths = await installationPaths(env);
  const exists = await lstat(paths.root).catch((error: unknown) => {
    if (installationFileCode(error) !== "ENOENT") throw error;
    return null;
  });
  if (!exists) return null;
  const record = await readInstallation(paths);
  if (!record) throw Error("Installation ownership is unavailable; preserve existing files");
  const current = await currentInstallation(record);
  if (!current) throw Error("Installation activation is unavailable; preserve existing files");
  await verifyBoundNode(current.receipt);
  const update = await readUpdateProgress(record);
  if (update && update.value.outcome !== "complete")
    throw Error("An update needs recovery; inspect code60 update status before uninstalling");
  await installationDirectory(join(record.root, "activations"), false, true);
  await installationDirectory(join(record.root, "releases"), false, true);
  const releases = new Map<string, InstallationRemovalInventory>();
  const activations: InstallationRemovalInventory[] = [];
  const residuals: string[] = [];
  for (const name of (await readdir(join(record.root, "activations"))).sort()) {
    signal?.throwIfAborted();
    const target = `activations/${name}`;
    if (!/^[a-f0-9-]{36}$/.test(name)) {
      residuals.push(join(record.root, target));
      continue;
    }
    try {
      const receipt = await readActivation(record, target);
      const release =
        releases.get(receipt.release.path) ?? (await releaseInventory(receipt, signal));
      const activation = await activationInventory(record.root, receipt, signal);
      releases.set(receipt.release.path, release);
      activations.push(activation);
    } catch (error) {
      signal?.throwIfAborted();
      if (target === current.target) throw error;
      residuals.push(join(record.root, target));
    }
  }
  for (const name of await readdir(join(record.root, "releases"))) {
    const path = join(record.root, "releases", name);
    if (!releases.has(path)) residuals.push(path);
  }
  let launcherLink: InstallationRemovalLink | null = null;
  try {
    const captured = await snapshotRemovalLink(record.launcher);
    if (captured?.target === join(record.root, "current/code60")) launcherLink = captured;
    else if (await lstat(record.launcher)) residuals.push(record.launcher);
  } catch (error) {
    if (installationFileCode(error) !== "ENOENT") residuals.push(record.launcher);
  }
  // Recheck the publication and root receipt after the potentially large inventory scan.
  const currentLink = await snapshotRemovalLink(join(record.root, "current"));
  if (
    currentLink?.target !== current.target ||
    JSON.stringify(await readInstallation(paths)) !== JSON.stringify(record)
  )
    throw Error("Installation changed while planning removal; preserve files and retry");
  return {
    record,
    current,
    releases: [...releases.values()],
    activations,
    launcherOwned: launcherLink !== null,
    launcherLink,
    currentLink,
    residuals,
  };
}
