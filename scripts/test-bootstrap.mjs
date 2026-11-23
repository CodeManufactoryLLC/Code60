import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { extractArchive } from "./distribution/archive.mjs";
import { runCommand } from "./distribution/command.mjs";

const execute = promisify(execFile);
const repository = fileURLToPath(new URL("..", import.meta.url));
await runCommand(async (signal) => {
  if (process.argv.length !== 2)
    throw new Error("Use npm run test:bootstrap after assembling both payloads");
  const manifest = JSON.parse(await readFile(join(repository, "package.json"), "utf8"));
  const archive = join(repository, "release/bootstrap", `code60-${manifest.version}.tgz`);
  assert.ok((await stat(archive)).size < 1024 ** 2);
  const temporary = await realpath(await mkdtemp(join(tmpdir(), "code60 bootstrap acceptance ")));
  try {
    const entries = await extractArchive(
      archive,
      join(temporary, "unpacked"),
      join(temporary, "bootstrap.tar"),
      { signal },
    );
    assert.ok(
      entries.every(
        (entry) =>
          /^package\/(?:bin\/code60\.mjs|lib\/(?:index|acquire|archive|descriptor)\.mjs|package\.json|platforms\.json|LICENSE|NOTICE|TRADEMARKS\.md)$/.test(
            entry.path,
          ) || /^package\/lib\/runtime\/(?:management|platform)\/[a-z-]+\.js$/.test(entry.path),
      ),
    );
    const root = join(temporary, "unpacked/package");
    const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    assert.equal(packageJson.private, true);
    assert.equal(packageJson.dependencies, undefined);
    assert.equal(packageJson.scripts, undefined);
    const env = { PATH: "/usr/bin:/bin", HOME: temporary };
    for (const flag of ["--help", "--version"])
      await execute(process.execPath, [join(root, "bin/code60.mjs"), flag], {
        env,
        cwd: temporary,
        signal,
        timeout: 10_000,
      });
    const { stagePayload, installPayload } = await import(
      pathToFileURL(join(root, "lib/index.mjs")).href
    );
    const staged = await stagePayload({
      parent: temporary,
      signal,
      transport: (url) =>
        createReadStream(join(repository, "release/payloads", basename(new URL(url).pathname))),
    });
    await execute(process.execPath, [join(staged.root, "dist/management/main.js"), "--help"], {
      env,
      cwd: temporary,
      signal,
      timeout: 10_000,
    });
    const probe = await execute(
      process.execPath,
      [join(repository, "scripts/distribution/probe-native.mjs"), staged.root],
      { env, cwd: temporary, signal, timeout: 120_000, maxBuffer: 1024 ** 2 },
    );
    const home = join(temporary, "managed-home");
    await mkdir(home, { mode: 0o700 });
    const managedEnv = { ...env, HOME: home, SHELL: "/bin/bash" };
    const managed = await installPayload({
      env: managedEnv,
      signal,
      acquisition: {
        transport: (url) =>
          createReadStream(join(repository, "release/payloads", basename(new URL(url).pathname))),
      },
    });
    await rm(join(temporary, "unpacked"), { recursive: true });
    const persistent = await execute(managed.launcher, ["--help"], {
      env: managedEnv,
      cwd: "/",
      signal,
      timeout: 15000,
    });
    assert.match(persistent.stdout, /code60 service/);
    await execute(
      process.execPath,
      [join(repository, "scripts/distribution/probe-native.mjs"), managed.release],
      { env: managedEnv, cwd: "/", signal, timeout: 120000, maxBuffer: 1024 ** 2 },
    );
    const output = join(repository, "test-results/bootstrap", `${Date.now()}-${process.pid}`);
    await mkdir(output, { recursive: true, mode: 0o700 });
    await writeFile(
      join(output, "result.json"),
      JSON.stringify(
        {
          bootstrapVersion: packageJson.version,
          descriptor: staged.descriptor,
          help: true,
          setupSupported: true,
          noDependencies: true,
          persistentLauncher: true,
          bootstrapCacheRemoved: true,
          model: probe.stdout.trim(),
        },
        null,
        2,
      ),
    );
    console.log(`Packed bootstrap and embedded-descriptor staging passed: ${output}`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
