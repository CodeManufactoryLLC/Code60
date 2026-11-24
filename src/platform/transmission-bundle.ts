import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { chmod, cp, lstat, mkdtemp, open, readdir, realpath, rename } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { userHome } from "./environment.js";
import {
  absoluteInstallationPath,
  createInstallationParents,
  installationDirectory,
  installationFileCode,
  installationSnapshot,
  installationTreeIdentity,
  lockInstallation,
  removeInstallationTree,
  syncInstallationDirectory,
  verifyInstallationNode,
  writeInstallationFile,
} from "./installation-files.js";

export const transmissionVersions = ["0.1.0-staging.18", "0.1.0-staging.20"] as const;
export type TransmissionVersion = (typeof transmissionVersions)[number];
const integrities = {
  "0.1.0-staging.18":
    "sha512-U1SLG4FZv7yYW9eMzKEVSNx6tZ85YRbGyagEfcBzedfEQkn8Qaj1SS+duXST+8WH4jFaF8XZAbp+tTTiGbhDVg==",
  "0.1.0-staging.20":
    "sha512-23Y6om57UMB1pCAe+XcbH84JzFk0xo6CHJHiCfd06G5E1m1OAxY/JDI9UR43dfACAJfpWQHN+Wm67U4Lc+Xy9Q==",
};
interface BundleFile {
  path: string;
  type: "0";
  sha256: string;
  size: number;
}
interface TransmissionBundle {
  schema: 1;
  os: "darwin";
  arch: "arm64";
  node: ">=24.22.0 <25";
  builtWithNode: string;
  lockfileSha256: string;
  engines: Record<TransmissionVersion, { entry: string; integrity: string }>;
  native: { path: string; version: string; sha256: string };
  files: BundleFile[];
}
const digest = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function safePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 4096 &&
    !/[\\\0\r\n]/.test(value) &&
    !isAbsolute(value) &&
    value.split("/").every((part) => part && part !== "." && part !== "..")
  );
}
export function transmissionStorage(env: NodeJS.ProcessEnv) {
  return join(
    env.XDG_DATA_HOME
      ? absoluteInstallationPath(env.XDG_DATA_HOME)
      : join(absoluteInstallationPath(userHome(env)), ".local/share"),
    "code60/engines",
  );
}
async function ownedStorage(env: NodeJS.ProcessEnv) {
  const home = await realpath(absoluteInstallationPath(userHome(env)));
  if ((await lstat(home)).uid !== process.getuid?.())
    throw Error("Transmission HOME must belong to the current user");
  return transmissionStorage({ ...env, HOME: home });
}
async function verifyFile(root: string, item: BundleFile, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const path = join(root, item.path);
  await installationDirectory(join(path, ".."));
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const start = await file.stat({ bigint: true });
    if (
      !start.isFile() ||
      start.nlink !== 1n ||
      start.uid !== BigInt(process.getuid?.() ?? -1) ||
      start.mode & 0o7022n ||
      start.size !== BigInt(item.size)
    )
      throw Error("Unsafe Transmission bundle file");
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(256 * 1024);
    let size = 0;
    for (;;) {
      signal?.throwIfAborted();
      const { bytesRead } = await file.read(buffer);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > item.size) throw Error("Transmission bundle file grew while reading");
      hash.update(buffer.subarray(0, bytesRead));
    }
    const after = await file.stat({ bigint: true });
    const entry = await lstat(path, { bigint: true });
    if (
      start.ctimeNs !== after.ctimeNs ||
      start.mtimeNs !== after.mtimeNs ||
      entry.dev !== start.dev ||
      entry.ino !== start.ino ||
      hash.digest("hex") !== item.sha256
    )
      throw Error("Transmission bundle file identity changed");
  } finally {
    await file.close();
  }
}
export async function inspectTransmissionBundle(root: string, signal?: AbortSignal) {
  await installationDirectory(root);
  const snapshot = await installationSnapshot(join(root, "bundle.json"), 16 * 1024 ** 2);
  if (!snapshot) throw Error("Missing bundled Transmission manifest");
  const value = JSON.parse(snapshot.text) as TransmissionBundle;
  if (
    value.schema !== 1 ||
    value.os !== "darwin" ||
    value.arch !== "arm64" ||
    value.node !== ">=24.22.0 <25" ||
    !digest(value.lockfileSha256) ||
    !Array.isArray(value.files) ||
    value.files.length > 20_000 ||
    !value.native ||
    !safePath(value.native.path) ||
    value.native.version !== "0.171.0" ||
    !digest(value.native.sha256)
  )
    throw Error("Invalid Transmission bundle identity");
  const files = new Map<string, BundleFile>();
  let total = 0;
  for (const file of value.files) {
    if (
      !safePath(file.path) ||
      file.path === "bundle.json" ||
      file.type !== "0" ||
      !digest(file.sha256) ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      file.size > 2 * 1024 ** 3 ||
      files.has(file.path)
    )
      throw Error("Unsafe Transmission bundle inventory");
    files.set(file.path, file);
    total += file.size;
    if (total > 2 * 1024 ** 3) throw Error("Transmission bundle exceeds size limit");
  }
  for (const version of transmissionVersions) {
    const engine = value.engines?.[version];
    if (
      engine?.integrity !== integrities[version] ||
      engine.entry !== `node_modules/transmission-${version.slice(-2)}/dist/src/main.js` ||
      !files.has(engine.entry)
    )
      throw Error("Transmission engine differs from the supported pinned artifact");
  }
  if (
    files.get("package-lock.json")?.sha256 !== value.lockfileSha256 ||
    files.get(value.native.path)?.sha256 !== value.native.sha256 ||
    !files.has("node_modules/@agentclientprotocol/codex-acp/dist/index.js")
  )
    throw Error("Transmission runtime inventory is incomplete");
  if (!((await lstat(join(root, value.native.path))).mode & 0o111))
    throw Error("Transmission native runtime is not executable");
  const observed = new Set<string>();
  let entries = 0;
  async function walk(directory: string, prefix = "") {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (++entries > 40_000 || path.length > 4096)
        throw Error("Transmission bundle exceeds inventory limit");
      if (item.isDirectory()) await walk(join(directory, item.name), path);
      else if (item.isFile() && (path === "bundle.json" || files.has(path))) observed.add(path);
      else throw Error("Unexpected Transmission bundle content");
      if (observed.size > 20_001) throw Error("Transmission bundle exceeds inventory limit");
    }
  }
  await walk(root);
  if (observed.size !== files.size + 1) throw Error("Transmission bundle inventory mismatch");
  for (const file of files.values()) await verifyFile(root, file, signal);
  return { manifest: value, hash: snapshot.identity.hash };
}

