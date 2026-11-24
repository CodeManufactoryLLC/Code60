import { lstat } from "node:fs/promises";
import { join } from "node:path";
import {
  absoluteInstallationPath,
  type FileIdentity,
  type InstallationRemovalInventory,
  type InstallationRemovalLink,
  installationDirectory,
  installationLink,
  installationSnapshot,
  installationTreeIdentity,
  type RemovalServiceProof,
  validateInstallationRemovalInventory,
  validateRemovalServiceProof,
  writeInstallationFile,
} from "../platform/index.js";
import { type InstallationRecord, readActivation, readInstallation } from "./install-state.js";

export interface RemovalReceipt {
  schema: 1;
  installation: InstallationRecord;
  rootIdentity: { dev: string; ino: string };
  attempt: string;
  generation: string;
  node: string;
  service: RemovalServiceProof;
  engines: {
    version: "0.1.0-staging.18" | "0.1.0-staging.20";
    node: string;
    entry: string;
    root: string;
  }[];
  inventories: InstallationRemovalInventory[];
  current: InstallationRemovalLink;
  launcher: InstallationRemovalLink | null;
  residuals: string[];
  files: Record<string, string>;
}
export interface RemovalProgress {
  schema: 1;
  installationId: string;
  attempt: string;
  receiptHash: string;
  phase: "prepared" | "removing" | "complete";
}
export interface RemovalState {
  value: RemovalProgress;
  identity: FileIdentity;
  receipt: RemovalReceipt;
  directory: string;
}
const uuid = (value: unknown) => typeof value === "string" && /^[a-f0-9-]{36}$/.test(value);
const digest = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const decimal = (value: unknown) => typeof value === "string" && /^\d+$/.test(value);
const refused = () =>
  Error("Uninstall receipt is invalid or changed; preserve remaining files and recovery support");
const parse = <T>(text: string): T => {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw refused();
  }
};
function validateLink(value: InstallationRemovalLink | null, path: string, target: string) {
  if (
    !value ||
    value.path !== path ||
    value.target !== target ||
    ![value.dev, value.ino, value.ctimeNs, value.parent?.dev, value.parent?.ino].every(decimal)
  )
    throw refused();
}
export function validateRemovalReceipt(record: InstallationRecord, value: RemovalReceipt) {
  if (
    !value ||
    value.schema !== 1 ||
    !uuid(value.attempt) ||
    !uuid(value.generation) ||
    JSON.stringify(value.installation) !== JSON.stringify(record) ||
    !decimal(value.rootIdentity?.dev) ||
    !decimal(value.rootIdentity?.ino) ||
    typeof value.node !== "string" ||
    absoluteInstallationPath(value.node) !== value.node ||
    !Array.isArray(value.inventories) ||
    !value.inventories.length ||
    value.inventories.length > 256 ||
    !Array.isArray(value.engines) ||
    value.engines.length > 2 ||
    new Set(value.engines.map((engine) => engine.version)).size !== value.engines.length ||
    !Array.isArray(value.residuals) ||
    value.residuals.length > 1024 ||
    value.residuals.some(
      (path) => typeof path !== "string" || absoluteInstallationPath(path) !== path,
    ) ||
    !value.files ||
    typeof value.files !== "object" ||
    Array.isArray(value.files) ||
    Object.keys(value.files).length > 256 ||
    !value.files.code60 ||
    !value.files["runtime/management/removal-support.js"] ||
    !value.files["runtime/management/removal-state.js"] ||
    !value.files["runtime/platform/index.js"] ||
    !value.files["runtime/package.json"] ||
    Object.entries(value.files).some(
      ([path, hash]) =>
        !/^(?:code60|runtime\/package\.json|runtime\/(?:management|platform)\/[a-z-]+\.(?:js|mjs))$/.test(
          path,
        ) || !digest(hash),
    )
  )
    throw refused();
  validateRemovalServiceProof(value.service);
  if (
    value.service.home !== record.home ||
    value.service.runtime.executable !== value.node ||
    !value.inventories.some(
      (inventory) => value.service.runtime.args[0] === join(inventory.root, "dist/gateway/main.js"),
    )
  )
    throw refused();
  validateLink(value.current, join(record.root, "current"), `activations/${value.generation}`);
  if (
    value.current.parent.dev !== value.rootIdentity.dev ||
    value.current.parent.ino !== value.rootIdentity.ino
  )
    throw refused();
  if (value.launcher)
    validateLink(value.launcher, record.launcher, join(record.root, "current/code60"));
  const seen = new Set<string>();
  for (const inventory of value.inventories) {
    if (
      !inventory ||
      typeof inventory.root !== "string" ||
      (!/^releases\/[a-f0-9]{64}$/.test(inventory.root.slice(record.root.length + 1)) &&
        !/^activations\/[a-f0-9-]{36}$/.test(inventory.root.slice(record.root.length + 1))) ||
      !inventory.root.startsWith(`${record.root}/`) ||
      seen.has(inventory.root)
    )
      throw refused();
    seen.add(inventory.root);
    validateInstallationRemovalInventory(inventory);
  }
  if (!seen.has(join(record.root, "activations", value.generation))) throw refused();
  for (const engine of value.engines) {
    if (
      !engine ||
      !["0.1.0-staging.18", "0.1.0-staging.20"].includes(engine.version) ||
      typeof engine.node !== "string" ||
      absoluteInstallationPath(engine.node) !== engine.node ||
      typeof engine.root !== "string" ||
      !engine.root.startsWith(`${record.root}/engines/`) ||
      !/^[a-f0-9]{64}$/.test(engine.root.slice(`${record.root}/engines/`.length)) ||
      engine.entry !==
        join(
          engine.root,
          "node_modules",
          engine.version.endsWith(".18") ? "transmission-18" : "transmission-20",
          "dist/src/main.js",
        )
    )
      throw refused();
  }
  if (process.platform !== "darwin" && value.engines.length) throw refused();
}

