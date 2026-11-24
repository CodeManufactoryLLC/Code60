import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, opendir, stat, statfs } from "node:fs/promises";
import { dirname } from "node:path";
import {
  absoluteInstallationPath,
  installationDirectory,
  installationFileCode,
  verifyInstallationNode,
} from "./installation-files.js";
import { verifyPrivatePath } from "./private-state.js";
import { type RuntimeProcessIdentity, runtimeProcessExists } from "./process-identity.js";

const unavailable = () =>
  Error("Runtime process ownership is unavailable; preserve installation files");
function pidValue(pid: number) {
  if (!Number.isInteger(pid) || pid < 1 || pid > 2 ** 31 - 1) throw unavailable();
}
function budget(signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (process.platform !== "linux" || process.arch !== "x64") throw unavailable();
  return AbortSignal.any([AbortSignal.timeout(5000), ...(signal ? [signal] : [])]);
}
async function bounded(path: string, maximum: number, signal: AbortSignal) {
  signal.throwIfAborted();
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const bytes = Buffer.alloc(maximum + 1);
    let size = 0;
    for (;;) {
      signal.throwIfAborted();
      const next = await file.read(bytes, size, bytes.length - size, null);
      if (!next.bytesRead || size + next.bytesRead === bytes.length) {
        size += next.bytesRead;
        return bytes.subarray(0, size);
      }
      size += next.bytesRead;
    }
  } finally {
    await file.close();
  }
}
async function text(path: string, maximum: number, signal: AbortSignal) {
  const bytes = await bounded(path, maximum, signal);
  if (bytes.length > maximum) throw unavailable();
  return bytes.toString("utf8");
}
// /proc/PID/stat field 2 can contain spaces and ')'; fields after its final ')'
// begin at state (3). starttime is field 22, measured since the current boot.
export function parseLinuxProcessStat(value: string, pid: number) {
  pidValue(pid);
  const end = value.lastIndexOf(")");
  if (!value.startsWith(`${pid} (`) || end < 3) throw unavailable();
  const fields = value
    .slice(end + 1)
    .trim()
    .split(/\s+/);
  const parent = Number(fields[1]);
  const state = fields[0] ?? "",
    ticks = fields[19] ?? "";
  if (
    fields.length < 20 ||
    !/^[RSDZTtXxKWPI]$/.test(fields[0] ?? "") ||
    !/^\d+$/.test(fields[1] ?? "") ||
    !Number.isInteger(parent) ||
    parent < 0 ||
    parent > 2 ** 31 - 1 ||
    !/^\d+$/.test(fields[19] ?? "")
  )
    throw unavailable();
  return { pid, parent, ticks, state };
}
export function parseLinuxProcessUid(value: string) {
  const match = /^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/m.exec(value);
  const ids = match?.slice(1).map(Number);
  if (!ids || ids.some((id) => !Number.isInteger(id) || id < 0 || id > 2 ** 32 - 1))
    throw unavailable();
  return ids;
}
async function boot(signal: AbortSignal) {
  if ((await statfs("/proc")).type !== 0x9fa0) throw unavailable();
  // Some emulators virtualize argv but expose their own executable through the
  // kernel. Such a view cannot prove either exact ownership or native absence.
  const node = await stat(await verifyInstallationNode(), { bigint: true });
  const ownExecutable = await stat("/proc/self/exe", { bigint: true });
  if (node.dev !== ownExecutable.dev || node.ino !== ownExecutable.ino) throw unavailable();
  const id = (await text("/proc/sys/kernel/random/boot_id", 64, signal)).trim();
  if (!/^[a-f0-9-]{36}$/.test(id)) throw unavailable();
  return id;
}
async function metadata(pid: number, bootId: string, signal: AbortSignal, includeForeign = false) {
  pidValue(pid);
  try {
    const uids = parseLinuxProcessUid(await text(`/proc/${pid}/status`, 16_384, signal));
    const uid = process.getuid?.();
    if (uid === undefined) throw unavailable();
    if (!uids.includes(uid) && !includeForeign) return null;
    if (uids.includes(uid) && uids.some((value) => value !== uid)) throw unavailable();
    const row = parseLinuxProcessStat(await text(`/proc/${pid}/stat`, 16_384, signal), pid);
    const effectiveUid = uids[1];
    if (effectiveUid === undefined) throw unavailable();
    return { pid, parent: row.parent, uid: effectiveUid, started: `${bootId}:${row.ticks}` };
  } catch (error) {
    signal.throwIfAborted();
    if (installationFileCode(error) === "ENOENT" && !runtimeProcessExists(pid)) return null;
    throw unavailable();
  }
}
async function users(bootId: string, signal: AbortSignal, includeForeign = false) {
  const rows = [];
  let count = 0;
  for await (const { name } of await opendir("/proc")) {
    signal.throwIfAborted();
    if (!/^[1-9]\d*$/.test(name)) continue;
    if (++count > 100_000) throw unavailable();
    const row = await metadata(Number(name), bootId, signal, includeForeign);
    if (row) rows.push(row);
  }
  return rows;
}
function commandBytes(command: readonly string[]) {
  if (
    !command.length ||
    command.length > 64 ||
    command.some((part) => !part || /[\0\r\n]/.test(part))
  )
    throw unavailable();
  const bytes = Buffer.from(`${command.join("\0")}\0`);
  if (bytes.length > 32_768) throw unavailable();
  return bytes;
}
async function inspect(pid: number, command: readonly string[], signal: AbortSignal) {
  pidValue(pid);
  const expected = commandBytes(command),
    bootId = await boot(signal);
  const executablePath = command[0];
  if (!executablePath) throw unavailable();
  try {
    const before = await metadata(pid, bootId, signal);
    if (!before) {
      if (!runtimeProcessExists(pid)) return null;
      throw unavailable();
    }
    const bytes = await bounded(`/proc/${pid}/cmdline`, 32_768, signal);
    if (
      !bytes.equals(expected) ||
      (await verifyInstallationNode(executablePath)) !== executablePath
    )
      throw unavailable();
    const executable = await stat(`/proc/${pid}/exe`, { bigint: true });
    const node = await stat(executablePath, { bigint: true });
    if (executable.dev !== node.dev || executable.ino !== node.ino) throw unavailable();
    const after = await metadata(pid, bootId, signal);
    if (
      JSON.stringify(before) !== JSON.stringify(after) ||
      !(await bounded(`/proc/${pid}/cmdline`, 32_768, signal)).equals(bytes)
    )
      throw unavailable();
    signal.throwIfAborted();
    return { ...before, commandHash: createHash("sha256").update(bytes).digest("hex") };
  } catch {
    signal.throwIfAborted();
    if (!runtimeProcessExists(pid)) return null;
    throw unavailable();
  }
}
export async function inspectLinuxRuntimeProcess(
  pid: number,
  command: readonly string[],
  signal?: AbortSignal,
) {
  return inspect(pid, command, budget(signal));
}
export async function verifyLinuxRuntimeInspection(signal?: AbortSignal) {
  try {
    await boot(budget(signal));
  } catch {
    signal?.throwIfAborted();
    throw Error(
      "Native Linux process inspection is unavailable; use native Linux x64 with readable procfs before uninstalling",
    );
  }
}
export async function findLinuxRuntimeProcesses(command: readonly string[], signal?: AbortSignal) {
  const boundedSignal = budget(signal),
    expected = commandBytes(command);
  const matches: RuntimeProcessIdentity[] = [];
  for (const row of await users(await boot(boundedSignal), boundedSignal)) {
    let bytes: Buffer;
    try {
      bytes = await bounded(`/proc/${row.pid}/cmdline`, 32_768, boundedSignal);
    } catch (error) {
      boundedSignal.throwIfAborted();
      if (installationFileCode(error) === "ENOENT" && !runtimeProcessExists(row.pid)) continue;
      throw unavailable();
    }
    if (!bytes.equals(expected)) continue;
    const checked = await inspect(row.pid, command, boundedSignal);
    if (checked) matches.push(checked);
    if (matches.length > 32) throw unavailable();
  }
  return matches;
}
export function linuxFamilyPids(
  owner: RuntimeProcessIdentity,
  rows: readonly Omit<RuntimeProcessIdentity, "commandHash">[],
  signal?: AbortSignal,
) {
  const root = rows.find((row) => row.pid === owner.pid);
  if (
    rows.length > 100_000 ||
    !root ||
    root.uid !== owner.uid ||
    root.parent !== owner.parent ||
    root.started !== owner.started
  )
    throw unavailable();
  const seen = new Set<number>(),
    children = new Map<number, Omit<RuntimeProcessIdentity, "commandHash">[]>();
  for (const row of rows) {
    signal?.throwIfAborted();
    pidValue(row.pid);
    if (
      seen.has(row.pid) ||
      !Number.isInteger(row.parent) ||
      row.parent < 0 ||
      row.parent > 2 ** 31 - 1
    )
      throw unavailable();
    seen.add(row.pid);
    const group = children.get(row.parent) ?? [];
    group.push(row);
    children.set(row.parent, group);
  }
  const ids = new Set([owner.pid]);
  for (const pid of ids) {
    signal?.throwIfAborted();
    for (const child of children.get(pid) ?? []) {
      if (child.uid !== owner.uid) throw unavailable();
      ids.add(child.pid);
    }
    if (ids.size > 4096) throw unavailable();
  }
  return [...ids];
}
export async function linuxRuntimeProcessFamily(
  owner: RuntimeProcessIdentity,
  signal?: AbortSignal,
) {
  const s = budget(signal),
    bootId = await boot(s);
  if (owner.uid !== process.getuid?.() || !/^[a-f0-9]{64}$/.test(owner.commandHash))
    throw unavailable();
  const same = async () => {
    const row = await metadata(owner.pid, bootId, s);
    if (!row || row.started !== owner.started || row.parent !== owner.parent) throw unavailable();
  };
  await same();
  const ids = linuxFamilyPids(owner, await users(bootId, s, true), s);
  await same();
  return ids;
}
export async function linuxFileProcesses(paths: readonly string[], signal?: AbortSignal) {
  const s = budget(signal);
  if (paths.length > 8) throw unavailable();
  if (!paths.length) return [];
  const identities = [];
  for (const path of paths) {
    if (absoluteInstallationPath(path) !== path) throw unavailable();
    await installationDirectory(dirname(path), false, true);
    identities.push(await verifyPrivatePath(path, false));
  }
  const wanted = new Set(identities.map((i) => `${i.dev}:${i.ino}`)),
    ids = [];
  const bootId = await boot(s);
  let descriptors = 0;
  for (const row of await users(bootId, s)) {
    try {
      let found = false;
      for await (const { name: fd } of await opendir(`/proc/${row.pid}/fd`)) {
        s.throwIfAborted();
        if (++descriptors > 200_000) throw unavailable();
        if (!/^\d+$/.test(fd)) throw unavailable();
        const file = await stat(`/proc/${row.pid}/fd/${fd}`, { bigint: true }).catch(
          (error: unknown) => {
            if (installationFileCode(error) !== "ENOENT") throw error;
            return null;
          },
        );
        if (file && wanted.has(`${file.dev}:${file.ino}`)) found = true;
      }
      const after = await metadata(row.pid, bootId, s);
      if (!after) continue;
      if (JSON.stringify(after) !== JSON.stringify(row)) throw unavailable();
      if (found) ids.push(row.pid);
      if (ids.length > 64) throw unavailable();
    } catch (error) {
      s.throwIfAborted();
      if (installationFileCode(error) === "ENOENT" && !runtimeProcessExists(row.pid)) continue;
      throw unavailable();
    }
  }
  for (let index = 0; index < paths.length; index++) {
    const path = paths[index],
      before = identities[index];
    if (!path || !before) throw unavailable();
    const after = await verifyPrivatePath(path, false);
    if (after.dev !== before.dev || after.ino !== before.ino) throw unavailable();
  }
  return ids;
}
