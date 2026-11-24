import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  LEGACY_TRANSMISSION_VERSION,
  TRANSMISSION_VERSION,
  type WorkflowRecord,
} from "../bridge/index.js";
import {
  fileCode,
  findMacRuntimeProcesses,
  installationDirectory,
  installationSnapshot,
  macFileProcesses,
  macRuntimeProcessFamily,
  type RuntimeProcessIdentity,
  resolveTransmissionRuntime,
  verifyPrivatePath,
  waitForRuntimeExit,
} from "../platform/index.js";

type Version = NonNullable<WorkflowRecord["engineVersion"]>;
interface Endpoint {
  port: number;
  token: string;
}
export interface PreparedEngineRemoval {
  version: Version;
  pids: readonly number[];
  stop(signal: AbortSignal): Promise<void>;
}
export interface TransmissionRemovalPorts {
  supported: boolean;
  runtime(
    env: NodeJS.ProcessEnv,
    version: Version,
    signal: AbortSignal,
  ): Promise<{ node: string; entry: string }>;
  processes(command: readonly string[], signal: AbortSignal): Promise<RuntimeProcessIdentity[]>;
  family(owner: RuntimeProcessIdentity, signal: AbortSignal): Promise<number[]>;
  holders(paths: readonly string[], signal: AbortSignal): Promise<number[]>;
  exited(pids: readonly number[], signal: AbortSignal): Promise<void>;
  request(endpoint: Endpoint, action: "health" | "stop", signal: AbortSignal): Promise<unknown>;
}
const refused = () =>
  Error(
    "Engine ownership or history is uncertain; preserve evidence and resolve workflows before uninstalling",
  );
const terminal = (status: unknown) => ["completed", "failed", "cancelled"].includes(String(status));
const uuid = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9-]{36}$/.test(value);
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw refused();
  return value as Record<string, unknown>;
};
async function nativeRequest(endpoint: Endpoint, action: "health" | "stop", signal: AbortSignal) {
  const response = await fetch(`http://127.0.0.1:${endpoint.port}/${action}`, {
    method: "POST",
    redirect: "error",
    headers: { authorization: `Bearer ${endpoint.token}`, "content-type": "application/json" },
    body: "{}",
    signal: AbortSignal.any([signal, AbortSignal.timeout(action === "health" ? 2000 : 10000)]),
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw refused();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 8192) throw refused();
      chunks.push(next.value);
    }
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
    ) as unknown;
  } finally {
    await reader.cancel().catch(() => {});
  }
}
export const createTransmissionRemovalPorts = (): TransmissionRemovalPorts => ({
  supported: process.platform === "darwin" && process.arch === "arm64",
  runtime: resolveTransmissionRuntime,
  processes: findMacRuntimeProcesses,
  family: macRuntimeProcessFamily,
  holders: macFileProcesses,
  exited: waitForRuntimeExit,
  request: nativeRequest,
});

