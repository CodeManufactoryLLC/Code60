import { mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

async function available(port) {
  const server = createServer();
  return new Promise((ready, reject) => {
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE" || error.code === "EACCES") ready(false);
      else reject(error);
    });
    server.listen(port, "127.0.0.1", () => server.close(() => ready(true)));
  });
}

// Common Git metadata serializes allocations across linked worktrees. Retain
// reservations across down/up so browser origins and editor forwarding stay stable.
export async function withDevelopmentPorts(root, common, id, prepare, options = {}) {
  const directory = join(common, "code60-devcontainers");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await realpath(directory)) !== resolve(directory))
    throw new Error("Refusing a symlink-redirected port registry.");
  const lock = join(directory, "prepare.lock");
  const deadline = Date.now() + (options.lockTimeout ?? 5000);
  while (true) {
    options.signal?.throwIfAborted();
    try {
      await mkdir(lock);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() >= deadline)
        throw new Error(`Port preparation is locked at ${lock}; check the owning prepare process.`);
      await delay(40, undefined, { signal: options.signal });
    }
  }
  try {
    const file = join(directory, "ports.json");
    let registry = {};
    try {
      registry = JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT")
        throw new Error("Cannot read development port registry; preserve it for inspection.");
    }
    const used = new Set();
    if (!registry || typeof registry !== "object" || Array.isArray(registry))
      throw new Error("Invalid development port registry; preserve it for inspection.");
    for (const [key, entry] of Object.entries(registry)) {
      if (
        !/^[a-f0-9]{16}$/.test(key) ||
        !entry ||
        typeof entry.root !== "string" ||
        !Number.isInteger(entry.gateway) ||
        entry.gateway < 40000 ||
        entry.gateway > 59998 ||
        entry.gateway % 2 !== 0 ||
        entry.vite !== entry.gateway + 1 ||
        used.has(entry.gateway)
      )
        throw new Error("Invalid development port registry; preserve it for inspection.");
      used.add(entry.gateway);
    }
    const probe = options.available ?? available;
    let pair = registry[id];
    if (pair) {
      if (pair.root !== root) throw new Error("Development workspace identity collision.");
      for (const port of [pair.gateway, pair.vite])
        if (!(await probe(port)))
          throw new Error(
            `Development port ${port} is occupied. Stop its listener/forwarding and retry; the saved pair will not be remapped.`,
          );
    } else {
      const first = Number.parseInt(id.slice(0, 8), 16) % 10000;
      for (let offset = 0; offset < 10000; offset++) {
        const gateway = 40000 + ((first + offset) % 10000) * 2;
        if (used.has(gateway)) continue;
        if (!(await probe(gateway)) || !(await probe(gateway + 1))) continue;
        pair = { root, gateway, vite: gateway + 1 };
        break;
      }
      if (!pair) throw new Error("No free development port pairs in 40000–59999.");
      registry[id] = pair;
      const temporary = `${file}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(registry, null, 2)}\n`, {
        mode: 0o600,
        flag: "wx",
      });
      try {
        await rename(temporary, file);
      } finally {
        await rm(temporary, { force: true });
      }
    }
    return await prepare(pair);
  } finally {
    await rm(lock, { recursive: true });
  }
}