export async function resolveTransmissionRuntime(
  env: NodeJS.ProcessEnv,
  version: TransmissionVersion,
  signal?: AbortSignal,
) {
  const storage = await ownedStorage(env);
  const absent = () =>
    Object.assign(
      Error("Bundled Transmission is unavailable; prepare the Code60 engine assets or run setup"),
      { code: "CODE60_ENGINE_UNAVAILABLE" },
    );
  if (
    !(await lstat(storage).catch((error: unknown) => {
      if (installationFileCode(error) !== "ENOENT") throw error;
      return null;
    }))
  )
    throw absent();
  await installationDirectory(storage, false, true);
  const snapshot = await installationSnapshot(join(storage, `${version}.json`), 4096, true);
  if (!snapshot) throw absent();
  const receipt = JSON.parse(snapshot.text) as {
    schema: number;
    version: string;
    bundle: string;
    manifestHash: string;
    node: string;
    nodeVersion: string;
  };
  if (
    receipt.schema !== 1 ||
    receipt.version !== version ||
    !digest(receipt.bundle) ||
    !digest(receipt.manifestHash) ||
    typeof receipt.node !== "string" ||
    !isAbsolute(receipt.node) ||
    typeof receipt.nodeVersion !== "string" ||
    !/^24\.(?:2[2-9]|[3-9]\d|\d{3,})\.[0-9]+$/.test(receipt.nodeVersion)
  )
    throw Error("Invalid Transmission runtime binding; preserved existing state");
  const root = join(storage, receipt.bundle);
  const bundle = await inspectTransmissionBundle(root, signal);
  if (bundle.hash !== receipt.manifestHash || bundle.manifest.lockfileSha256 !== receipt.bundle)
    throw Error("Transmission runtime binding changed; preserved existing state");
  if ((await verifyInstallationNode(receipt.node)) !== receipt.node)
    throw Error("Transmission Node binding moved; explicit repair is required");
  return {
    root,
    node: receipt.node,
    entry: join(root, bundle.manifest.engines[version].entry),
    codex: join(root, bundle.manifest.native.path),
  };
}

