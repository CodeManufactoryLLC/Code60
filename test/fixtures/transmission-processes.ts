import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { readPrivateJson } from "../../src/platform/index.js";

const endpointSchema = z.strictObject({
  port: z.number().int().min(1).max(65535),
  token: z.string().regex(/^[a-f0-9]{64}$/),
});
export async function readNativeEndpoint(root: string) {
  const value = await readPrivateJson(join(root, "endpoint.json"), 4096).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return undefined;
    },
  );
  return value === undefined ? null : endpointSchema.parse(value);
}

export function nativeProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}
export function nativeProcessFamily(pid: number) {
  const rows = execFileSync("/bin/ps", ["-axo", "pid=,ppid="], {
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 2 * 1024 ** 2,
  })
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/).map(Number));
  const ids = new Set([pid]);
  let previous = 0;
  while (previous !== ids.size) {
    previous = ids.size;
    for (const [child, parent] of rows) if (child && parent && ids.has(parent)) ids.add(child);
  }
  return ids;
}

/** Stop only engines rooted in this fixture, including a wrongly routed version. */
export async function stopNativeEngines(roots: readonly string[], owned: Set<number>) {
  const errors: unknown[] = [];
  for (const root of roots) {
    try {
      const endpoint = await readNativeEndpoint(root);
      if (!endpoint) continue;
      const request = async (operation: string) =>
        fetch(`http://127.0.0.1:${endpoint.port}/${operation}`, {
          method: "POST",
          redirect: "error",
          headers: { authorization: `Bearer ${endpoint.token}` },
          body: "{}",
          signal: AbortSignal.timeout(operation === "health" ? 2000 : 15000),
        });
      const health = await request("health");
      if (!health.ok) throw Error("Fixture engine health failed during cleanup");
      const { pid } = (await health.json()) as { pid: number };
      if (!Number.isSafeInteger(pid) || pid < 1) throw Error("Invalid owned engine PID");
      for (const child of nativeProcessFamily(pid)) owned.add(child);
      const stopped = await request("stop");
      await stopped.body?.cancel();
      if (!stopped.ok) throw Error("Fixture engine rejected cleanup");
    } catch (error) {
      errors.push(error);
    }
  }
  const deadline = Date.now() + 7000;
  while ([...owned].some(nativeProcessAlive) && Date.now() < deadline) await delay(25);
  if ([...owned].some(nativeProcessAlive))
    errors.push(Error("Owned native processes remain after cleanup"));
  if (errors.length) throw new AggregateError(errors, "Native engine cleanup failed");
}
