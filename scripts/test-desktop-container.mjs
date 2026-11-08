import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = fileURLToPath(new URL("..", import.meta.url));

/** Run Docker without a shell, bounding both commands and cancellation. */
function execute(file, args, { cwd, env, timeout, signal, capture = false }) {
  return new Promise((resolveCommand, reject) => {
    if (signal?.aborted) {
      reject(new Error("Container run cancelled"));
      return;
    }
    const child = spawn(file, args, {
      cwd,
      env,
      stdio: ["ignore", capture ? "pipe" : "inherit", "inherit"],
    });
    let output = "";
    let failure;
    let killTimer;
    const stop = (message) => {
      if (failure) return;
      failure = new Error(message);
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 1_000);
    };
    const abort = () => stop("Container run cancelled");
    const timer = setTimeout(() => stop(`Docker ${args[0]} timed out`), timeout);
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout?.on("data", (chunk) => {
      output += chunk;
      if (output.length > 64 * 1024) stop("Docker output exceeded 64 KiB");
    });
    child.once("error", (error) => {
      failure = error;
    });
    child.once("close", (code, exitSignal) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal?.removeEventListener("abort", abort);
      if (failure) reject(failure);
      else if (code !== 0)
        reject(
          Object.assign(new Error(`Docker ${args[0]} failed (${exitSignal ?? code})`), {
            exitCode: code || 1,
          }),
        );
      else resolveCommand(output.trim());
    });
  });
}

/** Options inject only host dependencies for tests; the CLI always uses Docker. */
export async function runDesktopContainer(
  args,
  {
    root = repository,
    docker = "docker",
    dockerArgs = [],
    env = process.env,
    signals = process,
    log = console.error,
    preflightTimeout = 10_000,
    cleanupTimeout = 10_000,
  } = {},
) {
  const controller = new AbortController();
  const name = `code60-desktop-${randomUUID()}`;
  const imageTag = `code60-desktop-test:${name}`;
  let interrupted = 0;
  let created = false;
  let buildAttempted = false;
  let temporary;
  let status = 0;
  const interrupt = (code) => {
    interrupted ||= code;
    controller.abort();
  };
  const sigint = () => interrupt(130);
  const sigterm = () => interrupt(143);
  signals.on("SIGINT", sigint);
  signals.on("SIGTERM", sigterm);
  const command = (parameters, options = {}) =>
    execute(docker, [...dockerArgs, ...parameters], {
      cwd: root,
      env,
      timeout: 20 * 60_000,
      signal: controller.signal,
      ...options,
    });
  try {
    let platform;
    try {
      platform = await command(["info", "--format", "{{.OSType}}/{{.Architecture}}"], {
        capture: true,
        timeout: preflightTimeout,
      });
    } catch (error) {
      if (interrupted) throw error;
      throw new Error(
        error.code === "ENOENT"
          ? "Docker was not found. Install Docker Desktop and start its Linux engine."
          : "Docker is unavailable or did not respond within 10 seconds. Start or repair Docker Desktop, then check `docker info` in the active context.",
        { cause: error },
      );
    }
    const nativePlatform = {
      "linux/aarch64": "linux/arm64",
      "linux/arm64": "linux/arm64",
      "linux/x86_64": "linux/amd64",
      "linux/amd64": "linux/amd64",
    }[platform];
    if (!nativePlatform) throw new Error(`Expected a Linux ARM64 or x64 engine; got ${platform}`);

    temporary = await mkdtemp(join(tmpdir(), "code60-container-"));
    const imageFile = join(temporary, "image-id");
    log(`Building desktop test image for ${nativePlatform}...`);
    buildAttempted = true;
    await command([
      "build",
      "--platform",
      nativePlatform,
      "--file",
      join(root, "scripts/desktop-container/Dockerfile"),
      "--iidfile",
      imageFile,
      "--tag",
      imageTag,
      "--label",
      `com.code60.test-run=${name}`,
      "--provenance=false",
      "--load",
      root,
    ]);
    const image = (await readFile(imageFile, "utf8")).trim();
    if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error("Docker did not return an image ID");
    const results = join(root, "test-results/container");
    await mkdir(results, { recursive: true });
    const artifacts = await mkdtemp(
      join(results, `${new Date().toISOString().replaceAll(":", "-")}-`),
    );
    // Only this new artifact directory is writable by the container's non-root UID.
    await chmod(artifacts, 0o777);
    log(`Container artifacts: ${artifacts}`);
    // Docker --mount uses CSV fields, including for paths containing commas/quotes.
    const source = `"source=${artifacts.replaceAll('"', '""')}"`;
    controller.signal.throwIfAborted();
    created = true;
    // Finish create before cancellation cleanup so a late creation cannot escape removal.
    await command(
      [
        "create",
        "--name",
        name,
        "--platform",
        nativePlatform,
        "--init",
        "--user",
        "node",
        "--shm-size=1g",
        "--security-opt",
        `seccomp=${join(root, "scripts/desktop-container/seccomp.json")}`,
        "--mount",
        `type=bind,${source},target=/workspace/test-results`,
        imageTag,
        ...args,
      ],
      { capture: true, signal: undefined, timeout: 30_000 },
    );
    await command(["start", "--attach", name]);
  } catch (error) {
    if (!interrupted) log(error.message);
    status = error.exitCode || 1;
  } finally {
    const cleanup = { signal: undefined, timeout: cleanupTimeout, capture: true };
    if (created) {
      if (interrupted || status) {
        await command(["stop", "--time", "5", name], cleanup).catch((error) => {
          log(`Container stop: ${error.message}`);
        });
      }
      await command(["rm", "--force", name], cleanup).catch((error) => {
        log(`Could not remove ${name}: ${error.message}. Retry: docker rm --force ${name}`);
        status ||= 1;
      });
    }
    if (buildAttempted) {
      // Inspect the owned tag even after a failed/cancelled export: iidfile may be absent.
      // A unique final-image label prevents concurrent runs from sharing that image.
      try {
        const exported = await command(
          ["image", "ls", "--all", "--quiet", "--filter", `reference=${imageTag}`],
          cleanup,
        );
        if (exported) {
          await command(["image", "rm", "--no-prune", imageTag], cleanup);
          log(`Removed test image ${imageTag}; BuildKit cache and host artifacts retained.`);
        }
      } catch (error) {
        log(
          `Could not clean up ${imageTag}: ${error.message}. Retry: docker image rm --no-prune ${imageTag}`,
        );
        status ||= 1;
      }
    }
    try {
      if (temporary) await rm(temporary, { recursive: true, force: true });
    } finally {
      signals.off("SIGINT", sigint);
      signals.off("SIGTERM", sigterm);
    }
  }
  return interrupted || status;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runDesktopContainer(process.argv.slice(2)).then(
    (status) => {
      process.exitCode = status;
    },
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    },
  );
}