// Copies already verified local assets only. It never acquires packages, invokes
// a compiler, changes workflow state, or starts a process. Callers must hold an
// explicit installation or workflow-start intent; status must use resolve only.
export async function preserveTransmissionBundle(
  source: string,
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
  options: { checkpoint?: (phase: "cached" | "bound") => Promise<void> } = {},
) {
  if (`${process.platform}-${process.arch}` !== "darwin-arm64")
    throw Error("Bundled Transmission execution requires macOS arm64");
  if (process.getuid?.() === 0)
    throw Error("Transmission installation must run as a non-root user");
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major !== 24 || (minor ?? 0) < 22)
    throw Error("Bundled Transmission requires Node >=24.22.0 <25");
  const checked = await inspectTransmissionBundle(source, signal);
  const storage = await ownedStorage(env);
  await createInstallationParents(storage, true);
  const release = await lockInstallation(storage);
  let owned: { path: string; identity: { dev: string; ino: string } } | undefined;
  let candidate: { path: string; identity: { dev: string; ino: string } } | undefined;
  let failure: unknown;
  try {
    signal?.throwIfAborted();
    const node = await verifyInstallationNode();
    const destination = join(storage, checked.manifest.lockfileSha256);
    const bindings = [];
    for (const version of transmissionVersions) {
      const path = join(storage, `${version}.json`);
      const receipt = await installationSnapshot(path, 4096, true);
      if (receipt) {
        // A version binding is immutable. Later app releases cannot silently
        // replace its executable, transitive dependencies or canonical Node.
        const runtime = await resolveTransmissionRuntime(env, version, signal);
        if (runtime.root !== destination)
          throw Error(
            "A different Transmission runtime is already bound; preserved original binding",
          );
      } else bindings.push({ version, path });
    }
    const existing = await lstat(destination).catch((error: unknown) => {
      if (installationFileCode(error) !== "ENOENT") throw error;
      return null;
    });
    if (!existing) {
      const path = await mkdtemp(join(storage, ".engine-stage-"));
      owned = { path, identity: await installationTreeIdentity(path) };
      await cp(source, join(path, "bundle"), { recursive: true });
      await chmod(join(path, "bundle"), 0o700);
      const copied = await inspectTransmissionBundle(join(path, "bundle"), signal);
      if (copied.hash !== checked.hash) throw Error("Transmission bundle changed while copying");
      signal?.throwIfAborted();
      const identity = await installationTreeIdentity(join(path, "bundle"));
      await rename(join(path, "bundle"), destination);
      candidate = { path: destination, identity };
      await syncInstallationDirectory(storage);
    }
    const installed = await inspectTransmissionBundle(destination, signal);
    if (installed.hash !== checked.hash) throw Error("Conflicting installed Transmission bundle");
    await options.checkpoint?.("cached");
    for (const { version, path } of bindings) {
      signal?.throwIfAborted();
      await writeInstallationFile(
        path,
        JSON.stringify({
          schema: 1,
          version,
          bundle: checked.manifest.lockfileSha256,
          manifestHash: checked.hash,
          node,
          nodeVersion: process.versions.node,
        }),
        null,
      );
      await options.checkpoint?.("bound");
    }
  } catch (error) {
    failure = error;
  } finally {
    const errors: unknown[] = [];
    if (failure && candidate) {
      try {
        // A receipt write can fail after its atomic rename. Inspect publication
        // before removing a new tree; any binding or uncertainty preserves it.
        const bindings = await Promise.all(
          transmissionVersions.map((version) =>
            installationSnapshot(join(storage, `${version}.json`), 4096, true),
          ),
        );
        if (bindings.every((binding) => binding === null))
          await removeInstallationTree(candidate.path, candidate.identity);
      } catch (error) {
        errors.push(error);
      }
    }
    if (owned)
      try {
        await removeInstallationTree(owned.path, owned.identity);
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
        [...(failure ? [failure] : []), ...errors],
        "Transmission cache cleanup failed; published bindings and workflow state were preserved",
      );
  }
  if (failure) throw failure;
}