/** Inspect the pinned engine schema with read-only SQLite; never import its restart-capable Engine. */
async function inspectHistory(root: string, records: readonly WorkflowRecord[]) {
  const path = join(root, "workflows.sqlite");
  const before = await verifyPrivatePath(path, false);
  if (before.size > 2n * 1024n ** 3n) throw refused();
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout=2000; PRAGMA query_only=ON; PRAGMA trusted_schema=OFF");
    if (db.prepare("PRAGMA user_version").get()?.user_version !== 0) throw refused();
    const table = db.prepare("SELECT type,sql FROM sqlite_master WHERE name='runs'").get();
    if (
      table?.type !== "table" ||
      typeof table.sql !== "string" ||
      !/^CREATE TABLE\s/i.test(table.sql)
    )
      throw refused();
    const columns = db.prepare("PRAGMA table_xinfo(runs)").all();
    if (
      columns.length !== 3 ||
      columns.some(
        (column, index) =>
          column.name !== ["id", "caller_key", "body"][index] ||
          column.type !== "TEXT" ||
          column.hidden !== 0,
      )
    )
      throw refused();
    const events = db.prepare("PRAGMA table_xinfo(events)").all();
    if (
      events.length !== 5 ||
      events.some(
        (column, index) =>
          column.name !== ["sequence", "run", "time", "kind", "detail"][index] ||
          column.type !== (index === 0 ? "INTEGER" : "TEXT") ||
          column.hidden !== 0,
      )
    )
      throw refused();
    const rows = db
      .prepare("SELECT id,caller_key,length(CAST(body AS BLOB)) AS bytes FROM runs LIMIT 201")
      .all();
    const expected = new Map(
      records
        .filter((record) => record.state !== "preparation_failed")
        .map((record) => [record.key, record]),
    );
    if (rows.length !== expected.size || rows.length > 200) throw refused();
    const seen = new Set<string>();
    let bytes = 0;
    const inspect = db.prepare(
      "SELECT json_extract(body,'$.id') AS body_id,json_extract(body,'$.status') AS status,json_extract(body,'$.plan.idempotencyKey') AS start_key FROM runs WHERE id=?",
    );
    for (const row of rows) {
      bytes += Number(row.bytes);
      if (
        !uuid(row.id) ||
        !uuid(row.caller_key) ||
        !Number.isSafeInteger(Number(row.bytes)) ||
        Number(row.bytes) < 1 ||
        bytes > 64 * 1024 ** 2 ||
        seen.has(row.caller_key)
      )
        throw refused();
      seen.add(row.caller_key);
      const record = expected.get(row.caller_key);
      const data = inspect.get(row.id);
      if (
        !record ||
        record.stopPending ||
        record.state !== "submitted" ||
        !terminal(record.snapshot?.status) ||
        record.snapshot?.runId !== row.id ||
        data?.body_id !== row.id ||
        data.start_key !== row.caller_key ||
        !terminal(data.status) ||
        data.status !== record.snapshot.status
      )
        throw refused();
    }
    const after = await verifyPrivatePath(path, false);
    if (after.dev !== before.dev || after.ino !== before.ino || after.ctimeNs !== before.ctimeNs)
      throw refused();
  } finally {
    db.close();
  }
}
async function engineFiles(root: string) {
  const paths: string[] = [];
  for (const name of [
    "owner.sqlite",
    "workflows.sqlite",
    "workflows.sqlite-wal",
    "workflows.sqlite-shm",
  ]) {
    const path = join(root, name);
    const exists = await lstat(path).catch((error: unknown) => {
      if (fileCode(error) !== "ENOENT") throw error;
      return null;
    });
    if (exists) {
      await verifyPrivatePath(path, false);
      paths.push(path);
    } else if (name === "owner.sqlite" || name === "workflows.sqlite") throw refused();
  }
  return paths;
}
async function endpointSnapshot(root: string) {
  const saved = await installationSnapshot(join(root, "endpoint.json"), 4096, true);
  if (!saved) return null;
  const value = object(JSON.parse(saved.text));
  if (
    Object.keys(value).sort().join(",") !== "port,token" ||
    !Number.isInteger(value.port) ||
    Number(value.port) < 1 ||
    Number(value.port) > 65535 ||
    typeof value.token !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.token)
  )
    throw refused();
  return { endpoint: { port: Number(value.port), token: value.token }, identity: saved.identity };
}

