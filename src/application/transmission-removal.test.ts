import { randomUUID } from "node:crypto";
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import {
  LEGACY_TRANSMISSION_VERSION,
  TRANSMISSION_VERSION,
  type WorkflowRecord,
} from "../bridge/index.js";
import {
  createTransmissionRemovalPorts,
  prepareTransmissionRemoval,
} from "./transmission-removal.js";

const roots: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture(
  versions = [TRANSMISSION_VERSION] as readonly (
    | typeof TRANSMISSION_VERSION
    | typeof LEGACY_TRANSMISSION_VERSION
  )[],
) {
  const home = await realpath(await mkdtemp(join(tmpdir(), "code60 engine removal ' ")));
  roots.push(home);
  const root = join(home, "workflows");
  await mkdir(root, { mode: 0o700 });
  const records: WorkflowRecord[] = [];
  const engines = new Map<
    string,
    {
      root: string;
      pid: number;
      alive: boolean;
      calls: string[];
      health?: unknown;
      healthGate?: () => void;
      endpoint: { port: number; token: string };
    }
  >();
  for (const version of versions) {
    const state = join(root, `transmission-${version}`);
    await mkdir(state, { mode: 0o700 });
    await writeFile(join(state, "owner.sqlite"), "", { mode: 0o600 });
    const record: WorkflowRecord = {
      id: randomUUID(),
      name: "Fixture",
      repository: join(home, "repo"),
      worktree: join(home, "worktree"),
      branch: `code60/transmission-${randomUUID()}`,
      baseline: "a".repeat(40),
      repositoryIdentity: "fixture",
      repositoryGitIdentity: "fixture",
      worktreeIdentity: "fixture",
      key: randomUUID(),
      createdAt: "2026-11-24",
      engineVersion: version,
      state: "submitted",
      definition: {
        name: "Fixture",
        tasks: [{ name: "Task", instructions: "Test", verify: "Test", checks: [] }],
        repairs: 0,
        retries: 0,
        autoApprove: false,
      },
      snapshot: {
        runId: randomUUID(),
        status: "cancelled",
        tasks: [{ index: 0, name: "Task", state: "cancelled" }],
        activeTaskIndex: null,
        eventCursor: 1,
        attempts: [],
        accepted: [],
      },
    };
    records.push(record);
    const database = new DatabaseSync(join(state, "workflows.sqlite"));
    database.exec(
      "CREATE TABLE runs(id TEXT PRIMARY KEY, caller_key TEXT UNIQUE NOT NULL, body TEXT NOT NULL); CREATE TABLE events(sequence INTEGER PRIMARY KEY, run TEXT NOT NULL, time TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL)",
    );
    database.prepare("INSERT INTO runs VALUES(?,?,?)").run(
      record.snapshot?.runId ?? "",
      record.key,
      JSON.stringify({
        id: record.snapshot?.runId,
        status: "cancelled",
        plan: { idempotencyKey: record.key },
      }),
    );
    database.close();
    await chmod(join(state, "workflows.sqlite"), 0o600);
    const engine = {
      root: state,
      pid: 100 + engines.size,
      alive: true,
      calls: [] as string[],
      endpoint: { port: 0, token: "b".repeat(64) },
    } as NonNullable<ReturnType<typeof engines.get>>;
    engines.set(version, engine);
    const server = createServer((request, response) => {
      void (async () => {
        if (
          request.method !== "POST" ||
          request.headers.authorization !== `Bearer ${engine.endpoint.token}`
        ) {
          response.writeHead(403).end();
          return;
        }
        engine.calls.push(request.url ?? "");
        if (request.url === "/health") {
          if (engine.healthGate) {
            engine.healthGate();
            return;
          }
          response.end(JSON.stringify(engine.health ?? { ready: true, pid: engine.pid }));
        } else if (request.url === "/stop") {
          engine.alive = false;
          await rm(join(state, "endpoint.json"));
          response.end('{"stopping":true}');
        } else response.writeHead(400).end();
      })().catch(() => {
        response.writeHead(500).end();
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw Error("Fixture address unavailable");
    engine.endpoint.port = address.port;
    await writeFile(join(state, "endpoint.json"), JSON.stringify(engine.endpoint), { mode: 0o600 });
  }
  const ports = {
    ...createTransmissionRemovalPorts(),
    supported: true,
    runtime: vi.fn(async (_env: NodeJS.ProcessEnv, version: string) => ({
      node: process.execPath,
      entry: join(home, `engine-${version}.js`),
    })),
    processes: vi.fn(async (command: readonly string[]) => {
      // Both pinned main.js entrypoints use the literal engine subcommand.
      expect(command[2]).toBe("engine");
      const engine = [...engines.entries()].find(
        ([version]) => command[1] === join(home, `engine-${version}.js`),
      )?.[1];
      return engine?.alive
        ? [
            {
              pid: engine.pid,
              parent: 1,
              uid: process.getuid?.() ?? -1,
              started: "fixture",
              commandHash: "a".repeat(64),
            },
          ]
        : [];
    }),
    holders: vi.fn(async (paths: readonly string[]) => {
      const engine = [...engines.values()].find((entry) =>
        paths.some((path) => path.startsWith(`${entry.root}/`)),
      );
      return engine?.alive ? [engine.pid] : [];
    }),
    family: vi.fn(async (owner: { pid: number }) => [owner.pid, owner.pid + 1000]),
    exited: vi.fn(async (_ids: readonly number[]) => {}),
    request: vi.fn(createTransmissionRemovalPorts().request),
  };
  const first = engines.values().next().value;
  if (versions.length && !first) throw Error("Fixture engine unavailable");
  return { home, root, records, ports, engines, first, signal: new AbortController().signal };
}
it("inspects both versions before any stop and preserves database bytes while stopping only verified idle owners", async () => {
  const f = await fixture([LEGACY_TRANSMISSION_VERSION, TRANSMISSION_VERSION]);
  const before = await Promise.all(
    [...f.engines.values()].map((engine) => readFile(join(engine.root, "workflows.sqlite"))),
  );
  const prepared = await prepareTransmissionRemoval(
    f.root,
    { HOME: f.home },
    f.records,
    f.signal,
    f.ports,
  );
  expect(prepared).toHaveLength(2);
  expect(
    [...f.engines.values()].every((engine) => engine.alive && !engine.calls.includes("/stop")),
  ).toBe(true);
  expect(JSON.stringify(prepared)).not.toContain("b".repeat(64));
  for (const item of prepared) {
    await item.stop(f.signal);
    await item.stop(f.signal);
  }
  expect(
    [...f.engines.values()].every(
      (engine) => !engine.alive && engine.calls.filter((call) => call === "/stop").length === 1,
    ),
  ).toBe(true);
  expect(
    await Promise.all(
      [...f.engines.values()].map((engine) => readFile(join(engine.root, "workflows.sqlite"))),
    ),
  ).toEqual(before);
  expect(f.ports.exited).toHaveBeenCalled();
});
it("does not stop the first engine if the second has active or foreign history", async () => {
  const f = await fixture([LEGACY_TRANSMISSION_VERSION, TRANSMISSION_VERSION]);
  const engine = f.engines.get(TRANSMISSION_VERSION);
  if (!engine) throw Error("Fixture second engine missing");
  const db = new DatabaseSync(join(engine.root, "workflows.sqlite"));
  db.prepare("UPDATE runs SET body=json_set(body,'$.status','running')").run();
  db.close();
  await expect(
    prepareTransmissionRemoval(f.root, { HOME: f.home }, f.records, f.signal, f.ports),
  ).rejects.toThrow("ownership or history is uncertain");
  expect([...f.engines.values()].every((item) => item.alive && !item.calls.includes("/stop"))).toBe(
    true,
  );
});
it.each(["unrelated", "empty", "corrupt", "newer", "symlink", "hardlink"])(
  "refuses unsafe native history without initializing or replacing it: %s",
  async (mode) => {
    const f = await fixture();
    const engine = f.first;
    if (!engine) throw Error("Fixture engine missing");
    const path = join(engine.root, "workflows.sqlite");
    if (["unrelated", "empty", "corrupt"].includes(mode)) {
      await rm(path);
      if (mode === "corrupt") await writeFile(path, "private fixture contents", { mode: 0o600 });
      else {
        const db = new DatabaseSync(path);
        if (mode === "unrelated") db.exec("CREATE TABLE unrelated(value TEXT)");
        db.close();
        await chmod(path, 0o600);
      }
    }
    if (mode === "newer") {
      const db = new DatabaseSync(path);
      db.exec("PRAGMA user_version=1");
      db.close();
    }
    if (mode === "symlink") {
      await rename(path, join(f.home, "original.sqlite"));
      await symlink(join(f.home, "original.sqlite"), path);
    }
    if (mode === "hardlink") await link(path, join(f.home, "outside.sqlite"));
    const before = await readFile(path);
    await expect(
      prepareTransmissionRemoval(f.root, { HOME: f.home }, f.records, f.signal, f.ports),
    ).rejects.toThrow("ownership or history is uncertain");
    expect(await readFile(path)).toEqual(before);
    expect(engine.calls).toEqual([]);
  },
);
it("requires positive absence when an endpoint is missing and never connects a stopped engine", async () => {
  const f = await fixture();
  const engine = f.first;
  if (!engine) throw Error("Fixture engine missing");
  await rm(join(engine.root, "endpoint.json"));
  await expect(
    prepareTransmissionRemoval(f.root, { HOME: f.home }, f.records, f.signal, f.ports),
  ).rejects.toThrow("uncertain");
  engine.alive = false;
  const prepared = await prepareTransmissionRemoval(
    f.root,
    { HOME: f.home },
    f.records,
    f.signal,
    f.ports,
  );
  await prepared[0]?.stop(f.signal);
  expect(engine.calls).toEqual([]);
});
it.each(["process", "holder", "endpoint", "binding", "leak"])(
  "rechecks %s ownership before removal and preserves uncertain evidence",
  async (change) => {
    const f = await fixture();
    const engine = f.first;
    if (!engine) throw Error("Fixture engine missing");
    const [prepared] = await prepareTransmissionRemoval(
      f.root,
      { HOME: f.home },
      f.records,
      f.signal,
      f.ports,
    );
    if (!prepared) throw Error("Fixture proof missing");
    if (change === "process")
      f.ports.processes.mockResolvedValue([
        {
          pid: engine.pid,
          parent: 1,
          uid: process.getuid?.() ?? -1,
          started: "reused",
          commandHash: "a".repeat(64),
        },
      ]);
    if (change === "holder") f.ports.holders.mockResolvedValue([999]);
    if (change === "binding")
      f.ports.runtime.mockResolvedValue({ node: "/different/node", entry: "/different/entry" });
    if (change === "endpoint") {
      const path = join(engine.root, "endpoint.json");
      await rename(path, join(engine.root, "previous.json"));
      await writeFile(path, JSON.stringify(engine.endpoint), { mode: 0o600 });
    }
    if (change === "leak") f.ports.exited.mockRejectedValue(Error("private fixture leak detail"));
    await expect(prepared.stop(f.signal)).rejects.toThrow("ownership or history is uncertain");
    if (change !== "leak") expect(engine.calls).not.toContain("/stop");
    expect(await readFile(join(engine.root, "workflows.sqlite"))).toBeDefined();
  },
);
it("honors cancellation before effects and during an authenticated health request", async () => {
  const f = await fixture();
  const engine = f.first;
  if (!engine) throw Error("Fixture engine missing");
  await expect(
    prepareTransmissionRemoval(
      f.root,
      { HOME: f.home },
      f.records,
      AbortSignal.abort(Error("cancelled")),
      f.ports,
    ),
  ).rejects.toThrow("cancelled");
  expect(f.ports.runtime).not.toHaveBeenCalled();
  const abort = new AbortController();
  engine.healthGate = () => abort.abort(Error("cancelled health"));
  await expect(
    prepareTransmissionRemoval(f.root, { HOME: f.home }, f.records, abort.signal, f.ports),
  ).rejects.toThrow("cancelled health");
  expect(engine.calls).toEqual(["/health"]);
});
it("creates no state for absent engines and rejects unknown or unsupported engine directories", async () => {
  const f = await fixture([]);
  expect(
    await prepareTransmissionRemoval(f.root, { HOME: f.home }, [], f.signal, {
      ...f.ports,
      supported: false,
    }),
  ).toEqual([]);
  expect(await readdir(f.root)).toEqual([]);
  expect(f.ports.runtime).not.toHaveBeenCalled();
  await mkdir(join(f.root, `transmission-${TRANSMISSION_VERSION}`), { mode: 0o700 });
  await expect(
    prepareTransmissionRemoval(f.root, { HOME: f.home }, [], f.signal, {
      ...f.ports,
      supported: false,
    }),
  ).rejects.toThrow("cannot be verified on this platform");
  await mkdir(join(f.root, "transmission-future"), { mode: 0o700 });
  await expect(
    prepareTransmissionRemoval(f.root, { HOME: f.home }, [], f.signal, f.ports),
  ).rejects.toThrow("uncertain");
});