export async function readRemovalState(record: InstallationRecord): Promise<RemovalState | null> {
  await installationDirectory(record.root, false, true);
  const snapshot = await installationSnapshot(join(record.root, "removal.json"), 4096, true);
  if (!snapshot) return null;
  const value = parse<RemovalProgress>(snapshot.text);
  if (
    !value ||
    value.schema !== 1 ||
    value.installationId !== record.id ||
    !uuid(value.attempt) ||
    !digest(value.receiptHash) ||
    !["prepared", "removing", "complete"].includes(value.phase)
  )
    throw refused();
  const directory = join(record.root, "removals", value.attempt);
  await installationDirectory(directory, false, true);
  const file = await installationSnapshot(join(directory, "receipt.json"), 64 * 1024 ** 2, true);
  if (!file || file.identity.hash !== value.receiptHash) throw refused();
  const receipt = parse<RemovalReceipt>(file.text);
  validateRemovalReceipt(record, receipt);
  if (
    receipt.attempt !== value.attempt ||
    JSON.stringify(await readInstallation(record)) !== JSON.stringify(record) ||
    JSON.stringify(await installationTreeIdentity(record.root)) !==
      JSON.stringify(receipt.rootIdentity)
  )
    throw refused();
  for (const [path, hash] of Object.entries(receipt.files)) {
    const support = await installationSnapshot(join(directory, path), 4 * 1024 ** 2, true);
    if (
      !support ||
      support.identity.hash !== hash ||
      support.identity.mode !== (path === "code60" ? 0o700 : 0o600)
    )
      throw refused();
  }
  return { value, identity: snapshot.identity, receipt, directory };
}

export async function writeRemovalProgress(
  record: InstallationRecord,
  value: RemovalProgress,
  previous: RemovalState | null,
) {
  if (
    !value ||
    value.schema !== 1 ||
    value.installationId !== record.id ||
    !uuid(value.attempt) ||
    !digest(value.receiptHash) ||
    !["prepared", "removing", "complete"].includes(value.phase) ||
    (previous && previous.value.phase !== "complete" && value.attempt !== previous.value.attempt)
  )
    throw refused();
  await writeInstallationFile(
    join(record.root, "removal.json"),
    `${JSON.stringify(value)}\n`,
    previous?.identity ?? null,
  );
  const saved = await readRemovalState(record);
  if (!saved || JSON.stringify(saved.value) !== JSON.stringify(value)) throw refused();
  return saved;
}

export async function assertRemovalAllowsInstall(record: InstallationRecord, verifySupport = true) {
  const state = await readRemovalState(record);
  if (!state) return;
  if (state.value.phase !== "complete")
    throw Error(
      `Uninstall needs recovery; run ${join(state.directory, "code60")} uninstall --yes before reinstalling`,
    );
  const target = await installationLink(join(record.root, "current"));
  if (target) {
    const active = await readActivation(record, target, verifySupport);
    if (
      active.generation === state.receipt.generation ||
      state.receipt.inventories.some((inventory) => inventory.root === join(record.root, target))
    )
      throw Error(
        "Completed uninstall contradicts its original activation; preserve recovery evidence",
      );
    // A later receipted activation is an explicit reinstall, not permission for
    // the old recovery helper to delete anything from that installation.
    return;
  }
  for (const path of [
    join(record.root, "current"),
    ...state.receipt.inventories.map((inventory) => inventory.root),
  ]) {
    const exists = await lstat(path).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return null;
    });
    if (exists)
      throw Error(
        "Completed uninstall conflicts with retained application files; preserve state and inspect recovery",
      );
  }
}
