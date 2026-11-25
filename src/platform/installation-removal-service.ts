import { join } from "node:path";
import {
  absoluteInstallationPath,
  type FileIdentity,
  installationDirectory,
  installationSnapshot,
} from "./installation-files.js";
import { lockPrivateState } from "./private-state.js";
import { waitForRuntimeExit } from "./process-identity.js";
import { inspectUserService, type ServiceRuntime, userServiceDefinition } from "./user-service.js";

/** Non-secret original service scope, captured only after guarded unregistration. */
export interface RemovalServiceProof {
  schema: 1;
  home: string;
  root: string;
  runtime: ServiceRuntime;
  registration: FileIdentity | null;
  pids: number[];
}
export function validateRemovalServiceProof(value: RemovalServiceProof) {
  if (
    !value ||
    value.schema !== 1 ||
    typeof value.home !== "string" ||
    absoluteInstallationPath(value.home) !== value.home ||
    typeof value.root !== "string" ||
    absoluteInstallationPath(value.root) !== value.root ||
    !value.root.endsWith("/code60/gateway") ||
    !value.runtime ||
    typeof value.runtime.executable !== "string" ||
    absoluteInstallationPath(value.runtime.executable) !== value.runtime.executable ||
    !Array.isArray(value.runtime.args) ||
    value.runtime.args.length !== 1 ||
    typeof value.runtime.args[0] !== "string" ||
    absoluteInstallationPath(value.runtime.args[0]) !== value.runtime.args[0] ||
    !value.runtime.env ||
    typeof value.runtime.env !== "object" ||
    Array.isArray(value.runtime.env) ||
    Object.entries(value.runtime.env).some(
      ([key, item]) =>
        !/^[A-Z_][A-Z0-9_]*$/.test(key) || typeof item !== "string" || /[\0\r\n]/.test(item),
    ) ||
    !Array.isArray(value.pids) ||
    value.pids.length > 16384 ||
    new Set(value.pids).size !== value.pids.length ||
    value.pids.some((pid) => !Number.isInteger(pid) || pid < 1 || pid > 2 ** 31 - 1) ||
    (value.registration !== null &&
      (!value.registration ||
        typeof value.registration.dev !== "string" ||
        typeof value.registration.ino !== "string" ||
        !/^\d+$/.test(value.registration.dev) ||
        !/^\d+$/.test(value.registration.ino) ||
        value.registration.mode !== 0o600 ||
        !Number.isInteger(value.registration.size) ||
        value.registration.size < 1 ||
        value.registration.size > 16384 ||
        !/^[a-f0-9]{64}$/.test(value.registration.hash)))
  )
    throw Error("Invalid removal service proof; preserve the installation");
}

interface Ports {
  inspect: typeof inspectUserService;
  exited: typeof waitForRuntimeExit;
}
const defaults: Ports = { inspect: inspectUserService, exited: waitForRuntimeExit };
async function verifyAbsent(
  proof: RemovalServiceProof,
  signal: AbortSignal | undefined,
  ports: Ports,
) {
  validateRemovalServiceProof(proof);
  signal?.throwIfAborted();
  await installationDirectory(proof.root, false, true);
  const file = await installationSnapshot(join(proof.root, "registration.json"), 16384, true);
  if (JSON.stringify(file?.identity ?? null) !== JSON.stringify(proof.registration))
    throw Error("Backend registration changed after removal; preserve installation files");
  if (file) {
    let saved: {
      version?: number;
      installed?: boolean;
      previous?: unknown;
      runtime?: ServiceRuntime;
    };
    try {
      saved = JSON.parse(file.text);
    } catch {
      throw Error("Backend removal metadata is invalid");
    }
    if (
      saved?.version !== 1 ||
      saved.installed !== false ||
      saved.previous !== undefined ||
      JSON.stringify(saved.runtime) !== JSON.stringify(proof.runtime)
    )
      throw Error("Backend removal metadata is inconsistent; preserve installation files");
  }
  const definition = userServiceDefinition(
    process.platform,
    proof.home,
    proof.root,
    proof.runtime,
    "backend",
  );
  const native = await ports.inspect(definition);
  if (
    native.state !== "stopped" ||
    native.definitionPresent ||
    native.pid ||
    native.loaded === true ||
    (process.platform === "darwin" && native.loaded !== false)
  )
    throw Error("Backend absence is uncertain; preserve installation files");
  for (let index = 0; index < proof.pids.length; index += 4096)
    await ports.exited(proof.pids.slice(index, index + 4096), signal);
}

/** Caller already holds the compatible service-operation lock. */
export async function captureRemovalServiceProof(
  home: string,
  root: string,
  runtime: ServiceRuntime,
  pids: readonly number[],
  ports: Ports = defaults,
): Promise<RemovalServiceProof> {
  const file = await installationSnapshot(join(root, "registration.json"), 16384, true);
  const proof: RemovalServiceProof = {
    schema: 1,
    home,
    root,
    runtime: structuredClone(runtime),
    registration: file?.identity ?? null,
    pids: [...new Set(pids)],
  };
  await verifyAbsent(proof, undefined, ports);
  return proof;
}

/** Hold this lock throughout file cleanup; never resolve scope from the caller's new environment. */
export async function reserveRemovedBackend(
  proof: RemovalServiceProof,
  signal?: AbortSignal,
  ports: Ports = defaults,
) {
  validateRemovalServiceProof(proof);
  await installationDirectory(proof.root, false, true);
  const releaseOperation = await lockPrivateState(join(proof.root, "registration-operation"), {
    reclaimStale: false,
  });
  let releaseRuntime: (() => Promise<void>) | undefined;
  const release = async () => {
    const errors: unknown[] = [];
    for (const unlock of [releaseRuntime, releaseOperation])
      if (unlock) {
        try {
          await unlock();
        } catch (error) {
          errors.push(error);
        }
      }
    if (errors.length)
      throw new AggregateError(
        errors,
        "Removal backend ownership cleanup failed; preserved uncertain locks",
      );
  };
  try {
    // A foreground backend uses this writer too; service-mutation ownership
    // alone would still allow direct foreground startup during file deletion.
    releaseRuntime = await lockPrivateState(proof.root, { reclaimStale: false });
    await verifyAbsent(proof, signal, ports);
    return { release, verify: () => verifyAbsent(proof, signal, ports) };
  } catch (error) {
    try {
      await release();
    } catch (cleanup) {
      throw new AggregateError(
        [error, cleanup],
        "Removal verification and service-lock cleanup failed",
      );
    }
    throw error;
  }
}
