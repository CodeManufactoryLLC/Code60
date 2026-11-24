import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { installationFileCode, verifyInstallationNode } from "./installation-files.js";

const execute = promisify(execFile);
function supportedNativeInspection() {
  if (process.platform !== "darwin" || process.arch !== "arm64")
    throw Error("Transmission process inspection requires macOS Apple Silicon");
}
export interface RuntimeProcessIdentity {
  pid: number;
  parent: number;
  uid: number;
  started: string;
  commandHash: string;
}
const unavailable = () =>
  new Error(
    "Runtime process ownership is unavailable; preserve the installation and inspect retained state",
  );
function validPid(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0 || pid > 2 ** 31 - 1) throw unavailable();
}
function numericUid(value: string | undefined) {
  const uid = Number(value);
  if (!Number.isSafeInteger(uid) || uid < -(2 ** 31) || uid > 2 ** 32 - 1) throw unavailable();
  // BSD ps renders some system UIDs (for example nobody) as signed integers.
  return uid < 0 ? uid + 2 ** 32 : uid;
}
export function runtimeProcessExists(pid: number) {
  validPid(pid);
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (installationFileCode(error) === "ESRCH") return false;
    throw unavailable();
  }
}
async function ps(args: readonly string[], maximum: number, signal?: AbortSignal) {
  supportedNativeInspection();
  try {
    const result = await execute("/bin/ps", [...args], {
      cwd: "/",
      env: { LC_ALL: "C", PATH: "/usr/bin:/bin" },
      timeout: 5000,
      maxBuffer: maximum,
      ...(signal ? { signal } : {}),
    });
    return result.stdout;
  } catch {
    signal?.throwIfAborted();
    throw unavailable();
  }
}
async function verifyRuntimeExecutable(pid: number, executable: string, signal?: AbortSignal) {
  if ((await verifyInstallationNode(executable)) !== executable) throw unavailable();
  // macOS has no /proc executable link. Read this user's kernel text-file inventory,
  // never argv alone, before attributing an engine to its canonical Node binding.
  const result = await execute(
    "/usr/sbin/lsof",
    ["-a", "-p", String(pid), "-d", "txt", "-Fn", "-n", "-P"],
    {
      cwd: "/",
      env: { LC_ALL: "C", PATH: "/usr/bin:/bin" },
      timeout: 5000,
      maxBuffer: 1024 * 1024,
      ...(signal ? { signal } : {}),
    },
  );
  if (!result.stdout.split("\n").includes(`n${executable}`)) throw unavailable();
}
/** Inspect fixed argv and user identity without launching a runtime or sending a termination signal. */
export async function inspectMacRuntimeProcess(
  pid: number,
  command: readonly string[],
  signal?: AbortSignal,
): Promise<RuntimeProcessIdentity | null> {
  validPid(pid);
  signal?.throwIfAborted();
  supportedNativeInspection();
  if (
    !command.length ||
    command.length > 64 ||
    command.some((part) => !part || /[\0\r\n]/.test(part)) ||
    Buffer.byteLength(command.join(" ")) > 32_768
  )
    throw unavailable();
  const query = ["-ww", "-p", String(pid), "-o", "pid=,ppid=,uid=,lstart=,args="];
  let output: string;
  try {
    output = await ps(query, 64 * 1024, signal);
  } catch (error) {
    signal?.throwIfAborted();
    if (!runtimeProcessExists(pid)) return null;
    throw error;
  }
  // Locale is fixed above. Never return or log raw argv (which may contain private inputs).
  const match =
    /^\s*(\d+)\s+(\d+)\s+(-?\d+)\s+([A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+([^\r\n]+)\s*$/.exec(
      output,
    );
  if (!match) {
    if (!runtimeProcessExists(pid)) return null;
    throw unavailable();
  }
  const [, observed, parent, uid, started, args] = match;
  if (
    Number(observed) !== pid ||
    numericUid(uid) !== process.getuid?.() ||
    !Number.isSafeInteger(Number(parent)) ||
    Number(parent) < 0 ||
    !started ||
    args?.trim() !== command.join(" ")
  )
    throw unavailable();
  try {
    await verifyRuntimeExecutable(pid, command[0] ?? "", signal);
    if ((await ps(query, 64 * 1024, signal)) !== output) throw unavailable();
  } catch {
    signal?.throwIfAborted();
    if (!runtimeProcessExists(pid)) return null;
    throw unavailable();
  }
  return {
    pid,
    parent: Number(parent),
    uid: numericUid(uid),
    started: started.replace(/\s+/g, " "),
    commandHash: createHash("sha256").update(args.trim()).digest("hex"),
  };
}

/** Capture descendants for later absence checks. This grants no authority to signal arbitrary PIDs. */
export async function macRuntimeProcessFamily(owner: RuntimeProcessIdentity, signal?: AbortSignal) {
  validPid(owner.pid);
  if (owner.uid !== process.getuid?.()) throw unavailable();
  supportedNativeInspection();
  const rows = (await ps(["-axo", "pid=,ppid=,uid="], 2 * 1024 ** 2, signal))
    .trim()
    .split("\n")
    .map((row) => {
      const match = /^\s*(\d+)\s+(\d+)\s+(-?\d+)\s*$/.exec(row);
      if (!match) throw unavailable();
      return { pid: Number(match[1]), parent: Number(match[2]), uid: numericUid(match[3]) };
    });
  const root = rows.find((row) => row.pid === owner.pid);
  if (rows.length > 100_000 || !root || root.uid !== owner.uid || root.parent !== owner.parent)
    throw unavailable();
  const children = new Map<number, typeof rows>();
  for (const row of rows) {
    const group = children.get(row.parent) ?? [];
    group.push(row);
    children.set(row.parent, group);
  }
  const ids = new Set([owner.pid]);
  const pending = [owner.pid];
  for (let index = 0; index < pending.length; index++) {
    for (const row of children.get(pending[index] ?? -1) ?? []) {
      validPid(row.pid);
      if (row.uid !== owner.uid) throw unavailable();
      if (!ids.has(row.pid)) {
        ids.add(row.pid);
        pending.push(row.pid);
      }
      if (ids.size > 4096) throw unavailable();
    }
  }
  return [...ids];
}

/** Poll only; never resend a signal to a possibly reused process identity. */
export async function waitForRuntimeExit(
  pids: readonly number[],
  signal?: AbortSignal,
  timeout = 7000,
) {
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 90_000 || pids.length > 4096)
    throw unavailable();
  for (const pid of pids) validPid(pid);
  const deadline = Date.now() + timeout;
  for (;;) {
    signal?.throwIfAborted();
    if (!pids.some(runtimeProcessExists)) return;
    if (Date.now() >= deadline)
      throw Error(
        "Recorded runtime processes remain; preserve installation files and inspect cleanup",
      );
    await delay(
      Math.min(25, Math.max(1, deadline - Date.now())),
      undefined,
      signal ? { signal } : {},
    );
  }
}
