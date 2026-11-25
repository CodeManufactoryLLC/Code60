import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  captureRemovalServiceProof,
  type inspectUserService,
  installationSnapshot,
  lockPrivateState,
  privateDirectory,
  type RemovalServiceProof,
  reserveRemovedBackend,
  validateRemovalServiceProof,
  writePrivateJson,
} from "./index.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture(saved = true) {
  const home = await realpath(await mkdtemp(join(tmpdir(), "code60 removed service ' ")));
  roots.push(home);
  const root = join(home, "state/code60/gateway");
  await privateDirectory(root);
  const runtime = {
    executable: await realpath(process.execPath),
    args: [join(home, "application/dist/gateway/main.js")],
    env: { HOME: home },
  };
  const path = join(root, "registration.json");
  if (saved)
    await writePrivateJson(
      path,
      { version: 1, installed: false, runtime, appVersion: "1.0.0" },
      undefined,
      16384,
    );
  const inspect = vi.fn<typeof inspectUserService>(async () => ({
    state: "stopped",
    definitionPresent: false,
    loaded: false,
  }));
  const exited = vi.fn(async (_pids: readonly number[]) => {});
  const ports = { inspect, exited };
  const proof = await captureRemovalServiceProof(home, root, runtime, [123, 124], ports);
  return { home, root, runtime, path, ports, proof };
}
it.each([true, false])(
  "captures original registration identity (saved=%s), holds the compatible lock and verifies absence repeatedly",
  async (saved) => {
    const f = await fixture(saved);
    expect(f.proof.registration).toEqual(
      (await installationSnapshot(f.path, 16384, true))?.identity ?? null,
    );
    const held = await reserveRemovedBackend(f.proof, undefined, f.ports);
    await expect(lockPrivateState(f.root, { reclaimStale: false })).rejects.toThrow(
      "No lock was reclaimed",
    );
    await expect(
      lockPrivateState(join(f.root, "registration-operation"), { reclaimStale: false }),
    ).rejects.toThrow("No lock was reclaimed");
    await held.verify();
    await held.release();
    await held.release();
    expect(f.ports.exited).toHaveBeenCalledWith([123, 124], undefined);
    expect(f.ports.inspect.mock.calls.length).toBe(3);
  },
);
it("refuses an existing foreground backend writer and releases only its own service-operation lock", async () => {
  const f = await fixture();
  const foreground = await lockPrivateState(f.root, { reclaimStale: false });
  const before = await readFile(f.path);
  try {
    await expect(reserveRemovedBackend(f.proof, undefined, f.ports)).rejects.toThrow(
      "No lock was reclaimed",
    );
    expect(f.ports.inspect).toHaveBeenCalledTimes(1);
    expect(await readFile(f.path)).toEqual(before);
    const operation = await lockPrivateState(join(f.root, "registration-operation"), {
      reclaimStale: false,
    });
    await operation();
    await expect(lockPrivateState(f.root, { reclaimStale: false })).rejects.toThrow(
      "No lock was reclaimed",
    );
  } finally {
    await foreground();
  }
});
it.each(["running", "unavailable", "definition", "loaded", "stopped-pid"] as const)(
  "refuses uncertain native %s without removing metadata",
  async (fault) => {
    const f = await fixture();
    const before = await readFile(f.path);
    f.ports.inspect.mockResolvedValue({
      state: fault === "running" ? "running" : fault === "unavailable" ? "unavailable" : "stopped",
      definitionPresent: fault === "definition",
      loaded: fault === "loaded",
      ...(fault === "stopped-pid" ? { pid: 999 } : {}),
    });
    await expect(reserveRemovedBackend(f.proof, undefined, f.ports)).rejects.toThrow(
      "absence is uncertain",
    );
    expect(await readFile(f.path)).toEqual(before);
    const release = await lockPrivateState(join(f.root, "registration-operation"), {
      reclaimStale: false,
    });
    await release();
  },
);
it("refuses a registration enrolled or replaced after inspection, including changes while holding the lock", async () => {
  const f = await fixture();
  const held = await reserveRemovedBackend(f.proof, undefined, f.ports);
  try {
    await writeFile(f.path, JSON.stringify({ version: 1, installed: true, runtime: f.runtime }), {
      mode: 0o600,
    });
    await expect(held.verify()).rejects.toThrow("registration changed");
  } finally {
    await held.release();
  }
  await expect(reserveRemovedBackend(f.proof, undefined, f.ports)).rejects.toThrow(
    "registration changed",
  );
  expect(JSON.parse(await readFile(f.path, "utf8")).installed).toBe(true);
});
it.each(["installed", "runtime", "partial", "json", "permissions", "link"] as const)(
  "refuses damaged %s receipt data without adopting it",
  async (fault) => {
    const f = await fixture();
    if (fault === "installed" || fault === "runtime" || fault === "partial")
      await writeFile(
        f.path,
        JSON.stringify({
          version: 1,
          installed: fault === "installed",
          runtime: fault === "runtime" ? { ...f.runtime, args: ["/outside/main.js"] } : f.runtime,
          ...(fault === "partial" ? { previous: {} } : {}),
        }),
      );
    if (fault === "json") await writeFile(f.path, "damaged private fixture");
    if (fault === "permissions") await chmod(f.path, 0o644);
    if (fault === "link") {
      await rm(f.path);
      await symlink(join(f.home, "outside"), f.path);
    }
    await expect(
      captureRemovalServiceProof(f.home, f.root, f.runtime, [], f.ports),
    ).rejects.toThrow();
    expect((await lstat(f.path)).isSymbolicLink()).toBe(fault === "link");
  },
);
it("preserves uncertain operation locks and verifies cancellation and leaked-PID failures", async () => {
  const f = await fixture();
  const lock = join(f.root, "registration-operation/.writer");
  await mkdir(lock, { recursive: true, mode: 0o700 });
  await writeFile(join(lock, "outside"), "retained", { mode: 0o600 });
  await expect(reserveRemovedBackend(f.proof, undefined, f.ports)).rejects.toThrow(
    "No lock was reclaimed",
  );
  expect(await readFile(join(lock, "outside"), "utf8")).toBe("retained");
  await rm(lock, { recursive: true });
  await expect(
    reserveRemovedBackend(f.proof, AbortSignal.abort(Error("cancelled")), f.ports),
  ).rejects.toThrow("cancelled");
  f.ports.exited.mockRejectedValue(Error("Recorded process remains"));
  await expect(reserveRemovedBackend(f.proof, undefined, f.ports)).rejects.toThrow(
    "process remains",
  );
  expect(JSON.parse(await readFile(f.path, "utf8")).installed).toBe(false);
});
it.each([
  { root: "/outside" },
  { home: "relative" },
  { pids: [0] },
  { pids: [123, 123] },
  { registration: { dev: 1, ino: "1", mode: 0o600, size: 1, hash: "a".repeat(64) } },
] as const)("rejects unsafe proof fields %j before acquiring an operation lock", async (patch) => {
  const f = await fixture();
  expect(() =>
    validateRemovalServiceProof({ ...f.proof, ...patch } as unknown as RemovalServiceProof),
  ).toThrow();
});
