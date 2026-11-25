import {
  findMacRuntimeProcesses,
  inspectMacRuntimeProcess,
  macFileProcesses,
  macRuntimeProcessFamily,
  type RuntimeProcessIdentity,
} from "./process-identity.js";
import {
  findLinuxRuntimeProcesses,
  inspectLinuxRuntimeProcess,
  linuxFileProcesses,
  linuxRuntimeProcessFamily,
  verifyLinuxRuntimeInspection,
} from "./process-identity-linux.js";

export function runtimeInspectionSupported() {
  return (
    (process.platform === "darwin" && process.arch === "arm64") ||
    (process.platform === "linux" && process.arch === "x64")
  );
}
export async function verifyRuntimeInspection(signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (!runtimeInspectionSupported()) throw Error("Native runtime inspection is unavailable");
  if (process.platform === "linux") await verifyLinuxRuntimeInspection(signal);
}
export const inspectRuntimeProcess = (
  pid: number,
  command: readonly string[],
  signal?: AbortSignal,
) =>
  process.platform === "linux"
    ? inspectLinuxRuntimeProcess(pid, command, signal)
    : inspectMacRuntimeProcess(pid, command, signal);
export const findRuntimeProcesses = (command: readonly string[], signal?: AbortSignal) =>
  process.platform === "linux"
    ? findLinuxRuntimeProcesses(command, signal)
    : findMacRuntimeProcesses(command, signal);
export const runtimeProcessFamily = (owner: RuntimeProcessIdentity, signal?: AbortSignal) =>
  process.platform === "linux"
    ? linuxRuntimeProcessFamily(owner, signal)
    : macRuntimeProcessFamily(owner, signal);
export const runtimeFileProcesses = (paths: readonly string[], signal?: AbortSignal) =>
  process.platform === "linux"
    ? linuxFileProcesses(paths, signal)
    : macFileProcesses(paths, signal);
