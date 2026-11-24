import { execFile } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { sha256 } from "./acquire.mjs";
import { inventory, notices } from "./policy.mjs";

const execute = promisify(execFile);
// npm strips or renames these files when repacking. They are not runtime inputs;
// exclude them before recording the inventory shared by npm and payload builds.
export async function stripTransmissionPackageIgnores(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await stripTransmissionPackageIgnores(path);
    else if (entry.isFile() && [".npmignore", ".gitignore"].includes(entry.name)) await rm(path);
  }
}
export { macEngines as transmissionArtifacts } from "../../src/platform/transmission-target.mjs";

import { platform } from "../../src/platform/payload-descriptor.mjs";
import {
  linuxEngines,
  macEngines,
  workflowTarget,
} from "../../src/platform/transmission-target.mjs";

export function verifyTransmissionLock(lock, artifacts = macEngines) {
  for (const [version, artifact] of Object.entries(artifacts)) {
    const value = lock.packages?.[`node_modules/${artifact.name}`];
    if (
      value?.version !== version ||
      (value.name ?? artifact.name) !== "code60-transmission-server" ||
      value.integrity !== artifact.integrity ||
      value.resolved !==
        (artifacts === linuxEngines
          ? `file:code60-transmission-server-${version}.tgz`
          : `https://registry.npmjs.org/code60-transmission-server/-/code60-transmission-server-${version}.tgz`)
    )
      throw Error("Transmission lock differs from the verified supported artifacts");
  }
  for (const [path, value] of Object.entries(lock.packages)) {
    if (!path) continue;
    if (
      artifacts === linuxEngines &&
      path === "node_modules/code60-transmission-server" &&
      !value.hasInstallScript
    )
      continue;
    if (
      value.hasInstallScript ||
      !value.integrity?.startsWith("sha512-") ||
      !value.resolved?.startsWith("https://registry.npmjs.org/")
    )
      throw Error("Transmission dependencies must be registry-locked without install hooks");
  }
  if (lock.packages["node_modules/@openai/codex"]?.version !== "0.171.0")
    throw Error("Transmission native runtime must be pinned");
}

// Build-time only. Never called by setup, the gateway, or workflow execution.
export async function buildTransmission(root, destination, { signal, host = process } = {}) {
  if (host.platform !== process.platform || host.arch !== process.arch)
    throw Error("Transmission bundles must be built natively for the target");
  platform(host);
  const artifacts = workflowTarget(host.platform, host.arch);
  const linux = host.platform === "linux";
  const source = join(
    root,
    linux ? "distribution/transmission-linux" : "distribution/transmission",
  );
  const lock = JSON.parse(await readFile(join(source, "package-lock.json"), "utf8"));
  verifyTransmissionLock(lock, artifacts);
  const temporary = await mkdtemp(join(tmpdir(), "code60-engine-build-"));
  const bundle = join(temporary, "bundle");
  try {
    await mkdir(bundle, { mode: 0o700 });
    const home = join(temporary, "home");
    await mkdir(home, { mode: 0o700 });
    const env = {
      PATH: process.env.PATH,
      HOME: home,
      CODEX_HOME: join(home, "codex"),
      TMPDIR: temporary,
      NPM_CONFIG_USERCONFIG: "/dev/null",
      NPM_CONFIG_GLOBALCONFIG: join(home, "empty-global-npmrc"),
      NPM_CONFIG_CACHE: join(home, "npm-cache"),
      NPM_CONFIG_REGISTRY: "https://registry.npmjs.org/",
    };
    for (const name of ["package.json", "package-lock.json"])
      await cp(join(source, name), join(bundle, name));
    if (linux) {
      const archive = "code60-transmission-server-0.1.1.tgz";
      await cp(join(source, archive), join(bundle, archive));
    }
    await execute("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
      cwd: bundle,
      env,
      signal,
      timeout: 180_000,
      maxBuffer: 8 * 1024 ** 2,
    });
    if (linux) await rm(join(bundle, "code60-transmission-server-0.1.1.tgz"));
    // .bin aliases are unnecessary: every process is launched by an exact entrypoint.
    await rm(join(bundle, "node_modules/.bin"), { recursive: true, force: true });
    await stripTransmissionPackageIgnores(join(bundle, "node_modules"));
    await notices(join(bundle, "node_modules"), join(bundle, "licenses"));
    const { stdout } = await execute("npm", ["ls", "--omit=dev", "--all", "--json"], {
      cwd: bundle,
      env,
      signal,
      timeout: 30_000,
      maxBuffer: 8 * 1024 ** 2,
    });
    await writeFile(join(bundle, "dependencies.json"), stdout);
    const native = linux
      ? "node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex"
      : "node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex";
    const binary = await readFile(join(bundle, native));
    const correctArchitecture = linux
      ? binary.subarray(0, 6).toString("hex") === "7f454c460201" && binary.readUInt16LE(18) === 62
      : binary.readUInt32LE(0) === 0xfeedfacf && binary.readUInt32LE(4) === 0x0100000c;
    if (!correctArchitecture || !((await stat(join(bundle, native))).mode & 0o111))
      throw Error("Incorrect native Codex executable for Transmission build target");
    const probe = await execute(
      process.execPath,
      [join(bundle, "node_modules/@openai/codex/bin/codex.js"), "--version"],
      { cwd: temporary, env, signal, timeout: 20_000, maxBuffer: 4096 },
    );
    if (probe.stdout.trim() !== "codex-cli 0.171.0")
      throw Error("Transmission native runtime identity mismatch");
    const files = await inventory(bundle);
    if (
      files.length > 20_000 ||
      files.some((file) => file.type !== "0") ||
      files.reduce((size, file) => size + file.size, 0) > 2 * 1024 ** 3
    )
      throw Error("Transmission bundle exceeds supported regular-file limits");
    const metadata = {
      schema: 1,
      os: host.platform,
      arch: host.arch,
      node: ">=24.22.0 <25",
      builtWithNode: process.version,
      lockfileSha256: await sha256(join(bundle, "package-lock.json")),
      engines: Object.fromEntries(
        Object.entries(artifacts).map(([version, artifact]) => [
          version,
          {
            integrity: artifact.integrity,
            entry: `node_modules/${artifact.name}/dist/src/main.js`,
          },
        ]),
      ),
      native: { path: native, version: "0.171.0", sha256: await sha256(join(bundle, native)) },
      // These exact engine packages contain JavaScript only. Their native runtime
      // is already built and verified above; do not borrow helpers from a newer API.
      files,
    };
    await writeFile(join(bundle, "bundle.json"), `${JSON.stringify(metadata, null, 2)}\n`);
    await mkdir(destination, { recursive: true });
    const target = join(destination, metadata.lockfileSha256);
    const owned = await mkdtemp(join(destination, ".engine-build-"));
    try {
      await cp(bundle, join(owned, "bundle"), { recursive: true });
      await rename(join(owned, "bundle"), target);
    } finally {
      await rm(owned, { recursive: true });
    }
    return metadata;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
