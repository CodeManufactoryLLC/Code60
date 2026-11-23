import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { withDevelopmentPorts } from "../scripts/devcontainer-ports.mjs";

const directories = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const common = await realpath(await mkdtemp(join(tmpdir(), "code60 port registry ")));
  directories.push(common);
  return common;
}
const free = { available: async () => true };
const identity = (pair) => pair;

it("serializes colliding allocations and keeps each origin stable across preparation", async () => {
  const common = await fixture();
  const roots = Array.from({ length: 6 }, (_, index) => ({
    root: join(common, `worktree ${index}`),
    id: index.toString(16).padStart(16, "0"),
  }));
  const pairs = await Promise.all(
    roots.map(({ root, id }) => withDevelopmentPorts(root, common, id, identity, free)),
  );
  expect(new Set(pairs.flatMap((pair) => [pair.gateway, pair.vite])).size).toBe(12);
  for (const [index, { root, id }] of roots.entries())
    expect(await withDevelopmentPorts(root, common, id, identity, free)).toEqual(pairs[index]);
});

it("skips occupied new pairs but refuses to remap an occupied saved origin", async () => {
  const common = await fixture();
  const root = join(common, "worktree");
  const id = "0000000000000000";
  const pair = await withDevelopmentPorts(root, common, id, identity, {
    available: async (port) => port !== 40001,
  });
  expect(pair).toEqual({ root, gateway: 40002, vite: 40003 });
  const file = join(common, "code60-devcontainers/ports.json");
  const before = await readFile(file, "utf8");
  await expect(
    withDevelopmentPorts(root, common, id, identity, { available: async () => false }),
  ).rejects.toThrow("40002 is occupied");
  expect(await readFile(file, "utf8")).toBe(before);
});

it("detects a real loopback listener on a saved port", async () => {
  const common = await fixture();
  const root = join(common, "worktree");
  const id = "0000000000000000";
  const pair = await withDevelopmentPorts(root, common, id, identity);
  const server = createServer();
  await new Promise((ready, reject) => {
    server.once("error", reject);
    server.listen(pair.vite, "127.0.0.1", ready);
  });
  try {
    await expect(withDevelopmentPorts(root, common, id, identity)).rejects.toThrow(
      `${pair.vite} is occupied`,
    );
  } finally {
    await new Promise((ready) => server.close(ready));
  }
});

it("releases its lock after failed preparation without forgetting reservations", async () => {
  const common = await fixture();
  const root = join(common, "worktree");
  const id = "0000000000000000";
  await expect(
    withDevelopmentPorts(
      root,
      common,
      id,
      () => {
        throw new Error("fixture failure");
      },
      free,
    ),
  ).rejects.toThrow("fixture failure");
  expect(await withDevelopmentPorts(root, common, id, identity, free)).toMatchObject({
    gateway: 40000,
  });
});

it("bounds lock contention and never removes another preparation's lock", async () => {
  const common = await fixture();
  const lock = join(common, "code60-devcontainers/prepare.lock");
  await mkdir(lock, { recursive: true });
  await writeFile(join(lock, "owner"), "preserve");
  await expect(
    withDevelopmentPorts(common, common, "0000000000000000", identity, { ...free, lockTimeout: 1 }),
  ).rejects.toThrow("preparation is locked");
  expect(await readFile(join(lock, "owner"), "utf8")).toBe("preserve");
});

it("preserves corrupt allocation metadata and rejects redirected registries", async () => {
  const common = await fixture();
  const directory = join(common, "code60-devcontainers");
  await mkdir(directory);
  const file = join(directory, "ports.json");
  await writeFile(file, "corrupt fixture");
  await expect(
    withDevelopmentPorts(common, common, "0000000000000000", identity, free),
  ).rejects.toThrow("preserve it for inspection");
  expect(await readFile(file, "utf8")).toBe("corrupt fixture");
  await rm(directory, { recursive: true });
  const target = join(common, "elsewhere");
  await mkdir(target);
  await symlink(target, directory);
  await expect(
    withDevelopmentPorts(common, common, "0000000000000000", identity, free),
  ).rejects.toThrow("symlink-redirected");
});
