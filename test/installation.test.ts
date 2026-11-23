import { execFile } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyShellIntegration,
  type InstallationOptions,
  installManagedRelease,
  planShellIntegration,
} from "../src/management/index.js";
import {
  createInstallationParents,
  installationSnapshot,
  lockInstallation,
  publishInstallationLink,
  writeInstallationFile,
} from "../src/platform/index.js";

const execute = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    await chmod(root, 0o700).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});
async function fixture() {
  const home = await realpath(await mkdtemp(join(tmpdir(), "code60 install ' spaces ")));
  roots.push(home);
  const env = { HOME: home, SHELL: "/bin/bash", PATH: "/usr/bin:/bin" };
  const acquire = vi.fn(async ({ parent }: { parent: string }) => {
    const owned = await mkdtemp(join(parent, ".code60-payload-"));
    const root = join(owned, "application");
    await mkdir(join(root, "dist/management"), { recursive: true, mode: 0o700 });
    await writeFile(join(root, "package.json"), '{"type":"module"}');
    await writeFile(join(root, "payload.json"), '{"schemaVersion":1}');
    await writeFile(
      join(root, "dist/management/cli.js"),
      'export async function runManagement(args,env){process.stdout.write(JSON.stringify({args,home:env.HOME,nodeOptions:env.NODE_OPTIONS??null,nodePath:env.NODE_PATH??null}));if(args[0]==="fail")process.exitCode=7;}',
    );
    return { root, owned };
  });
  const options: InstallationOptions = {
    env,
    artifact: {
      identity: {
        version: "1.0.0",
        os: process.platform,
        arch: process.arch,
        archive: { sha256: "a".repeat(64) },
      },
      acquire,
    },
    runtimeDirectory: resolve("build/distribution"),
  };
  return {
    home,
    env,
    options,
    acquire,
    root: join(home, ".local/share/code60"),
    launcher: join(home, ".local/bin/code60"),
  };
}
it("installs a private, durable launcher, preserves arguments/status and strips Node injection", async () => {
  const f = await fixture();
  const installed = await installManagedRelease(f.options);
  expect(installed.reused).toBe(false);
  expect(await readlink(f.launcher)).toBe(join(f.root, "current/code60"));
  const output = await execute(f.launcher, ["--help", "argument ' with spaces"], {
    cwd: "/",
    env: { ...f.env, NODE_OPTIONS: "--require /missing", NODE_PATH: "/missing" },
    timeout: 10000,
  });
  expect(JSON.parse(output.stdout)).toEqual({
    args: ["--help", "argument ' with spaces"],
    home: f.home,
    nodeOptions: null,
    nodePath: null,
  });
  await expect(execute(f.launcher, ["fail"], { env: f.env, timeout: 10000 })).rejects.toMatchObject(
    { code: 7 },
  );
  expect((await lstat(join(f.root, "installation.json"))).mode & 0o777).toBe(0o600);
  const again = await installManagedRelease(f.options);
  expect(again.reused).toBe(true);
  expect(f.acquire).toHaveBeenCalledTimes(1);
});
it("repairs only an owned missing launcher and retains previous activation on preparation failure", async () => {
  const f = await fixture();
  await installManagedRelease(f.options);
  const previous = await readlink(join(f.root, "current"));
  await expect(
    installManagedRelease({
      ...f.options,
      repair: true,
      checkpoint: async () => {
        throw Error("injected before publication");
      },
    }),
  ).rejects.toThrow("injected");
  expect(await readlink(join(f.root, "current"))).toBe(previous);
  expect(JSON.parse((await execute(f.launcher, ["old"], { env: f.env })).stdout).args).toEqual([
    "old",
  ]);
  await rm(f.launcher);
  await installManagedRelease(f.options);
  expect(await readlink(f.launcher)).toContain("/current/code60");
  expect(f.acquire).toHaveBeenCalledTimes(1);
});
it("preserves committed activation after a post-publication failure", async () => {
  const f = await fixture();
  await expect(
    installManagedRelease({
      ...f.options,
      checkpoint: async (phase) => {
        if (phase === "published") throw Error("post commit");
      },
    }),
  ).rejects.toThrow("post commit");
  expect(JSON.parse((await execute(f.launcher, ["live"], { env: f.env })).stdout).args).toEqual([
    "live",
  ]);
});
it("rejects unowned files, commands and roots without replacing them", async () => {
  for (const mode of ["launcher", "path", "root"]) {
    const f = await fixture();
    if (mode === "launcher") {
      await mkdir(dirname(f.launcher), { recursive: true });
      await writeFile(f.launcher, "foreign");
    }
    if (mode === "path") {
      const bin = join(f.home, "other");
      await mkdir(bin);
      await writeFile(join(bin, "code60"), "#!/bin/sh\nexit 0", { mode: 0o700 });
      f.env.PATH = `${bin}:/usr/bin:/bin`;
    }
    if (mode === "root") {
      await mkdir(f.root, { recursive: true, mode: 0o700 });
      await writeFile(join(f.root, "foreign"), "preserve");
    }
    await expect(installManagedRelease(f.options)).rejects.toThrow();
    expect(f.acquire).not.toHaveBeenCalled();
    if (mode === "launcher") expect(await readFile(f.launcher, "utf8")).toBe("foreign");
  }
});
it("never implicitly activates a different release identity", async () => {
  const f = await fixture();
  await installManagedRelease(f.options);
  const before = await readlink(join(f.root, "current"));
  for (const identity of [
    { ...f.options.artifact.identity, version: "2.0.0" },
    { ...f.options.artifact.identity, archive: { sha256: "b".repeat(64) } },
  ])
    await expect(
      installManagedRelease({ ...f.options, artifact: { ...f.options.artifact, identity } }),
    ).rejects.toThrow("different release");
  expect(await readlink(join(f.root, "current"))).toBe(before);
});
it("does not reclaim stale locks and releases only its own token", async () => {
  const f = await fixture();
  await createInstallationParents(f.root, true);
  const release = await lockInstallation(f.root);
  await expect(lockInstallation(f.root)).rejects.toThrow("busy or uncertain");
  await writeFile(join(f.root, ".install-lock/owner.json"), '{"token":"foreign"}', { mode: 0o600 });
  await expect(release()).rejects.toThrow("ownership changed");
  expect(await lstat(join(f.root, ".install-lock"))).toBeTruthy();
});
it("handles simultaneous attempts and independent roots without deleting the other installation", async () => {
  const f = await fixture();
  let ready!: () => void;
  let release!: () => void;
  const started = new Promise<void>((yes) => {
    ready = yes;
  });
  const gate = new Promise<void>((yes) => {
    release = yes;
  });
  const first = installManagedRelease({
    ...f.options,
    checkpoint: async (phase) => {
      if (phase === "prepared") {
        ready();
        await gate;
      }
    },
  });
  await started;
  await expect(installManagedRelease(f.options)).rejects.toThrow("busy or uncertain");
  const other = await fixture();
  await installManagedRelease(other.options);
  release();
  await first;
  await rm(f.home, { recursive: true });
  expect(
    JSON.parse((await execute(other.launcher, ["other"], { env: other.env })).stdout).args,
  ).toEqual(["other"]);
});
it("cancels before publication, preserves uncertainty and refuses unsafe links and files", async () => {
  const f = await fixture();
  const controller = new AbortController();
  await expect(
    installManagedRelease({
      ...f.options,
      signal: controller.signal,
      checkpoint: async () => controller.abort(),
    }),
  ).rejects.toThrow();
  await expect(lstat(join(f.root, "current"))).rejects.toMatchObject({ code: "ENOENT" });
  await expect(
    publishInstallationLink(join(f.root, "current"), "activations/anything", "activations/foreign"),
  ).rejects.toThrow("changed");
  await symlink(f.home, join(f.home, "redirect"));
  await expect(createInstallationParents(join(f.home, "redirect/child"))).rejects.toThrow("Unsafe");
  const path = join(f.home, "profile");
  await writeFile(path, "one");
  const before = await installationSnapshot(path);
  await writeFile(path, "two");
  await expect(writeInstallationFile(path, "three", before?.identity ?? null)).rejects.toThrow(
    "changed",
  );
  expect(await readFile(path, "utf8")).toBe("two");
});
it("rejects changed receipts/support and reports incompatible or missing Node without falling back", async () => {
  const f = await fixture();
  await installManagedRelease(f.options);
  const target = await readlink(join(f.root, "current"));
  const receiptPath = join(f.root, target, "receipt.json");
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  receipt.node.path = "/missing/node";
  await writeFile(receiptPath, JSON.stringify(receipt), { mode: 0o600 });
  await expect(execute(f.launcher, ["--help"], { env: f.env })).rejects.toThrow(
    "recorded Node executable",
  );
  await writeFile(join(f.root, target, "runtime/management/install-state.js"), "changed", {
    mode: 0o600,
  });
  await expect(installManagedRelease(f.options)).rejects.toThrow("support changed");
});
describe("shell previews and application", () => {
  it.each(["bash", "zsh", "fish"])(
    "previews and applies %s edits only with interactive approval",
    async (shell) => {
      const f = await fixture();
      await installManagedRelease(f.options);
      const env = { ...f.env, SHELL: `/bin/${shell}` };
      const preview = await planShellIntegration(env);
      expect(preview.edits.length).toBe(shell === "fish" ? 1 : 2);
      expect(
        (await applyShellIntegration(preview, { approved: false, interactive: true })).applied,
      ).toEqual([]);
      expect(
        (await applyShellIntegration(preview, { approved: true, interactive: false })).applied,
      ).toEqual([]);
      const applied = await applyShellIntegration(preview, { approved: true, interactive: true });
      expect(applied.manual).toEqual([]);
      expect(applied.applied).toHaveLength(preview.edits.length);
      expect((await planShellIntegration(env)).edits).toEqual([]);
      expect(
        (await planShellIntegration({ ...env, PATH: `${dirname(f.launcher)}:/usr/bin` })).edits,
      ).toEqual([]);
    },
  );
  it("preserves CRLF and unrelated bytes, custom locations, and refuses stale previews", async () => {
    const f = await fixture();
    await installManagedRelease(f.options);
    const directory = join(f.home, "custom zsh");
    await mkdir(directory);
    await writeFile(join(directory, ".zshrc"), "# original\r\n");
    const env = { ...f.env, SHELL: "/bin/zsh", ZDOTDIR: directory };
    const preview = await planShellIntegration(env);
    await writeFile(join(directory, ".zprofile"), "external edit");
    const result = await applyShellIntegration(preview, { approved: true, interactive: true });
    expect(result.manual.join()).toContain("changed");
    expect(await readFile(join(directory, ".zprofile"), "utf8")).toBe("external edit");
    const next = await planShellIntegration(env);
    await applyShellIntegration(next, { approved: true, interactive: true });
    expect(
      (await readFile(join(directory, ".zshrc"), "utf8")).startsWith("# original\r\n# >>>"),
    ).toBe(true);
  });
  it("gives manual guidance for unsafe/read-only/modified/redirected profiles and unknown shells", async () => {
    const f = await fixture();
    await installManagedRelease(f.options);
    const rc = join(f.home, ".bashrc");
    await writeFile(rc, "# preserve", { mode: 0o444 });
    expect((await planShellIntegration(f.env)).manual.join()).toContain("read-only");
    await chmod(rc, 0o600);
    await rm(rc);
    await symlink("/etc/profile", rc);
    expect((await planShellIntegration(f.env)).manual.length).toBeGreaterThan(0);
    expect(
      (await planShellIntegration({ ...f.env, SHELL: "/bin/unknown" })).manual.length,
    ).toBeGreaterThan(0);
    expect(
      (
        await planShellIntegration({ ...f.env, SHELL: "/bin/zsh", ZDOTDIR: "relative" })
      ).manual.join(),
    ).toContain("Relative");
    await writeFile(join(f.home, ".zshenv"), "ZDOTDIR=other");
    expect((await planShellIntegration({ ...f.env, SHELL: "/bin/zsh" })).manual.join()).toContain(
      "redirects",
    );
    await rm(rc);
    await writeFile(rc, "# >>> code60 PATH foreign >>>\n");
    expect((await planShellIntegration(f.env)).manual.join()).toContain("unknown ownership");
  });
  it("retains valid partial edits when a later profile changed", async () => {
    const f = await fixture();
    await installManagedRelease(f.options);
    const preview = await planShellIntegration(f.env);
    await writeFile(join(f.home, ".bashrc"), "changed");
    const result = await applyShellIntegration(preview, { approved: true, interactive: true });
    expect(result.applied).toHaveLength(1);
    expect(result.manual.join()).toContain("changed");
    expect(await readFile(join(f.home, ".bashrc"), "utf8")).toBe("changed");
  });
});

