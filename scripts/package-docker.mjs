import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { cp, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { acquirePayload } from "./distribution/acquire.mjs";
import { runCommand } from "./distribution/command.mjs";
import { descriptor } from "./distribution/descriptor.mjs";
import { DEFAULT_DOCKERHUB_REPOSITORY } from "./release/docker-tags.mjs";

const execute = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const LINUX_X64_HOST = {
  platform: "linux",
  arch: "x64",
  versions: { node: "24.22.0" },
  report: { getReport: () => ({ header: { glibcVersionRuntime: "2.36" } }) },
};

export function parsePackageDockerArgs(args, cwd = repositoryRoot) {
  let descriptorPath;
  let stageOnly;
  let requireClean = false;
  const tags = [];
  const labels = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--stage-only") {
      stageOnly = args[++i];
      if (!stageOnly) throw new Error("--stage-only requires a destination directory.");
    } else if (arg === "--tag") {
      const value = args[++i];
      if (!value) throw new Error("--tag requires an image reference.");
      tags.push(value);
    } else if (arg === "--label") {
      const value = args[++i];
      if (!value?.includes("=")) throw new Error("--label requires key=value.");
      labels.push(value);
    } else if (arg === "--require-clean") {
      requireClean = true;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (!descriptorPath) {
      descriptorPath = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  return {
    descriptorPath: resolve(cwd, descriptorPath ?? "release/payloads/linux-x64.json"),
    stageOnly: stageOnly ? resolve(cwd, stageOnly) : undefined,
    requireClean,
    tags,
    labels,
  };
}

export async function stageDockerContext(
  descriptorPath,
  destination,
  { requireClean = false, signal } = {},
) {
  const raw = JSON.parse(await readFile(descriptorPath, "utf8"));
  const expected = descriptor(raw);
  if (expected.os !== "linux" || expected.arch !== "x64")
    throw new Error(
      `Docker packaging requires a linux-x64 payload descriptor (got ${expected.os}-${expected.arch}).`,
    );
  if (requireClean && expected.dirty)
    throw new Error("Refusing to stage a dirty payload for Docker release.");

  const archivePath = join(dirname(descriptorPath), expected.archive.name);
  const archiveInfo = await lstat(archivePath).catch(() => null);
  if (!archiveInfo?.isFile())
    throw new Error(`Payload archive not found beside descriptor: ${archivePath}`);

  await mkdir(destination, { recursive: true });
  const canonicalDestination = await realpath(destination);
  const acquired = await acquirePayload(expected, {
    parent: canonicalDestination,
    host: LINUX_X64_HOST,
    signal,
    transport: async () => createReadStream(archivePath),
  });

  try {
    for (const required of ["dist/gateway/container.js", "dist/platform/code60-pty"]) {
      const info = await lstat(join(acquired.root, required)).catch(() => null);
      if (!info?.isFile())
        throw new Error(`Required container runtime asset missing in payload: ${required}`);
    }
    const payloadTarget = join(canonicalDestination, "payload");
    await rm(payloadTarget, { recursive: true, force: true });
    await rename(acquired.root, payloadTarget);
    await cp(
      join(repositoryRoot, "docker", "Dockerfile"),
      join(canonicalDestination, "Dockerfile"),
    );
  } finally {
    await rm(acquired.owned, { recursive: true, force: true });
  }

  return {
    stageDir: canonicalDestination,
    descriptor: expected,
    version: expected.version,
    commit: expected.commit,
    sha256: expected.archive.sha256,
  };
}

export async function packageDockerImage(options, { signal } = {}) {
  if (options.stageOnly) {
    const staged = await stageDockerContext(options.descriptorPath, options.stageOnly, {
      requireClean: options.requireClean,
      signal,
    });
    console.log(
      `Docker build context staged: ${staged.stageDir} (v${staged.version}, ${staged.sha256})`,
    );
    return staged;
  }

  const temporary = await mkdtemp(join(tmpdir(), "code60-docker-build-"));
  try {
    const staged = await stageDockerContext(options.descriptorPath, temporary, {
      requireClean: options.requireClean,
      signal,
    });
    const tags = options.tags.length
      ? options.tags
      : [`${DEFAULT_DOCKERHUB_REPOSITORY}:${staged.version}`];
    const buildArgs = [
      "build",
      "--platform",
      "linux/amd64",
      "--file",
      join(staged.stageDir, "Dockerfile"),
      "--build-arg",
      `CODE60_VERSION=${staged.version}`,
      "--build-arg",
      `CODE60_REVISION=${staged.commit}`,
      "--build-arg",
      `CODE60_CREATED=${new Date().toISOString()}`,
    ];
    for (const tag of tags) buildArgs.push("--tag", tag);
    for (const label of options.labels) buildArgs.push("--label", label);
    buildArgs.push(staged.stageDir);

    await execute("docker", buildArgs, {
      signal,
      timeout: 600_000,
      maxBuffer: 16 * 1024 ** 2,
    });
    console.log(`Docker image built: ${tags.join(", ")} (payload ${staged.sha256})`);
    return { ...staged, tags };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCommand(async (signal) => {
    const options = parsePackageDockerArgs(process.argv.slice(2));
    await packageDockerImage(options, { signal });
  });
}
