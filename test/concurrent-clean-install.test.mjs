import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { runConcurrentCleanInstall } from "../scripts/test-concurrent-clean-install.mjs";

const roots = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "code60 concurrent ' spaces "));
  roots.push(root);
  const state = [{}, {}];
  let count = 0;
  const install = async (_root, args, { signal, write }) => {
    const index = count++;
    const current = state[index];
    const metadata = {
      id: `owned-${index}`,
      output: join(root, `evidence-${index}`),
      runtimeContainer: { name: `runtime-${index}`, identity: `identity-${index}` },
    };
    Object.assign(current, metadata, { started: true });
    try {
      expect(args).toEqual(["--uninstall", "payload with spaces.json"]);
      signal.throwIfAborted();
      await write("Clean installation: start", metadata);
      if (current.fail) throw Error("Expected acceptance failure");
      if (!current.skipCheckpoint)
        await write(
          index === 0
            ? "Clean installation: missing renderer/model detection"
            : "Clean installation: backend/provider/helper process shutdown",
          metadata,
        );
      signal.throwIfAborted();
      current.released = true;
      return { ...metadata, status: "passed", cleanup: { verified: true } };
    } finally {
      // Await this independent cleanup even when its peer/observer fails.
      await Promise.resolve();
      current.cleaned = true;
    }
  };
  const observe = async (first, second, signal) => {
    signal.throwIfAborted();
    expect(first.id).not.toBe(second.id);
    expect(state[0]).toMatchObject({ cleaned: true, released: true });
    expect(state[1].cleaned).toBeUndefined();
    expect(state[1].released).toBeUndefined();
    return { removed: first.id, survivor: second.id, assetsResponsive: true };
  };
  const run = (ports = {}) =>
    runConcurrentCleanInstall(root, ["--uninstall", "payload with spaces.json"], {
      install,
      observe,
      write: () => {},
      ...ports,
    });
  const summaries = async () => {
    const base = join(root, "test-results/clean-install-concurrent");
    return Promise.all(
      (await readdir(base)).map(async (name) =>
        JSON.parse(await readFile(join(base, name, "summary.json"), "utf8")),
      ),
    );
  };
  return { root, state, run, summaries };
}

it("holds the second full journey live until the first's cleanup and independent probe finish", async () => {
  const f = await fixture();
  const result = await f.run();
  expect(result.isolation).toMatchObject({
    removed: "owned-0",
    survivor: "owned-1",
    assetsResponsive: true,
  });
  expect(f.state.every((item) => item.cleaned && item.released)).toBe(true);
  expect(await f.summaries()).toEqual([
    expect.objectContaining({
      status: "passed",
      runs: [0, 1].map((index) => ({
        id: `owned-${index}`,
        evidence: join(f.root, `evidence-${index}`),
        cleanup: { verified: true },
      })),
    }),
  ]);
});

it.each([0, 1])(
  "cancels the peer and waits for both cleanups after run %i fails",
  async (index) => {
    const f = await fixture();
    f.state[index].fail = true;
    await expect(f.run()).rejects.toThrow("Concurrent acceptance failed. Evidence:");
    expect(f.state.every((item) => item.cleaned)).toBe(true);
    expect(await f.summaries()).toEqual([expect.objectContaining({ status: "failed" })]);
  },
);

it("releases both gates when the survivor misses its checkpoint or observation fails", async () => {
  for (const skip of [true, false]) {
    const f = await fixture();
    f.state[1].skipCheckpoint = skip;
    await expect(
      f.run({
        observe: async () => {
          throw Object.assign(Error("Inventory changed"), {
            observation: { remaining: ["owned-resource"] },
          });
        },
      }),
    ).rejects.toThrow("Concurrent acceptance failed. Evidence:");
    expect(f.state.every((item) => item.cleaned)).toBe(true);
    expect((await f.summaries())[0]).toMatchObject({
      status: "failed",
      isolation: skip ? null : { remaining: ["owned-resource"] },
    });
  }
});

it("cancels a held survivor and records both evidence locations after cleanup", async () => {
  const f = await fixture();
  const controller = new AbortController();
  await expect(
    f.run({
      signal: controller.signal,
      observe: async () => {
        controller.abort();
        controller.signal.throwIfAborted();
      },
    }),
  ).rejects.toThrow("Concurrent acceptance failed. Evidence:");
  expect(f.state.every((item) => item.cleaned)).toBe(true);
  expect((await f.summaries())[0].runs).toEqual([
    expect.objectContaining({ id: "owned-0", evidence: join(f.root, "evidence-0") }),
    { failed: true, id: "owned-1", evidence: join(f.root, "evidence-1") },
  ]);
});

it("validates arguments before starting Docker and observes synchronous integration failures", async () => {
  const f = await fixture();
  for (const args of [
    [],
    ["--uninstall"],
    ["--setup", "x"],
    ["--uninstall", "--bad"],
    ["--uninstall", "x", "extra"],
  ])
    await expect(runConcurrentCleanInstall(f.root, args)).rejects.toThrow(
      "Use npm run test:packaged:concurrent",
    );
  expect(f.state.every((item) => !item.started)).toBe(true);
  await expect(
    f.run({
      install: () => {
        throw Error("Synchronous failure");
      },
    }),
  ).rejects.toThrow("Concurrent acceptance failed. Evidence:");
  expect((await f.summaries())[0]).toMatchObject({
    status: "failed",
    runs: [{ failed: true }, { failed: true }],
  });
});

it("rejects a cancelled start and a peer reusing the first run's identity", async () => {
  const cancelled = await fixture();
  await expect(cancelled.run({ signal: AbortSignal.abort() })).rejects.toThrow(
    "Concurrent acceptance failed. Evidence:",
  );
  expect(cancelled.state.every((item) => item.cleaned)).toBe(true);
  const f = await fixture();
  await expect(
    f.run({
      write: (_line, metadata) => {
        if (metadata?.id === "owned-1") metadata.id = "owned-0";
      },
    }),
  ).rejects.toThrow("Concurrent acceptance failed. Evidence:");
  expect(f.state.every((item) => item.cleaned)).toBe(true);
});
