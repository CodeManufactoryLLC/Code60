import { chmod, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CustomAgentStore } from "./custom-agent-store.js";

// The 64-definition case performs durable private writes, with native owner/ACL
// verification and atomic replacement for every definition and catalog update.
if (process.platform === "win32") vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let root: string;
let stores: CustomAgentStore[];
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "code60-custom-store-"));
  stores = [];
});
afterEach(async () => {
  await Promise.allSettled(stores.map((s) => s.close()));
  await rm(root, { recursive: true, force: true });
});
async function open() {
  // The writer lock verifies the store's parent too. On Windows, mkdtemp roots under an
  // elevated token are owned by Administrators, so use a fresh private child as that parent.
  const store = await CustomAgentStore.open(join(root, "state", "agents"));
  stores.push(store);
  return store;
}
it("shares one lock release across concurrent and repeated closes", async () => {
  const store = await open();
  const closing = store.close();
  expect(store.close()).toBe(closing);
  await closing;
  expect(store.close()).toBe(closing);
  await expect(open()).resolves.toBeInstanceOf(CustomAgentStore);
});
it("persists revision-checked definitions without instruction bodies in summaries", async () => {
  let store = await open();
  const a = await store.save({ name: "Reviewer", instructions: "Inspect changes" });
  expect(store.list()).toEqual([{ id: a.id, revision: 1, name: a.name, archived: false }]);
  await expect(store.save({ name: "stale", instructions: "x" }, a.id, 2)).rejects.toThrow(
    "changed",
  );
  await store.archive(a.id, 1, true);
  await store.close();
  store = await open();
  expect(await store.get(a.id)).toMatchObject({
    instructions: "Inspect changes",
    archived: true,
    revision: 2,
  });
  await store.archive(a.id, 2, false);
  expect(await store.get(a.id)).toMatchObject({ archived: false, revision: 3 });
  await expect(store.archive("missing", 1, true)).rejects.toThrow("unavailable");
});
it("caps the catalog at 64 definitions without losing prior agents", async () => {
  const store = await open();
  for (let i = 0; i < 64; i++) await store.save({ name: `Agent ${i}`, instructions: "x" });
  const bytes = await readFile(join(store.root, "agents.json"));
  await expect(store.save({ name: "extra", instructions: "x" })).rejects.toThrow();
  expect(await readFile(join(store.root, "agents.json"))).toEqual(bytes);
});
it("preserves corrupt catalogs and blocks simultaneous writers", async () => {
  const store = await open();
  await expect(open()).rejects.toThrow("already open");
  const path = join(store.root, "agents.json");
  await store.close();
  await writeFile(path, "{bad");
  await expect(open()).rejects.toThrow();
  expect(await readFile(path, "utf8")).toBe("{bad");
});
it("refuses to recreate missing metadata beside preserved evidence", async () => {
  const store = await open();
  await store.close();
  await unlink(join(store.root, "agents.json"));
  await writeFile(join(store.root, "preserved"), "evidence");
  await expect(open()).rejects.toThrow("missing");
});
it("rejects unsafe permissions and outside edits without overwriting them", async () => {
  const store = await open();
  const path = join(store.root, "agents.json");
  await writeFile(path, '{"outside":true}');
  await expect(store.save({ name: "A", instructions: "x" })).rejects.toThrow("changed");
  expect(await readFile(path, "utf8")).toBe('{"outside":true}');
  if (process.platform !== "win32") {
    await chmod(path, 0o644);
    await expect(store.save({ name: "A", instructions: "x" })).rejects.toThrow("permissions");
  }
});

it("reads instruction bodies lazily and preserves a damaged definition without blocking siblings", async () => {
  let store = await open();
  const a = await store.save({ name: "A", instructions: "\u0001".repeat(31_999) + "x" });
  const b = await store.save({ name: "B", instructions: "Only B" });
  const catalog = JSON.parse(await readFile(join(store.root, "agents.json"), "utf8"));
  expect(JSON.stringify(catalog)).not.toContain("instructions");
  expect((await store.get(a.id)).instructions).toHaveLength(32_000);
  const entry = catalog.agents.find((value: { id: string }) => value.id === a.id);
  const definition = join(store.root, "definitions", `${entry.definition}.json`);
  await store.close();
  await writeFile(definition, "{bad");
  store = await open();
  expect(store.list()).toHaveLength(2);
  await expect(store.get(a.id)).rejects.toThrow();
  expect((await store.get(b.id)).instructions).toBe("Only B");
  expect(await readFile(definition, "utf8")).toBe("{bad");
});
