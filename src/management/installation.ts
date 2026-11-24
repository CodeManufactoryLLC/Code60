import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, realpath, rename, unlink } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createInstallationParents,
  exclusiveInstallationLink,
  executableInstallationFile,
  installationDirectory,
  installationFileCode,
  installationLink,
  installationTreeIdentity,
  lockInstallation,
  preserveTransmissionBundle,
  publishInstallationLink,
  removeInstallationTree,
  resolveTransmissionRuntime,
  syncInstallationDirectory,
  verifyInstallationNode,
  writeInstallationFile,
} from "../platform/index.js";
import {
  type ActivationRecord,
  type ArtifactIdentity,
  currentInstallation,
  type InstallationRecord,
  installationDigest,
  installationPaths,
  readActivation,
  readInstallation,
  shellQuote,
  supportedInstallationRuntime,
} from "./install-state.js";

interface InstallationArtifact {
  identity: ArtifactIdentity;
  acquire(options: {
    parent: string;
    signal?: AbortSignal;
  }): Promise<{ root: string; owned: string }>;
}
export interface InstallationOptions {
  artifact: InstallationArtifact;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  repair?: boolean;
  runtimeDirectory?: string;
  bootstrapEntry?: string;
  checkpoint?: (phase: "prepared" | "published") => Promise<void>;
}
async function verifyCommandPath(
  record: InstallationRecord,
  env: NodeJS.ProcessEnv,
  bootstrapEntry?: string,
) {
  const expected = join(record.root, "current/code60");
  const existing = await installationLink(record.launcher);
  if (existing !== null && existing !== expected)
    throw new Error("Unrelated launcher exists; it was preserved");
  for (const directory of (env.PATH ?? "").split(":")) {
    const command = resolve(directory || process.cwd(), "code60");
    const info = await lstat(command).catch((error: unknown) => {
      if (installationFileCode(error) !== "ENOENT") throw error;
      return null;
    });
    if (!info) continue;
    if (command === record.launcher && existing === expected) return;
    const canonical = await realpath(command);
    if (bootstrapEntry && canonical === (await realpath(bootstrapEntry).catch(() => null)))
      continue;
    const executable = await lstat(canonical).catch(() => null);
    if (executable?.isFile() && executable.mode & 0o111)
      throw new Error(
        `A conflicting code60 command exists at ${command}; no activation was performed`,
      );
  }
}
async function copyRuntime(source: string, target: string) {
  const files: Record<string, string> = {};
  for (const module of ["management", "platform"]) {
    await mkdir(join(target, module));
    for (const name of (await readdir(join(source, module))).sort()) {
      if (!name.endsWith(".js")) continue;
      if (module === "management" && !["installed-launcher.js", "install-state.js"].includes(name))
        continue;
      const path = join(source, module, name);
      const text = await readFile(path, "utf8");
      await writeInstallationFile(join(target, module, name), text, null);
      files[`${module}/${name}`] = installationDigest(text);
    }
  }
  if (!files["management/installed-launcher.js"] || !files["management/install-state.js"])
    throw new Error("Launcher support build is incomplete");
  return files;
}

async function preserveEngines(application: string, env: NodeJS.ProcessEnv, signal?: AbortSignal) {
  const metadata = JSON.parse(await readFile(join(application, "payload.json"), "utf8"));
  // Legacy tarballs and synthetic installation fixtures have no payload engine
  // declaration. Current macOS payloads must declare it in artifact validation.
  if (metadata.transmissionBundle === undefined) return;
  if (process.platform !== "darwin" || !/^[a-f0-9]{64}$/.test(metadata.transmissionBundle))
    throw Error("Unsupported installation engine bundle");
  await preserveTransmissionBundle(
    join(application, "dist/engines", metadata.transmissionBundle),
    env,
    signal,
  );
}