it("rejects hard-linked receipts, relative roots, and damaged launcher scripts", async () => {
  const { link } = await import("node:fs/promises");
  const f = await fixture();
  await expect(
    installManagedRelease({ ...f.options, env: { ...f.env, XDG_DATA_HOME: "relative" } }),
  ).rejects.toThrow("absolute");
  await installManagedRelease(f.options);
  const target = await readlink(join(f.root, "current"));
  await writeFile(join(f.root, target, "code60"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  await expect(installManagedRelease(f.options)).rejects.toThrow("launcher changed");
  const g = await fixture();
  await installManagedRelease(g.options);
  await link(join(g.root, "installation.json"), join(g.home, "linked"));
  await expect(installManagedRelease(g.options)).rejects.toThrow("ownership");
});
it("reports lock cleanup failure after commit and preserves the usable activation", async () => {
  const f = await fixture();
  await expect(
    installManagedRelease({
      ...f.options,
      checkpoint: async (phase) => {
        if (phase === "published")
          await writeFile(join(f.root, ".install-lock/owner.json"), '{"token":"foreign"}', {
            mode: 0o600,
          });
      },
    }),
  ).rejects.toThrow("cleanup failed");
  expect(JSON.parse((await execute(f.launcher, ["usable"], { env: f.env })).stdout).args).toEqual([
    "usable",
  ]);
  expect(await lstat(join(f.root, ".install-lock"))).toBeTruthy();
});
it("bounds profile previews and preserves original contents after oversized or forged edits", async () => {
  const f = await fixture();
  await installManagedRelease(f.options);
  const rc = join(f.home, ".bashrc");
  await writeFile(rc, "x".repeat(1024 * 1024));
  expect((await planShellIntegration(f.env)).manual.length).toBeGreaterThan(0);
  await rm(rc);
  const preview = await planShellIntegration(f.env);
  const edit = preview.edits[0];
  if (!edit) throw new Error("Expected a shell edit");
  edit.append = "malicious replacement";
  const result = await applyShellIntegration(preview, { approved: true, interactive: true });
  expect(result.applied).toEqual([]);
  expect(result.manual.join()).toContain("changed");
});

it("explicit repair replaces only owned launcher support without downloading the release", async () => {
  const f = await fixture();
  await installManagedRelease(f.options);
  const old = await readlink(join(f.root, "current"));
  await writeFile(join(f.root, old, "runtime/platform/index.js"), "damaged", { mode: 0o600 });
  await expect(installManagedRelease(f.options)).rejects.toThrow("support changed");
  await installManagedRelease({ ...f.options, repair: true });
  expect(await readlink(join(f.root, "current"))).not.toBe(old);
  expect(f.acquire).toHaveBeenCalledTimes(1);
  expect(JSON.parse((await execute(f.launcher, ["repaired"], { env: f.env })).stdout).args).toEqual(
    ["repaired"],
  );
});
it("the exec launcher preserves SIGTERM rather than leaving a wrapper process", async () => {
  const { spawn } = await import("node:child_process");
  const f = await fixture();
  const original = f.options.artifact.acquire;
  await installManagedRelease({
    ...f.options,
    artifact: {
      ...f.options.artifact,
      acquire: async (options) => {
        const candidate = await original(options);
        await writeFile(
          join(candidate.root, "dist/management/cli.js"),
          'export async function runManagement(){console.log("ready");await new Promise(()=>setInterval(()=>{},1000));}',
        );
        return candidate;
      },
    },
  });
  const child = spawn(f.launcher, ["wait"], { env: f.env, stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise<void>((yes, no) => {
      child.once("error", no);
      child.stdout.once("data", () => yes());
    });
    const ended = new Promise<{ code: number | null; signal: string | null }>((yes) =>
      child.once("exit", (code, signal) => yes({ code, signal })),
    );
    child.kill("SIGTERM");
    expect(await ended).toEqual({ code: null, signal: "SIGTERM" });
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
});

it("allows only the exact invoking bootstrap on PATH, then works after its cache is removed", async () => {
  const f = await fixture();
  const cache = join(f.home, "npm cache");
  await mkdir(cache);
  const entry = join(cache, "bootstrap.mjs");
  await writeFile(entry, "// own bootstrap", { mode: 0o700 });
  await symlink("bootstrap.mjs", join(cache, "code60"));
  f.env.PATH = `${cache}:/usr/bin:/bin`;
  await installManagedRelease({ ...f.options, bootstrapEntry: entry });
  await rm(cache, { recursive: true });
  expect(
    JSON.parse((await execute(f.launcher, ["independent"], { env: f.env })).stdout).args,
  ).toEqual(["independent"]);
});

it("preserves UTF-8 BOM, original mode and bytes under a restrictive umask", async () => {
  const f = await fixture();
  await installManagedRelease(f.options);
  const path = join(f.home, ".bashrc");
  const original = "\uFEFF# keep exact bytes\r\n";
  await writeFile(path, original, { mode: 0o644 });
  const mask = process.umask(0o077);
  try {
    const preview = await planShellIntegration(f.env);
    await applyShellIntegration(preview, { approved: true, interactive: true });
  } finally {
    process.umask(mask);
  }
  expect((await readFile(path, "utf8")).startsWith(original)).toBe(true);
  expect((await lstat(path)).mode & 0o777).toBe(0o644);
});
