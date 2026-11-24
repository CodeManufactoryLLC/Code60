import { createHash } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { lockInstallation } from "./installation-files.js";
import {
  inspectTransmissionBundle,
  preserveTransmissionBundle,
  resolveTransmissionRuntime,
  transmissionStorage,
  transmissionVersions,
} from "./transmission-bundle.js";

const roots: string[] = [];
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const home = await realpath(await mkdtemp(join(tmpdir(), "code60 engine ' spaces ")));
  roots.push(home);
  const root = join(home, "bundle");
  await mkdir(root, { mode: 0o700 });
  const files = [
    "package-lock.json",
    "node_modules/transmission-18/dist/src/main.js",
    "node_modules/transmission-20/dist/src/main.js",
    "node_modules/@agentclientprotocol/codex-acp/dist/index.js",
    "native/codex",
  ];
  for (const path of files) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), path, { mode: 0o600 });
  }
  await chmod(join(root, "native/codex"), 0o700);
  const lock = hash(files[0] as string);
  const metadata = {
    schema: 1,
    os: "darwin",
    arch: "arm64",
    node: ">=24.22.0 <25",
    builtWithNode: "v24.22.0",
    lockfileSha256: lock,
    engines: {
      "0.1.0-staging.18": {
        entry: files[1],
        integrity:
          "sha512-U1SLG4FZv7yYW9eMzKEVSNx6tZ85YRbGyagEfcBzedfEQkn8Qaj1SS+duXST+8WH4jFaF8XZAbp+tTTiGbhDVg==",
      },
      "0.1.0-staging.20": {
        entry: files[2],
        integrity:
          "sha512-23Y6om57UMB1pCAe+XcbH84JzFk0xo6CHJHiCfd06G5E1m1OAxY/JDI9UR43dfACAJfpWQHN+Wm67U4Lc+Xy9Q==",
      },
    },
    native: { path: "native/codex", version: "0.171.0", sha256: hash("native/codex") },
    files: files.map((path) => ({
      path,
      type: "0",
      sha256: hash(path),
      size: Buffer.byteLength(path),
    })),
  };
  const save = () =>
    writeFile(join(root, "bundle.json"), JSON.stringify(metadata), { mode: 0o600 });
  await save();
  const env = { HOME: home, XDG_DATA_HOME: join(home, "data") };
  return { home, root, env, metadata, save, lock };
}
function mac() {
  vi.stubGlobal("process", { ...process, platform: "darwin", arch: "arm64" });
}
it("inspects the two exact versions and their complete local inventory", async () => {
  const f = await fixture();
  expect((await inspectTransmissionBundle(f.root)).manifest.lockfileSha256).toBe(f.lock);
});
it("keeps version bindings and cached files independent of the source release", async () => {
  mac();
  const f = await fixture();
  await preserveTransmissionBundle(f.root, f.env);
  const storage = transmissionStorage(f.env);
  const before = await lstat(join(storage, f.lock), { bigint: true });
  await preserveTransmissionBundle(f.root, f.env);
  expect((await lstat(join(storage, f.lock), { bigint: true })).ino).toBe(before.ino);
  await rm(f.root, { recursive: true });
  for (const version of transmissionVersions) {
    const runtime = await resolveTransmissionRuntime(f.env, version);
    expect(runtime.entry).toContain(`transmission-${version.slice(-2)}/dist/src/main.js`);
    expect(runtime.root).toBe(join(storage, f.lock));
    expect(runtime.codex).toBe(join(storage, f.lock, "native/codex"));
    expect((await lstat(join(storage, `${version}.json`))).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(join(storage, `${version}.json`), "utf8")).nodeVersion).toBe(
      process.versions.node,
    );
  }
  expect(await readFile(join(storage, f.lock, "native/codex"), "utf8")).toBe("native/codex");
});
it("reports absent bindings without creating directories", async () => {
  const f = await fixture();
  await expect(resolveTransmissionRuntime(f.env, transmissionVersions[0])).rejects.toMatchObject({
    code: "CODE60_ENGINE_UNAVAILABLE",
  });
  await expect(lstat(f.env.XDG_DATA_HOME)).rejects.toMatchObject({ code: "ENOENT" });
});
it("uses the same canonical HOME as managed installation", async () => {
  mac();
  const f = await fixture();
  const alias = join(f.home, "home alias");
  await symlink(f.home, alias);
  const env = { HOME: alias };
  await preserveTransmissionBundle(f.root, env);
  const runtime = await resolveTransmissionRuntime(env, transmissionVersions[0]);
  expect(runtime.root).toBe(join(f.home, ".local/share/code60/engines", f.lock));
});
it.each(["os", "arch", "node", "schema", "lockfileSha256"])(
  "rejects altered bundle identity %s",
  async (key) => {
    const f = await fixture();
    Object.assign(f.metadata, { [key]: "invalid" });
    await f.save();
    await expect(inspectTransmissionBundle(f.root)).rejects.toThrow("identity");
  },
);
it.each(["../escape", "/absolute", "a\\b", "a//b", "a/./b", "a\u0000b", "bundle.json"])(
  "rejects unsafe inventory path %s",
  async (path) => {
    const f = await fixture();
    f.metadata.files.push({ path, type: "0", size: 1, sha256: hash("x") });
    await f.save();
    await expect(inspectTransmissionBundle(f.root)).rejects.toThrow("inventory");
  },
);
it("rejects duplicate paths and unsupported file types", async () => {
  const f = await fixture();
  f.metadata.files.push(f.metadata.files[0] as (typeof f.metadata.files)[number]);
  await f.save();
  await expect(inspectTransmissionBundle(f.root)).rejects.toThrow("inventory");
  f.metadata.files.pop();
  const first = f.metadata.files[0];
  if (!first) throw Error("Fixture inventory missing");
  first.type = "2";
  await f.save();
  await expect(inspectTransmissionBundle(f.root)).rejects.toThrow("inventory");
});
it("refuses a changed or unlisted file", async () => {
  const f = await fixture();
  await writeFile(join(f.root, "package-lock.json"), "X".repeat("package-lock.json".length));
  await expect(inspectTransmissionBundle(f.root)).rejects.toThrow("identity changed");
  await writeFile(join(f.root, "extra"), "unexpected");
  await expect(inspectTransmissionBundle(f.root)).rejects.toThrow("Unexpected");
});
it.each(["symlink", "hardlink", "writable"])("refuses unsafe %s files", async (kind) => {
  const f = await fixture();
  const file = join(f.root, "native/codex");
  if (kind === "writable") await chmod(file, 0o666);
  else {
    await rm(file);
    if (kind === "symlink") await symlink(join(f.root, "package-lock.json"), file);
    else await link(join(f.root, "package-lock.json"), file);
  }
  await expect(inspectTransmissionBundle(f.root)).rejects.toThrow();
});
it("preserves an uncertain lock and does not publish a competing bundle", async () => {
  mac();
  const f = await fixture();
  await preserveTransmissionBundle(f.root, f.env);
  const storage = transmissionStorage(f.env);
  const release = await lockInstallation(storage);
  try {
    await expect(preserveTransmissionBundle(f.root, f.env)).rejects.toThrow("busy or uncertain");
    expect(await readFile(join(storage, ".install-lock/owner.json"), "utf8")).toContain("token");
  } finally {
    await release();
  }
});
it("rejects damaged private receipts and preserves them", async () => {
  mac();
  const f = await fixture();
  await preserveTransmissionBundle(f.root, f.env);
  const path = join(transmissionStorage(f.env), `${transmissionVersions[0]}.json`);
  const receipt = JSON.parse(await readFile(path, "utf8"));
  receipt.manifestHash = "a".repeat(64);
  const damaged = JSON.stringify(receipt);
  await writeFile(path, damaged);
  await expect(resolveTransmissionRuntime(f.env, transmissionVersions[0])).rejects.toThrow(
    "binding changed",
  );
  await expect(preserveTransmissionBundle(f.root, f.env)).rejects.toThrow("binding changed");
  expect(await readFile(path, "utf8")).toBe(damaged);
});
it("cancels before writing engine storage", async () => {
  mac();
  const f = await fixture();
  await expect(preserveTransmissionBundle(f.root, f.env, AbortSignal.abort())).rejects.toThrow();
  await expect(lstat(f.env.XDG_DATA_HOME)).rejects.toMatchObject({ code: "ENOENT" });
});
it("removes an unpublished candidate on cancellation and can retry the empty store", async () => {
  mac();
  const f = await fixture();
  const abort = new AbortController();
  await expect(
    preserveTransmissionBundle(f.root, f.env, abort.signal, {
      checkpoint: async (phase) => {
        if (phase === "cached") abort.abort();
      },
    }),
  ).rejects.toThrow();
  await expect(lstat(join(transmissionStorage(f.env), f.lock))).rejects.toMatchObject({
    code: "ENOENT",
  });
  await preserveTransmissionBundle(f.root, f.env);
  expect((await resolveTransmissionRuntime(f.env, transmissionVersions[1])).entry).toContain(
    "transmission-20",
  );
});
it("retains a published binding after interruption and fills the missing binding without replacing it", async () => {
  mac();
  const f = await fixture();
  await expect(
    preserveTransmissionBundle(f.root, f.env, undefined, {
      checkpoint: async (phase) => {
        if (phase === "bound") throw Error("interrupted after first binding");
      },
    }),
  ).rejects.toThrow("interrupted");
  const path = join(transmissionStorage(f.env), `${transmissionVersions[0]}.json`);
  const before = await lstat(path, { bigint: true });
  await resolveTransmissionRuntime(f.env, transmissionVersions[0]);
  await expect(resolveTransmissionRuntime(f.env, transmissionVersions[1])).rejects.toMatchObject({
    code: "CODE60_ENGINE_UNAVAILABLE",
  });
  await preserveTransmissionBundle(f.root, f.env);
  expect((await lstat(path, { bigint: true })).ino).toBe(before.ino);
  await resolveTransmissionRuntime(f.env, transmissionVersions[1]);
});
it("reports cleanup ownership changes without removing a replacement tree", async () => {
  mac();
  const f = await fixture();
  const target = join(transmissionStorage(f.env), f.lock);
  await expect(
    preserveTransmissionBundle(f.root, f.env, undefined, {
      checkpoint: async () => {
        await rename(target, join(f.home, "retained candidate"));
        await mkdir(target, { mode: 0o700 });
        await writeFile(join(target, "unrelated"), "preserve me");
        throw Error("candidate failed");
      },
    }),
  ).rejects.toThrow("cleanup failed");
  expect(await readFile(join(target, "unrelated"), "utf8")).toBe("preserve me");
  expect((await lstat(join(f.home, "retained candidate"))).isDirectory()).toBe(true);
});
it("rejects unsafe data roots before writing", async () => {
  expect(() => transmissionStorage({ HOME: "/home/example", XDG_DATA_HOME: "relative" })).toThrow(
    "absolute",
  );
});
