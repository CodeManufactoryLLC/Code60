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
export const transmissionArtifacts = {
  "0.1.0-staging.18": {
    name: "transmission-18",
    integrity:
      "sha512-U1SLG4FZv7yYW9eMzKEVSNx6tZ85YRbGyagEfcBzedfEQkn8Qaj1SS+duXST+8WH4jFaF8XZAbp+tTTiGbhDVg==",
  },
  "0.1.0-staging.20": {
    name: "transmission-20",
    integrity:
      "sha512-23Y6om57UMB1pCAe+XcbH84JzFk0xo6CHJHiCfd06G5E1m1OAxY/JDI9UR43dfACAJfpWQHN+Wm67U4Lc+Xy9Q==",
  },
};
export function verifyTransmissionLock(lock) {
  for (const [version, artifact] of Object.entries(transmissionArtifacts)) {
    const value = lock.packages?.[`node_modules/${artifact.name}`];
    if (
      value?.version !== version ||
      value.name !== "code60-transmission-server" ||
      value.integrity !== artifact.integrity ||
      value.resolved !==
        `https://registry.npmjs.org/code60-transmission-server/-/code60-transmission-server-${version}.tgz`
    )
      throw Error("Transmission lock differs from the verified supported artifacts");
  }
  for (const [path, value] of Object.entries(lock.packages)) {
    if (!path) continue;
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
  if (`${host.platform}-${host.arch}` !== "darwin-arm64")
    throw Error("Transmission bundles must be built natively on macOS arm64");
  const [major, minor] = host.versions.node.split(".").map(Number);
  if (major !== 24 || minor < 22) throw Error("Transmission bundles require Node >=24.22.0 <25");
  const source = join(root, "distribution/transmission");
  const lock = JSON.parse(await readFile(join(source, "package-lock.json"), "utf8"));
  verifyTransmissionLock(lock);
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
    await execute("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
      cwd: bundle,
      env,
      signal,
      timeout: 180_000,
      maxBuffer: 8 * 1024 ** 2,
    });
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
    const native = "node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex";
    const binary = await readFile(join(bundle, native));
    if (
      binary.readUInt32LE(0) !== 0xfeedfacf ||
      binary.readUInt32LE(4) !== 0x0100000c ||
      !((await stat(join(bundle, native))).mode & 0o111)
    )
      throw Error("Transmission native Codex runtime is not executable macOS arm64");
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
      os: "darwin",
      arch: "arm64",
      node: ">=24.22.0 <25",
      builtWithNode: process.version,
      lockfileSha256: await sha256(join(bundle, "package-lock.json")),
      engines: Object.fromEntries(
        Object.entries(transmissionArtifacts).map(([version, artifact]) => [
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
