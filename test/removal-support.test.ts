import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it, vi } from "vitest";
import {
  applyShellIntegration,
  finishManagedRemoval,
  installManagedRelease,
  planManagedRemoval,
  planShellIntegration,
  prepareManagedRemoval,
  readRemovalState,
} from "../src/management/index.js";
import {
  createUninstallPorts,
  runUninstall,
  type UninstallPorts,
} from "../src/management/uninstall.js";
import {
  captureRemovalServiceProof,
  privateDirectory,
  reserveRemovedBackend,
  runtimeProcessExists,
  writePrivateJson,
} from "../src/platform/index.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
async function fixture() {
  const home = await realpath(await mkdtemp(join(tmpdir(), "code60 durable removal ' ")));
  roots.push(home);
  const env = {
    HOME: home,
    XDG_STATE_HOME: join(home, "state"),
    PATH: "/usr/bin:/bin",
    SHELL: "/bin/bash",
  };
  const acquire = vi.fn(async ({ parent }: { parent: string }) => {
    const owned = await mkdtemp(join(parent, ".code60-payload-"));
    const root = join(owned, "application");
    const contents = {
      "dist/management/cli.js": "export async function runManagement(){}",
      "dist/gateway/main.js": "// synthetic inert backend entrypoint\n",
      NOTICE: "owned notice\n",
    };
    for (const [path, text] of Object.entries(contents)) {
      await mkdir(join(root, path, ".."), { recursive: true, mode: 0o700 });
      await writeFile(join(root, path), text, { mode: 0o600 });
    }
    await writeFile(
      join(root, "payload.json"),
      JSON.stringify({
        schemaVersion: 1,
        version: "1.0.0",
        os: process.platform,
        arch: process.arch,
        files: Object.entries(contents).map(([path, text]) => ({
          path,
          type: "0",
          size: Buffer.byteLength(text),
          sha256: hash(text),
        })),
      }),
      { mode: 0o600 },
    );
    return { root, owned };
  });
  const artifact = {
    identity: {
      version: "1.0.0",
      os: process.platform,
      arch: process.arch,
      archive: { sha256: "a".repeat(64) },
    },
    acquire,
  };
  const runtimeDirectory = join(home, "temporary bootstrap cache");
  await cp(resolve("build/distribution"), runtimeDirectory, { recursive: true });
  const install = (repair = false) =>
    installManagedRelease({
      artifact,
      env,
      repair,
      runtimeDirectory: resolve("build/distribution"),
    });
  const installed = await install();
  const plan = await planManagedRemoval(env);
  if (!plan) throw Error("Missing fixture removal plan");
  const serviceRoot = join(env.XDG_STATE_HOME, "code60/gateway");
  await privateDirectory(serviceRoot);
  const runtime = {
    executable: await realpath(process.execPath),
    args: [join(installed.release, "dist/gateway/main.js")],
    env: { HOME: home },
  };
  await writePrivateJson(
    join(serviceRoot, "registration.json"),
    { version: 1, installed: false, appVersion: "1.0.0", runtime },
    undefined,
    16384,
  );
  const ports = {
    inspect: vi.fn(async () => ({
      state: "stopped" as const,
      definitionPresent: false,
      loaded: false,
    })),
    exited: vi.fn(async () => {}),
  };
  const proof = await captureRemovalServiceProof(home, serviceRoot, runtime, [], ports);
  const reserve: typeof reserveRemovedBackend = (value, signal) =>
    reserveRemovedBackend(value, signal, ports);
  const data = join(installed.root, "databases/default.sqlite");
  await mkdir(join(data, ".."), { mode: 0o700 });
  await writeFile(data, "synthetic retained database bytes", { mode: 0o600 });
  const preferences = join(home, "state/code60/desktop.json");
  await writeFile(preferences, JSON.stringify({ database: data, unrelated: "retain me" }), {
    mode: 0o600,
  });
  const prepare = () => prepareManagedRemoval(plan, proof, { runtimeDirectory });
  return {
    ...installed,
    home,
    env,
    plan,
    data,
    preferences,
    proof,
    ports,
    reserve,
    install,
    acquire,
    runtimeDirectory,
    prepare,
  };
}
async function retained(f: Awaited<ReturnType<typeof fixture>>) {
  expect(await readFile(f.data, "utf8")).toBe("synthetic retained database bytes");
  expect(JSON.parse(await readFile(f.preferences, "utf8"))).toEqual({
    database: f.data,
    unrelated: "retain me",
  });
  expect((await lstat(join(f.root, "installation.json"))).mode & 0o777).toBe(0o600);
  expect(await readdir(f.root)).not.toContain(".install-lock");
  expect(await readdir(f.root)).not.toContain(".setup-lock");
}

