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
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { sha256 } from "./distribution/acquire.mjs";
import { writeArchive } from "./distribution/archive.mjs";
import { runCommand } from "./distribution/command.mjs";
import { descriptor, limits, nodeRange, platform } from "./distribution/descriptor.mjs";
import { inventory, inventoryDirectories, notices, pruneNative } from "./distribution/policy.mjs";

const execute = promisify(execFile);
export async function packagePayload(root, { signal } = {}) {
  const target = platform();
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const lock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
  if (lock.version !== manifest.version || lock.packages[""].version !== manifest.version)
    throw new Error("Package/lockfile version mismatch");
  const commit = (await execute("git", ["rev-parse", "HEAD"], { cwd: root, signal })).stdout.trim();
  const dirty = Boolean(
    (
      await execute("git", ["status", "--porcelain", "--untracked-files=normal"], {
        cwd: root,
        signal,
      })
    ).stdout.trim(),
  );
  const temporary = await mkdtemp(join(tmpdir(), "code60-payload-build-"));
  const application = join(temporary, "application");
  const output = join(root, "release/payloads");
  try {
    await mkdir(application);
    const home = join(temporary, "home");
    await mkdir(home);
    const env = {
      PATH: process.env.PATH,
      HOME: home,
      TMPDIR: temporary,
      NPM_CONFIG_USERCONFIG: "/dev/null",
      NPM_CONFIG_GLOBALCONFIG: join(home, "empty-global-npmrc"),
      NPM_CONFIG_CACHE: join(home, "npm-cache"),
      NPM_CONFIG_REGISTRY: "https://registry.npmjs.org/",
    };
    for (const name of ["package.json", "package-lock.json"])
      await cp(join(root, name), join(application, name));
    await execute("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
      cwd: application,
      signal,
      env,
      timeout: 180_000,
      maxBuffer: 8 * 1024 ** 2,
    });
    for (const name of ["dist", "models", "mcp.default.json", "LICENSE", "NOTICE", "TRADEMARKS.md"])
      await cp(join(root, name), join(application, name), { recursive: true });
    // Fresh target dependencies are the notice source, never the host's tree.
    await rm(join(application, "dist/licenses/dependencies"), { recursive: true, force: true });
    await pruneNative(join(application, "node_modules"), process.platform, process.arch);
    await notices(
      join(application, "node_modules"),
      join(application, "dist/licenses/dependencies"),
    );
    const { stdout } = await execute("npm", ["ls", "--omit=dev", "--all", "--json"], {
      cwd: application,
      signal,
      env,
      timeout: 30_000,
      maxBuffer: 8 * 1024 ** 2,
    });
    const dependencies = JSON.parse(stdout);
    delete dependencies.path;
    await writeFile(
      join(application, "production-dependencies.json"),
      `${JSON.stringify(dependencies, null, 2)}\n`,
    );
    await execute(
      process.execPath,
      [join(root, "scripts/distribution/probe-native.mjs"), application],
      { cwd: temporary, env, signal, timeout: 120_000, maxBuffer: 2 * 1024 ** 2 },
    );
    const runtime = { node: nodeRange, libc: process.platform === "linux" ? "glibc" : null };
    let transmissionBundle;
    {
      const bundles = await readdir(join(application, "dist/engines"));
      if (bundles.length !== 1 || !/^[a-f0-9]{64}$/.test(bundles[0]))
        throw Error("Platform payload requires its verified Transmission bundle");
      transmissionBundle = bundles[0];
    }
    const metadata = {
      schemaVersion: 1,
      version: manifest.version,
      commit,
      dirty,
      os: process.platform,
      arch: process.arch,
      runtime,
      builtWithNode: process.version,
      lockfileSha256: await sha256(join(application, "package-lock.json")),
      ...(transmissionBundle ? { transmissionBundle } : {}),
      files: await inventory(application),
      directories: await inventoryDirectories(application),
    };
    await writeFile(join(application, "payload.json"), `${JSON.stringify(metadata, null, 2)}\n`);
    const name = `code60-${manifest.version}-${target}.tar.gz`;
    const archive = join(temporary, name);
    await writeArchive(application, archive, { signal });
    const size = (await stat(archive)).size;
    if (size > limits.download) throw new Error("Built payload exceeds archive size limit");
    const value = descriptor({
      schemaVersion: 1,
      version: manifest.version,
      commit,
      dirty,
      os: process.platform,
      arch: process.arch,
      runtime,
      archive: {
        name,
        size,
        sha256: await sha256(archive),
        url: `https://github.com/CodeManufactoryLLC/Code60/releases/download/v${manifest.version}/${name}`,
      },
    });
    await mkdir(output, { recursive: true });
    // Copy before rename: temporary and checkout may reside on different filesystems.
    await cp(archive, join(output, `${name}.staging`));
    await rename(join(output, `${name}.staging`), join(output, name));
    await writeFile(join(output, `${target}.json`), `${JSON.stringify(value, null, 2)}\n`);
    console.log(`Payload built: ${join(output, name)} (${size} bytes, ${value.archive.sha256})`);
    return value;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCommand(async (signal) => {
    if (process.argv.length !== 2)
      throw new Error("Use npm run package:payload (executing platform only)");
    await packagePayload(fileURLToPath(new URL("..", import.meta.url)), { signal });
  });
}
