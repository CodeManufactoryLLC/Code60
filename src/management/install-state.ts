import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { join } from "node:path";
import {
  absoluteInstallationPath,
  installationDirectory,
  installationLink,
  installationSnapshot,
  userHome,
  verifyInstallationNode,
} from "../platform/index.js";

export interface ArtifactIdentity {
  version: string;
  os: string;
  arch: string;
  archive: { sha256: string };
}
export interface InstallationPaths {
  home: string;
  root: string;
  bin: string;
  launcher: string;
}
export interface InstallationRecord extends InstallationPaths {
  schema: 1;
  id: string;
}
export interface ActivationRecord {
  schema: 1;
  installationId: string;
  generation: string;
  release: ArtifactIdentity & { path: string; manifestHash: string };
  node: { path: string; version: string };
  runtimeFiles: Record<string, string>;
  launcherHash: string;
}
export const installationDigest = (text: string | Buffer) =>
  createHash("sha256").update(text).digest("hex");
export const shellQuote = (text: string) => `'${text.replaceAll("'", `'"'"'`)}'`;
export function supportedInstallationRuntime() {
  if (process.getuid?.() === 0) throw new Error("Managed installation must run as a non-root user");
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (
    major !== 24 ||
    (minor ?? 0) < 22 ||
    !["darwin-arm64", "linux-x64"].includes(`${process.platform}-${process.arch}`)
  )
    throw new Error("Managed installation requires Node >=24.22.0 <25 on macOS arm64 or Linux x64");
}
export async function installationPaths(env: NodeJS.ProcessEnv): Promise<InstallationPaths> {
  const home = await realpath(absoluteInstallationPath(userHome(env)));
  if ((await lstat(home)).uid !== process.getuid?.())
    throw new Error("HOME must be owned by the installing user");
  const base = env.XDG_DATA_HOME
    ? absoluteInstallationPath(env.XDG_DATA_HOME)
    : join(home, ".local/share");
  const root = join(base, "code60");
  const bin = join(home, ".local/bin");
  if (root === home || root === bin || bin.startsWith(`${root}/`) || root.startsWith(`${bin}/`))
    throw new Error("Installation roots overlap");
  return { home, root, bin, launcher: join(bin, "code60") };
}
export async function readInstallation(
  paths: InstallationPaths,
): Promise<InstallationRecord | null> {
  await installationDirectory(paths.root, false, true);
  const file = await installationSnapshot(join(paths.root, "installation.json"), 16_384, true);
  if (!file) return null;
  const value = JSON.parse(file.text) as InstallationRecord;
  if (
    value.schema !== 1 ||
    !/^[a-f0-9-]{36}$/.test(value.id) ||
    value.root !== paths.root ||
    value.home !== paths.home ||
    value.bin !== paths.bin ||
    value.launcher !== paths.launcher
  )
    throw new Error("Invalid installation receipt; existing files preserved");
  return value;
}
export async function readActivation(
  record: InstallationRecord,
  target: string,
  verifySupport = true,
): Promise<ActivationRecord> {
  if (!/^activations\/[a-f0-9-]{36}$/.test(target)) throw new Error("Unsafe activation pointer");
  const directory = join(record.root, target);
  await installationDirectory(directory, false, true);
  const file = await installationSnapshot(join(directory, "receipt.json"), 65_536, true);
  if (!file) throw new Error("Missing activation receipt");
  const value = JSON.parse(file.text) as ActivationRecord;
  if (
    value.schema !== 1 ||
    value.installationId !== record.id ||
    value.generation !== target.slice(12) ||
    !value.release ||
    !/^[a-f0-9]{64}$/.test(value.release.archive?.sha256) ||
    !/^[a-f0-9]{64}$/.test(value.release.manifestHash) ||
    !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(value.release.version) ||
    `${value.release.os}-${value.release.arch}` !== `${process.platform}-${process.arch}` ||
    value.release.path !== join(record.root, "releases", value.release.archive.sha256) ||
    !value.node ||
    !value.runtimeFiles ||
    !Object.keys(value.runtimeFiles).length ||
    !/^[a-f0-9]{64}$/.test(value.launcherHash)
  )
    throw new Error("Invalid activation receipt");
  absoluteInstallationPath(value.node.path);
  await installationDirectory(value.release.path, false, true);
  const manifest = await installationSnapshot(
    join(value.release.path, "payload.json"),
    64 * 1024 ** 2,
  );
  if (!manifest || manifest.identity.hash !== value.release.manifestHash)
    throw new Error("Installed payload identity changed");
  for (const [path, hash] of Object.entries(value.runtimeFiles)) {
    if (!/^(?:management|platform)\/[a-z0-9-]+\.js$/.test(path) || !/^[a-f0-9]{64}$/.test(hash))
      throw new Error("Unsafe launcher support path");
    const support = verifySupport
      ? await installationSnapshot(join(directory, "runtime", path))
      : null;
    if (verifySupport && (!support || support.identity.hash !== hash))
      throw new Error("Launcher support changed");
  }
  const launcher = verifySupport ? await installationSnapshot(join(directory, "code60")) : null;
  if (
    (verifySupport && (!launcher || launcher.identity.hash !== value.launcherHash)) ||
    !value.runtimeFiles["management/installed-launcher.js"] ||
    !value.runtimeFiles["management/install-state.js"] ||
    !value.runtimeFiles["platform/index.js"]
  )
    throw new Error("Owned launcher changed");
  const entry = join(value.release.path, "dist/management/cli.js");
  await installationDirectory(join(value.release.path, "dist/management"));
  const info = await lstat(entry);
  if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid?.())
    throw new Error("Installed entrypoint is unavailable");
  return value;
}
export async function currentInstallation(record: InstallationRecord, verifySupport = true) {
  const target = await installationLink(join(record.root, "current"));
  return target ? { target, receipt: await readActivation(record, target, verifySupport) } : null;
}
export async function verifyBoundNode(receipt: ActivationRecord) {
  supportedInstallationRuntime();
  if ((await verifyInstallationNode()) !== receipt.node.path)
    throw new Error(
      "The recorded Node executable moved or changed; reconcile this installation using supported Node",
    );
}