function uninstallPorts(f: Awaited<ReturnType<typeof fixture>>) {
  return {
    ...createUninstallPorts(f.env),
    verifyNative: vi.fn(async () => {}),
    interactive: false as boolean,
    write: vi.fn((_message: string) => {}),
    confirm: vi.fn(async (_message: string, _signal: AbortSignal) => false),
    status: vi.fn(async () => ({
      installed: false,
      nativeState: "stopped",
      runtimeCurrent: true,
      service: null as Record<string, unknown> | null,
    })),
    summary: vi.fn(async () => ({
      pid: 42,
      interactiveActive: false,
      scheduledActive: false,
      schedulerAvailable: true,
      scheduledUncertain: false,
      workflows: { completed: 0, active: 0, uncertain: 0 },
    })),
    prepare: vi.fn(async () => ({ quiescent: true, pid: 42, enginePids: [43] })),
    remove: vi.fn(async (_guard: Parameters<UninstallPorts["remove"]>[0]) =>
      structuredClone(f.proof),
    ),
    reserve: f.reserve,
    runtimeDirectory: resolve("build/distribution"),
  } satisfies UninstallPorts;
}

async function inspectionTools(home: string, gated = false) {
  const bin = join(home, "test-only-inspection");
  await mkdir(bin, { mode: 0o700 });
  const log = join(bin, "calls.jsonl"),
    proceed = join(bin, "proceed");
  const script = `#!/usr/bin/env node
import {appendFileSync,existsSync} from 'node:fs';
import {basename} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
const args=process.argv.slice(2), name=basename(process.argv[1]);
appendFileSync(${JSON.stringify(log)},JSON.stringify({name,args,pid:process.pid,parent:process.ppid})+'\\n',{mode:0o600});
${gated ? `const until=Date.now()+3000;while(!existsSync(${JSON.stringify(proceed)})){if(Date.now()>until)throw Error('Fixture gate expired');await delay(10);}` : ""}
if(name==='launchctl'&&JSON.stringify(args)===JSON.stringify(['print','gui/'+process.getuid()+'/com.codemanufactory.code60.backend']))process.exitCode=1;
else if(name==='launchctl'&&JSON.stringify(args)===JSON.stringify(['print','gui/'+process.getuid()]))process.stdout.write('services = {\\n}\\n');
else if(name==='systemctl'&&JSON.stringify(args)===JSON.stringify(['--user','show','code60-backend.service','--property=LoadState','--property=ActiveState','--property=MainPID']))process.stdout.write('LoadState=not-found\\nActiveState=inactive\\nMainPID=0\\n');
else throw Error('Fixture refuses unexpected native inspection or mutation');
`;
  await writeFile(join(bin, "inspect.mjs"), script, { mode: 0o700 });
  for (const name of ["launchctl", "systemctl"]) await symlink("inspect.mjs", join(bin, name));
  return {
    log,
    proceed,
    env: {
      HOME: join(home, "unrelated-home"),
      XDG_STATE_HOME: join(home, "unrelated-state"),
      XDG_DATA_HOME: join(home, "unrelated-data"),
      PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
    },
    calls: async () =>
      (await readFile(log, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { pid: number; args: string[]; name: string }),
  };
}
it("publishes and validates durable receipts exceeding the ordinary profile size bound", async () => {
  const f = await fixture();
  f.plan.residuals = Array.from({ length: 400 }, (_, index) =>
    join(f.root, "unowned", String(index), "x".repeat(3000)),
  );
  const state = await f.prepare();
  expect((await lstat(join(state.directory, "receipt.json"))).size).toBeGreaterThan(1024 ** 2);
  expect((await readRemovalState(f.plan.record))?.receipt.residuals).toEqual(f.plan.residuals);
  await finishManagedRemoval(f.plan.record, { reserve: f.reserve });
  expect((await readRemovalState(f.plan.record))?.value.phase).toBe("complete");
  await retained(f);
});

it("publishes private standalone support, removes only receipted app files and repeats without touching retained state", async () => {
  const f = await fixture();
  const state = await f.prepare();
  expect(state.value.phase).toBe("prepared");
  expect((await lstat(join(state.directory, "receipt.json"))).mode & 0o777).toBe(0o600);
  await rm(f.runtimeDirectory, { recursive: true });
  const result = await finishManagedRemoval(f.plan.record, { reserve: f.reserve });
  expect(result).toEqual({
    removed: true,
    residuals: [],
    recovery: join(state.directory, "code60"),
  });
  for (const path of [
    f.release,
    f.launcher,
    join(f.root, "current"),
    ...f.plan.activations.map((item) => item.root),
  ])
    await expect(lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
  expect((await readRemovalState(f.plan.record))?.value.phase).toBe("complete");
  expect(await finishManagedRemoval(f.plan.record, { reserve: f.reserve })).toEqual(result);
  await retained(f);
});
it("resumes after entrypoint deletion using only durable support and the recorded remainder", async () => {
  const f = await fixture();
  const state = await f.prepare();
  await rm(f.runtimeDirectory, { recursive: true });
  await expect(
    finishManagedRemoval(f.plan.record, {
      reserve: f.reserve,
      checkpoint: async (path) => {
        if (path === "NOTICE") throw Error("intentional interrupted cleanup");
      },
    }),
  ).rejects.toThrow("interrupted cleanup");
  expect((await readRemovalState(f.plan.record))?.value.phase).toBe("removing");
  await expect(lstat(join(f.release, "dist/management/cli.js"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect((await lstat(join(state.directory, "code60"))).isFile()).toBe(true);
  await expect(f.install()).rejects.toThrow("Uninstall needs recovery");
  expect(await finishManagedRemoval(f.plan.record, { reserve: f.reserve })).toMatchObject({
    removed: true,
  });
  await retained(f);
});

it("runs the actual durable launcher after partial entrypoint/cache deletion from another directory and environment", async () => {
  const f = await fixture();
  const state = await f.prepare();
  const tools = await inspectionTools(f.home);
  await mkdir(tools.env.HOME, { mode: 0o700 });
  await mkdir(tools.env.XDG_STATE_HOME, { mode: 0o700 });
  const unrelated = join(tools.env.XDG_STATE_HOME, "foreign.json");
  await writeFile(unrelated, "unrelated state must remain", { mode: 0o600 });
  await expect(
    finishManagedRemoval(f.plan.record, {
      reserve: f.reserve,
      checkpoint: async (path) => {
        if (path === "NOTICE") throw Error("intentional partial cleanup");
      },
    }),
  ).rejects.toThrow("partial cleanup");
  await rm(f.runtimeDirectory, { recursive: true });
  const command = join(state.directory, "code60");
  await expect(
    promisify(execFile)(command, ["uninstall"], {
      env: tools.env,
      cwd: tools.env.HOME,
      timeout: 15000,
    }),
  ).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("explicit --yes") });
  const result = await promisify(execFile)(command, ["uninstall", "--yes"], {
    env: tools.env,
    cwd: tools.env.HOME,
    timeout: 15000,
  });
  expect(result.stdout).toContain(
    "Databases, configuration, engine evidence and worktrees were preserved",
  );
  expect(await readFile(unrelated, "utf8")).toBe("unrelated state must remain");
  expect((await readRemovalState(f.plan.record))?.value.phase).toBe("complete");
  const calls = await tools.calls();
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.every(({ args }) => args.includes("print") || args.includes("show"))).toBe(true);
  await vi.waitFor(() => expect(calls.every(({ pid }) => !runtimeProcessExists(pid))).toBe(true));
  await retained(f);
}, 20000);

it.each(["SIGINT", "SIGTERM"] as const)(
  "preserves interruption exit status for the actual durable launcher: %s",
  async (signal) => {
    const f = await fixture();
    const state = await f.prepare();
    const tools = await inspectionTools(f.home, true);
    const child = spawn(join(state.directory, "code60"), ["uninstall", "--yes"], {
      env: tools.env,
      cwd: "/",
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.resume();
    child.stderr.resume();
    const closed = once(child, "close");
    try {
      await vi.waitFor(async () => expect((await tools.calls()).length).toBeGreaterThan(0));
      child.kill(signal);
    } finally {
      await writeFile(tools.proceed, "release fixture inspection", { mode: 0o600 });
    }
    expect((await closed)[0]).toBe(signal === "SIGINT" ? 130 : 143);
    const calls = await tools.calls();
    await vi.waitFor(() => expect(calls.every(({ pid }) => !runtimeProcessExists(pid))).toBe(true));
    expect((await readRemovalState(f.plan.record))?.value.phase).toBe("prepared");
    expect(await readFile(join(f.release, "NOTICE"), "utf8")).toBe("owned notice\n");
    await retained(f);
  },
  20000,
);
it("preflights every remaining inventory before the first deletion and preserves foreign additions", async () => {
  const f = await fixture();
  await f.prepare();
  const outside = join(f.plan.activations[0]?.root as string, "outside.txt");
  await writeFile(outside, "foreign addition", { mode: 0o600 });
  await expect(finishManagedRemoval(f.plan.record, { reserve: f.reserve })).rejects.toThrow(
    "ownership changed",
  );
  expect(await readFile(join(f.release, "NOTICE"), "utf8")).toBe("owned notice\n");
  expect(await readFile(outside, "utf8")).toBe("foreign addition");
  await retained(f);
});
it("preserves a replaced launcher and reports it on initial and repeated completion", async () => {
  const f = await fixture();
  await f.prepare();
  await unlink(f.launcher);
  await writeFile(f.launcher, "foreign launcher", { mode: 0o700 });
  expect((await finishManagedRemoval(f.plan.record, { reserve: f.reserve })).residuals).toContain(
    f.launcher,
  );
  expect((await finishManagedRemoval(f.plan.record, { reserve: f.reserve })).residuals).toContain(
    f.launcher,
  );
  expect(await readFile(f.launcher, "utf8")).toBe("foreign launcher");
  await expect(f.install()).rejects.toThrow(/launcher|link/);
  await retained(f);
});
it("refuses a replaced current pointer even when its target string is unchanged", async () => {
  const f = await fixture();
  await f.prepare();
  const current = join(f.root, "current");
  await rename(current, join(f.home, "old-current"));
  await symlink(f.plan.current.target, current);
  await expect(finishManagedRemoval(f.plan.record, { reserve: f.reserve })).rejects.toThrow(
    "current ownership changed",
  );
  expect(await readFile(join(f.release, "NOTICE"), "utf8")).toBe("owned notice\n");
  await retained(f);
});
it.each(["support", "receipt", "progress", "unsafe-inventory"] as const)(
  "refuses changed %s before deleting app files",
  async (fault) => {
    const f = await fixture();
    const state = await f.prepare();
    if (fault === "support")
      await writeFile(
        join(state.directory, "runtime/management/removal-support.js"),
        "outside edit",
      );
    if (fault === "receipt") await writeFile(join(state.directory, "receipt.json"), "{}");
    if (fault === "progress") await writeFile(join(f.root, "removal.json"), "{}");
    if (fault === "unsafe-inventory") {
      const receipt = structuredClone(state.receipt);
      const inventory = receipt.inventories[0];
      if (!inventory) throw Error("Missing fixture inventory");
      inventory.root = join(f.root, "databases");
      const text = JSON.stringify(receipt);
      await writeFile(join(state.directory, "receipt.json"), text);
      await writeFile(
        join(f.root, "removal.json"),
        JSON.stringify({ ...state.value, receiptHash: hash(text) }),
      );
    }
    await expect(finishManagedRemoval(f.plan.record, { reserve: f.reserve })).rejects.toThrow(
      /receipt|support/,
    );
    expect(await readFile(join(f.release, "NOTICE"), "utf8")).toBe("owned notice\n");
    await retained(f);
  },
);
it("preserves a completed removal if final resource release fails, reports failure and permits an explicit repeat", async () => {
  const f = await fixture();
  await f.prepare();
  const reserve: typeof reserveRemovedBackend = async (proof, signal) => {
    const result = await f.reserve(proof, signal);
    return {
      ...result,
      release: async () => {
        await result.release();
        throw Error("intentional cleanup failure");
      },
    };
  };
  await expect(finishManagedRemoval(f.plan.record, { reserve })).rejects.toThrow(
    "Uninstall cleanup failed",
  );
  expect((await readRemovalState(f.plan.record))?.value.phase).toBe("complete");
  expect(await finishManagedRemoval(f.plan.record, { reserve: f.reserve })).toMatchObject({
    removed: true,
  });
  await retained(f);
});
it("supports retained-data reinstall and refuses an old recovery attempt against the new activation", async () => {
  const f = await fixture();
  await f.prepare();
  await finishManagedRemoval(f.plan.record, { reserve: f.reserve });
  expect((await f.install()).reused).toBe(false);
  expect((await f.install()).reused).toBe(true);
  expect(f.acquire).toHaveBeenCalledTimes(2);
  const next = await planManagedRemoval(f.env);
  expect(next?.record.id).toBe(f.plan.record.id);
  expect(next?.current.target).not.toBe(f.plan.current.target);
  if (!next) throw Error("Missing reinstalled fixture");
  await writeFile(
    join(next.record.root, next.current.target, "runtime/management/installed-launcher.js"),
    "changed owned support",
  );
  expect((await f.install(true)).reused).toBe(false);
  expect(f.acquire).toHaveBeenCalledTimes(2);
  await expect(finishManagedRemoval(f.plan.record, { reserve: f.reserve })).rejects.toThrow(
    "reactivated",
  );
  expect(await readFile(join(f.release, "NOTICE"), "utf8")).toBe("owned notice\n");
  await retained(f);
});
it("refuses invalid recovery arguments before filesystem access and strips Node injection through its independent launcher", async () => {
  const f = await fixture();
  const state = await f.prepare();
  await expect(
    promisify(execFile)(join(state.directory, "code60"), ["uninstall", "--bad"], {
      env: {
        HOME: f.home,
        PATH: "/usr/bin:/bin",
        NODE_OPTIONS: "--require=/missing/untrusted",
        NODE_PATH: "/missing/untrusted",
      },
      timeout: 10000,
    }),
  ).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("printed recovery command") });
  expect((await readRemovalState(f.plan.record))?.value.phase).toBe("prepared");
  await retained(f);
});
it("bounds cancellation and refuses a concurrent cleanup without affecting an independent installation", async () => {
  const f = await fixture();
  const independent = await fixture();
  await f.prepare();
  await independent.prepare();
  const abort = new AbortController();
  let enter: () => void = () => {};
  let resume: () => void = () => {};
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const proceed = new Promise<void>((resolve) => {
    resume = resolve;
  });
  let first = true;
  const pending = finishManagedRemoval(f.plan.record, {
    reserve: f.reserve,
    signal: abort.signal,
    checkpoint: async () => {
      if (first) {
        first = false;
        enter();
        await proceed;
      }
    },
  });
  const rejected = expect(pending).rejects.toThrow("intentional cancellation");
  await entered;
  try {
    await expect(finishManagedRemoval(f.plan.record, { reserve: f.reserve })).rejects.toThrow(
      "ownership is busy",
    );
    abort.abort(Error("intentional cancellation"));
  } finally {
    resume();
    await rejected;
  }
  expect((await readRemovalState(independent.plan.record))?.value.phase).toBe("prepared");
  expect(await readFile(join(independent.release, "NOTICE"), "utf8")).toBe("owned notice\n");
  await finishManagedRemoval(f.plan.record, { reserve: f.reserve });
  await finishManagedRemoval(independent.plan.record, { reserve: independent.reserve });
  await retained(f);
  await retained(independent);
});

it.each(["cancelled", "foreign-file"] as const)(
  "cleans only known unpublished support or preserves %s evidence without touching the app",
  async (fault) => {
    const f = await fixture();
    const abort = new AbortController();
    let directory = "";
    await expect(
      prepareManagedRemoval(f.plan, f.proof, {
        runtimeDirectory: f.runtimeDirectory,
        signal: abort.signal,
        checkpoint: async (path) => {
          directory = path;
          if (fault === "foreign-file")
            await writeFile(join(path, "outside.txt"), "preserve this outside edit", {
              mode: 0o600,
            });
          abort.abort(Error("intentional preparation cancellation"));
        },
      }),
    ).rejects.toThrow(
      fault === "cancelled" ? "intentional preparation cancellation" : "owned cleanup failed",
    );
    if (fault === "cancelled")
      await expect(lstat(directory)).rejects.toMatchObject({ code: "ENOENT" });
    else
      expect(await readFile(join(directory, "outside.txt"), "utf8")).toBe(
        "preserve this outside edit",
      );
    expect(await readRemovalState(f.plan.record)).toBe(null);
    expect(await readFile(join(f.release, "NOTICE"), "utf8")).toBe("owned notice\n");
    await retained(f);
  },
);

it("refuses an incomplete support build and removes only its newly created directories", async () => {
  const f = await fixture();
  const empty = join(f.home, "empty-runtime");
  await mkdir(join(empty, "management"), { recursive: true });
  await mkdir(join(empty, "platform"));
  await expect(prepareManagedRemoval(f.plan, f.proof, { runtimeDirectory: empty })).rejects.toThrow(
    "receipt is invalid",
  );
  expect(await readdir(join(f.root, "removals"))).toEqual([]);
  expect(await readRemovalState(f.plan.record)).toBe(null);
  await retained(f);
});

it("public uninstall declines without service, application or profile changes", async () => {
  const f = await fixture();
  const ports = uninstallPorts(f);
  ports.interactive = true;
  const before = await readFile(join(f.proof.root, "registration.json"));
  await runUninstall([], f.env, ports);
  expect(ports.confirm).toHaveBeenCalledOnce();
  expect(ports.remove).not.toHaveBeenCalled();
  expect(await readRemovalState(f.plan.record)).toBe(null);
  expect(await readFile(join(f.proof.root, "registration.json"))).toEqual(before);
  expect(await readFile(join(f.release, "NOTICE"), "utf8")).toBe("owned notice\n");
  await retained(f);
});

it("refuses unavailable native inspection before service, profile or removal effects", async () => {
  const f = await fixture();
  const ports = uninstallPorts(f);
  ports.verifyNative.mockRejectedValue(Error("Native kernel inspection unavailable"));
  const before = await readFile(join(f.proof.root, "registration.json"));
  await expect(runUninstall(["--yes"], f.env, ports)).rejects.toThrow(
    "Native kernel inspection unavailable",
  );
  expect(ports.status).not.toHaveBeenCalled();
  expect(ports.remove).not.toHaveBeenCalled();
  expect(ports.prepare).not.toHaveBeenCalled();
  expect(await readRemovalState(f.plan.record)).toBe(null);
  expect(await readFile(join(f.proof.root, "registration.json"))).toEqual(before);
  await retained(f);
});

it("public non-TTY uninstall requires trailing consent and --yes never edits profiles", async () => {
  const f = await fixture();
  const ports = uninstallPorts(f);
  const preview = await planShellIntegration(f.env);
  await applyShellIntegration(preview, { approved: true, interactive: true });
  const profiles = await Promise.all(preview.edits.map((edit) => readFile(edit.path, "utf8")));
  await expect(runUninstall([], f.env, ports)).rejects.toThrow("explicit consent");
  expect(ports.remove).not.toHaveBeenCalled();
  await runUninstall(["--yes"], f.env, ports);
  expect(ports.confirm).not.toHaveBeenCalled();
  expect(ports.remove).toHaveBeenCalledOnce();
  expect(ports.prepare).not.toHaveBeenCalled();
  expect(await Promise.all(preview.edits.map((edit) => readFile(edit.path, "utf8")))).toEqual(
    profiles,
  );
  expect(
    ports.write.mock.calls.some(
      ([message]) => message.includes("Recovery command") && message.includes(" uninstall --yes"),
    ),
  ).toBe(true);
  expect((await readRemovalState(f.plan.record))?.value.phase).toBe("complete");
  await retained(f);
});

it.each([true, false])(
  "public --yes still requests separate interactive profile approval: %s",
  async (approved) => {
    const f = await fixture();
    const ports = uninstallPorts(f);
    ports.interactive = true;
    await writeFile(join(f.home, ".bashrc"), "unrelated profile content\n", { mode: 0o600 });
    const preview = await planShellIntegration(f.env);
    await applyShellIntegration(preview, { approved: true, interactive: true });
    const before = await readFile(join(f.home, ".bashrc"), "utf8");
    ports.confirm.mockResolvedValue(approved);
    await runUninstall(["--yes"], f.env, ports);
    expect(ports.confirm).toHaveBeenCalledOnce();
    expect(ports.confirm.mock.calls[0]?.[0]).toContain("shell profile");
    expect(await readFile(join(f.home, ".bashrc"), "utf8")).toBe(
      approved ? "unrelated profile content\n" : before,
    );
    await retained(f);
  },
);

it.each(["interactive", "scheduled", "workflow", "unenrolled-running"] as const)(
  "public uninstall refuses uncertain/active %s before asking for consent or stopping anything",
  async (fault) => {
    const f = await fixture();
    const ports = uninstallPorts(f);
    ports.interactive = true;
    ports.status.mockResolvedValue({
      installed: fault !== "unenrolled-running",
      nativeState: "running",
      runtimeCurrent: true,
      service: { pid: 42 },
    });
    const summary = await ports.summary();
    if (fault === "interactive") summary.interactiveActive = true;
    if (fault === "scheduled") summary.scheduledUncertain = true;
    if (fault === "workflow") summary.workflows.uncertain = 1;
    ports.summary.mockResolvedValue(summary);
    await expect(runUninstall([], f.env, ports)).rejects.toThrow(/uncertain|active/);
    expect(ports.confirm).not.toHaveBeenCalled();
    expect(ports.prepare).not.toHaveBeenCalled();
    expect(ports.remove).not.toHaveBeenCalled();
    expect(await readFile(join(f.release, "NOTICE"), "utf8")).toBe("owned notice\n");
    await retained(f);
  },
);

it("public uninstall forwards exact prepared generation to guarded removal and merges process evidence", async () => {
  const f = await fixture();
  const ports = uninstallPorts(f);
  ports.status.mockResolvedValue({
    installed: true,
    nativeState: "running",
    runtimeCurrent: true,
    service: { pid: 42 },
  });
  await runUninstall(["--yes"], f.env, ports);
  expect(ports.remove).toHaveBeenCalledWith({
    pid: 42,
    executable: f.plan.current.receipt.node.path,
    entrypoint: join(f.release, "dist/gateway/main.js"),
    appVersion: "1.0.0",
  });
  expect(ports.prepare.mock.invocationCallOrder[0]).toBeLessThan(
    ports.remove.mock.invocationCallOrder[0] ?? 0,
  );
  expect((await readRemovalState(f.plan.record))?.receipt.service.pids.sort()).toEqual([42, 43]);
  await retained(f);
});

it("public uninstall refuses conflicting stopped runtime metadata before consent or profile changes", async () => {
  const f = await fixture();
  const ports = uninstallPorts(f);
  ports.interactive = true;
  ports.status.mockResolvedValue({
    installed: false,
    nativeState: "stopped",
    runtimeCurrent: false,
    service: null,
  });
  await expect(runUninstall([], f.env, ports)).rejects.toThrow("runtime ownership is uncertain");
  expect(ports.confirm).not.toHaveBeenCalled();
  expect(ports.remove).not.toHaveBeenCalled();
  expect(await readRemovalState(f.plan.record)).toBe(null);
  await retained(f);
});

it("public uninstall resumes recorded preparation without reinstalling, probing or removing the service again", async () => {
  const f = await fixture();
  const ports = uninstallPorts(f);
  await expect(
    runUninstall(["--yes"], f.env, {
      ...ports,
      checkpoint: async () => {
        throw Error("intentional interruption");
      },
    }),
  ).rejects.toThrow("Resume:");
  expect((await readRemovalState(f.plan.record))?.value.phase).toBe("prepared");
  ports.status.mockRejectedValue(Error("Unexpected status probe"));
  ports.remove.mockRejectedValue(Error("Unexpected service mutation"));
  await runUninstall(["--yes"], f.env, ports);
  expect(ports.status).toHaveBeenCalledTimes(1);
  expect(ports.remove).toHaveBeenCalledTimes(1);
  expect((await readRemovalState(f.plan.record))?.value.phase).toBe("complete");
  await retained(f);
});

it("default public uninstall refuses an old/source CLI before native service effects", async () => {
  const f = await fixture();
  await expect(runUninstall(["--yes"], f.env)).rejects.toThrow("current installed code60 command");
  expect(await readRemovalState(f.plan.record)).toBe(null);
  await retained(f);
});