export async function prepareTransmissionRemoval(
  root: string,
  environment: Readonly<NodeJS.ProcessEnv>,
  records: readonly WorkflowRecord[],
  signal: AbortSignal,
  ports: TransmissionRemovalPorts = createTransmissionRemovalPorts(),
): Promise<PreparedEngineRemoval[]> {
  signal.throwIfAborted();
  const prepared: PreparedEngineRemoval[] = [];
  const rootExists = await lstat(root).catch((error: unknown) => {
    if (fileCode(error) !== "ENOENT") throw error;
    return null;
  });
  if (rootExists) {
    await installationDirectory(root, false, true);
    const known = new Set([
      `transmission-${LEGACY_TRANSMISSION_VERSION}`,
      `transmission-${TRANSMISSION_VERSION}`,
    ]);
    if ((await readdir(root)).some((name) => name.startsWith("transmission-") && !known.has(name)))
      throw refused();
  }
  for (const version of [LEGACY_TRANSMISSION_VERSION, TRANSMISSION_VERSION] as const) {
    const state = join(root, `transmission-${version}`);
    const relevant = records.filter(
      (record) => (record.engineVersion ?? LEGACY_TRANSMISSION_VERSION) === version,
    );
    const exists = await lstat(state).catch((error: unknown) => {
      if (fileCode(error) !== "ENOENT") throw error;
      return null;
    });
    if (!exists) {
      if (relevant.some((record) => record.state !== "preparation_failed")) throw refused();
      continue;
    }
    if (!ports.supported)
      throw Error(
        "Native engine state cannot be verified on this platform; preserve it and use its supported macOS environment before uninstalling",
      );
    try {
      await installationDirectory(state, false, true);
      const runtime = await ports.runtime({ ...environment }, version, signal);
      const command = [runtime.node, runtime.entry, "engine"];
      const inspect = async (inspectionSignal: AbortSignal) => {
        inspectionSignal.throwIfAborted();
        const current = await ports.runtime({ ...environment }, version, inspectionSignal);
        if (current.node !== runtime.node || current.entry !== runtime.entry) throw refused();
        const files = await engineFiles(state);
        await inspectHistory(state, relevant);
        const endpoint = await endpointSnapshot(state);
        const processes = await ports.processes(command, inspectionSignal);
        const holders = await ports.holders(files, inspectionSignal);
        if (!endpoint) {
          if (processes.length || holders.length) throw refused();
          return { endpoint: null, owner: null };
        }
        const health = object(await ports.request(endpoint.endpoint, "health", inspectionSignal));
        if (
          Object.keys(health).sort().join(",") !== "pid,ready" ||
          health.ready !== true ||
          !Number.isInteger(health.pid) ||
          Number(health.pid) < 1 ||
          Number(health.pid) > 2 ** 31 - 1 ||
          processes.length !== 1 ||
          processes[0]?.pid !== health.pid ||
          holders.some((pid) => pid !== health.pid)
        )
          throw refused();
        return { endpoint, owner: processes[0] ?? null };
      };
      const original = await inspect(signal);
      const pids = original.owner ? await ports.family(original.owner, signal) : [];
      prepared.push({
        version,
        pids,
        stop: async (stopSignal) => {
          const combined = AbortSignal.any([signal, stopSignal]);
          try {
            combined.throwIfAborted();
            const next = await inspect(combined);
            if (!next.owner && !next.endpoint) {
              await ports.exited(pids, combined);
              return;
            }
            if (
              !original.owner ||
              !original.endpoint ||
              !next.owner ||
              !next.endpoint ||
              JSON.stringify(next.owner) !== JSON.stringify(original.owner) ||
              JSON.stringify(next.endpoint.identity) !== JSON.stringify(original.endpoint.identity)
            )
              throw refused();
            const family = [...new Set([...pids, ...(await ports.family(next.owner, combined))])];
            pids.splice(0, pids.length, ...family);
            const reply = object(await ports.request(original.endpoint.endpoint, "stop", combined));
            if (Object.keys(reply).join(",") !== "stopping" || reply.stopping !== true)
              throw refused();
            await ports.exited(family, combined);
            if (
              (await ports.processes(command, combined)).length ||
              (await ports.holders(await engineFiles(state), combined)).length ||
              (await endpointSnapshot(state))
            )
              throw refused();
            await inspectHistory(state, relevant);
          } catch {
            combined.throwIfAborted();
            throw refused();
          }
        },
      });
    } catch {
      signal.throwIfAborted();
      throw refused();
    }
  }
  return prepared;
}