export async function installManagedRelease(options: InstallationOptions) {
  supportedInstallationRuntime();
  const env = options.env ?? process.env;
  const paths = await installationPaths(env);
  const identity = options.artifact.identity;
  if (
    !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(identity.version) ||
    `${identity.os}-${identity.arch}` !== `${process.platform}-${process.arch}` ||
    !/^[a-f0-9]{64}$/.test(identity.archive.sha256)
  )
    throw new Error("Invalid installation artifact identity");
  await createInstallationParents(paths.root, true);
  await createInstallationParents(paths.bin);
  const binInfo = await lstat(paths.bin);
  if (binInfo.uid !== process.getuid?.() || (binInfo.mode & 0o300) !== 0o300)
    throw new Error("Launcher directory is not safely writable");
  const releaseLock = await lockInstallation(paths.root);
  const created: { path: string; identity: { dev: string; ino: string } }[] = [];
  let published = false;
  let uncertain = false;
  let launcherCreated = false;
  let result: { root: string; launcher: string; release: string; reused: boolean } | undefined;
  let failure: unknown;
  try {
    options.signal?.throwIfAborted();
    let record = await readInstallation(paths);
    const initial = !record;
    record ??= { ...paths, schema: 1, id: randomUUID() };
    if (initial) {
      const contents = (await readdir(paths.root)).filter((name) => name !== ".install-lock");
      if (contents.length) {
        if (contents.length !== 1 || contents[0] !== "engines" || process.platform !== "darwin")
          throw new Error("Installation directory contains unowned files; preserved contents");
        // Recognize only our own prior source-development cache. No migration
        // or ownership claim is made over unrelated files or legacy npm state.
        await installationDirectory(join(paths.root, "engines"), false, true);
        let verified = false;
        for (const version of ["0.1.0-staging.18", "0.1.0-staging.20"] as const) {
          try {
            await resolveTransmissionRuntime(env, version, options.signal);
            verified = true;
          } catch (error) {
            if (installationFileCode(error) !== "CODE60_ENGINE_UNAVAILABLE") throw error;
          }
        }
        if (!verified && (await readdir(join(paths.root, "engines"))).length)
          throw Error("Engine cache ownership is uncertain; preserved existing files");
      }
    }
    if (initial && (await installationLink(record.launcher)) !== null)
      throw new Error("Launcher ownership is unknown; existing command preserved");
    await verifyCommandPath(record, env, options.bootstrapEntry);
    if (initial)
      await writeInstallationFile(
        join(paths.root, "installation.json"),
        JSON.stringify(record),
        null,
      );
    const current = await currentInstallation(record, !options.repair);
    if (current) {
      if (
        current.receipt.release.version !== identity.version ||
        current.receipt.release.archive.sha256 !== identity.archive.sha256
      )
        throw new Error("A different release is installed; implicit updates are unavailable");
      if (!options.repair && (await installationLink(record.launcher))) {
        if ((await verifyInstallationNode()) !== current.receipt.node.path)
          throw new Error("Installed Node binding differs; explicit repair is required");
        await preserveEngines(current.receipt.release.path, env, options.signal);
        result = {
          root: paths.root,
          launcher: paths.launcher,
          release: current.receipt.release.path,
          reused: true,
        };
      }
    }
    if (!result) {
      for (const name of ["releases", "activations", ".staging"])
        await createInstallationParents(join(paths.root, name), true);
      let application = current?.receipt.release.path;
      if (!application) {
        const candidate = await options.artifact.acquire({
          parent: join(paths.root, ".staging"),
          ...(options.signal ? { signal: options.signal } : {}),
        });
        if (
          relative(join(paths.root, ".staging"), candidate.owned).startsWith("..") ||
          candidate.root !== join(candidate.owned, "application")
        )
          throw new Error("Acquisition escaped owned staging");
        const acquiredIdentity = await installationTreeIdentity(candidate.owned);
        created.push({ path: candidate.owned, identity: acquiredIdentity });
        application = join(paths.root, "releases", identity.archive.sha256);
        if (
          await lstat(application).catch((error: unknown) => {
            if (installationFileCode(error) !== "ENOENT") throw error;
            return null;
          })
        )
          throw new Error("Release destination already exists without active ownership");
        await rename(candidate.root, application);
        created.push({ path: application, identity: await installationTreeIdentity(application) });
      }
      const generation = randomUUID();
      await preserveEngines(application, env, options.signal);
      const directory = join(paths.root, "activations", generation);
      await mkdir(directory, { mode: 0o700 });
      created.push({ path: directory, identity: await installationTreeIdentity(directory) });
      await mkdir(join(directory, "runtime"), { mode: 0o700 });
      await writeInstallationFile(
        join(directory, "runtime/package.json"),
        '{"type":"module"}',
        null,
      );
      const runtimeFiles = await copyRuntime(
        options.runtimeDirectory ?? fileURLToPath(new URL("../", import.meta.url)),
        join(directory, "runtime"),
      );
      const node = await verifyInstallationNode();
      const contents = `#!/bin/sh\nunset NODE_OPTIONS NODE_PATH\nif [ ! -x ${shellQuote(node)} ]; then printf '%s\\n' 'Recorded Node is unavailable; reconcile Code60 using supported Node.' >&2; exit 1; fi\nexec ${shellQuote(node)} ${shellQuote(join(directory, "runtime/management/installed-launcher.js"))} "$@"\n`;
      const receipt: ActivationRecord = {
        schema: 1,
        installationId: record.id,
        generation,
        release: {
          ...identity,
          path: application,
          manifestHash: installationDigest(await readFile(join(application, "payload.json"))),
        },
        node: { path: node, version: process.version },
        runtimeFiles,
        launcherHash: installationDigest(contents),
      };
      await executableInstallationFile(join(directory, "code60"), contents);
      await writeInstallationFile(join(directory, "receipt.json"), JSON.stringify(receipt), null);
      await readActivation(record, `activations/${generation}`);
      await syncInstallationDirectory(directory);
      await options.checkpoint?.("prepared");
      options.signal?.throwIfAborted();
      if ((await installationLink(record.launcher)) === null) {
        await exclusiveInstallationLink(record.launcher, join(paths.root, "current/code60"));
        launcherCreated = true;
      }
      try {
        await publishInstallationLink(
          join(paths.root, "current"),
          `activations/${generation}`,
          current?.target ?? null,
        );
      } catch (error) {
        try {
          const observed = await installationLink(join(paths.root, "current"));
          published = observed === `activations/${generation}`;
          uncertain = !published && observed !== (current?.target ?? null);
        } catch {
          uncertain = true;
        }
        throw error;
      }
      published = true;
      result = { root: paths.root, launcher: paths.launcher, release: application, reused: false };
      await options.checkpoint?.("published");
      options.signal?.throwIfAborted();
    }
  } catch (error) {
    failure = error;
  } finally {
    const errors: unknown[] = [];
    for (const item of [...created].reverse()) {
      if ((published || uncertain) && !item.path.includes("/.staging/")) continue;
      try {
        await removeInstallationTree(item.path, item.identity);
      } catch (error) {
        errors.push(error);
      }
    }
    if (launcherCreated && !published && !uncertain) {
      try {
        if ((await installationLink(paths.launcher)) !== join(paths.root, "current/code60"))
          errors.push(new Error("Launcher cleanup ownership changed"));
        else await unlink(paths.launcher);
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      await releaseLock();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length)
      failure = new AggregateError(
        [...(failure ? [failure] : []), ...errors],
        `Installation cleanup failed; activation ${published ? "was published and preserved" : "was not published"}`,
      );
  }
  if (failure) {
    if (published || uncertain)
      throw Object.assign(
        new Error(
          `${published ? "Activation was published" : "Activation is uncertain"} and preserved: ${failure instanceof Error ? failure.message : "installation failed"}`,
          { cause: failure },
        ),
        { activationPublished: published, activationUncertain: uncertain },
      );
    throw failure;
  }
  return result as NonNullable<typeof result>;
}
