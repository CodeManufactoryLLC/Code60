import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const repository = fileURLToPath(new URL("..", import.meta.url));
const label = "com.code60.devcontainer";
const cacheTargets = {
  dependencies: "node_modules",
  build: "dist",
  npm: "/home/node/.npm",
  browsers: "/home/node/.cache/ms-playwright",
  models: "models",
};

export function containerConfiguration(root, common, uid = 1000, gid = 1000) {
  const id = createHash("sha256").update(root).digest("hex").slice(0, 16);
  const project = `code60-dev-${id}`;
  const labels = { [label]: id };
  const caches = Object.keys(cacheTargets);
  const cacheVolumes = caches.map((name) => ({
    type: "volume",
    source: name,
    target: cacheTargets[name].startsWith("/")
      ? cacheTargets[name]
      : join(root, cacheTargets[name]),
    volume: { nocopy: true },
  }));
  const mounts = [{ type: "bind", source: root, target: root }];
  if (common !== join(root, ".git")) mounts.push({ type: "bind", source: common, target: common });
  const image = `${project}:local`;
  const build = { context: join(root, ".devcontainer"), args: { CODE60_WORKSPACE_ID: id } };
  return {
    id,
    compose: {
      name: project,
      services: {
        "cache-init": {
          image,
          platform: "linux/amd64",
          user: "0:0",
          network_mode: "none",
          labels,
          command: ["node", "/usr/local/lib/code60/init-volumes.mjs", String(uid), String(gid)],
          volumes: caches.map((name) => ({
            type: "volume",
            source: name,
            target: `/cache/${name}`,
            volume: { nocopy: true },
          })),
        },
        code60: {
          image,
          build,
          platform: "linux/amd64",
          user: `${uid}:${gid}`,
          working_dir: root,
          network_mode: "bridge",
          labels,
          depends_on: { "cache-init": { condition: "service_completed_successfully" } },
          environment: {
            HOME: "/home/node",
            SHELL: "/bin/bash",
            CODE60_DEV_GATEWAY_PORT: "43160",
            CODE60_VITE_PORT: "43161",
            PLAYWRIGHT_BROWSERS_PATH: cacheTargets.browsers,
            GIT_CONFIG_GLOBAL: "/dev/null",
            GIT_TERMINAL_PROMPT: "0",
            VITEST_MAX_WORKERS: "2",
            SSH_AUTH_SOCK: "",
            GPG_AGENT_INFO: "",
          },
          volumes: [...mounts, ...cacheVolumes],
        },
      },
      volumes: Object.fromEntries(
        caches.map((name) => [
          name,
          { name: `${project}-${name}`, labels: { ...labels, "com.code60.kind": "cache" } },
        ]),
      ),
    },
  };
}

async function run(
  file,
  args,
  { cwd, inherit = false, signal, timeout = inherit ? 30 * 60_000 : 30_000 } = {},
) {
  signal?.throwIfAborted();
  const env = { ...process.env };
  for (const key of ["SSH_AUTH_SOCK", "GPG_AGENT_INFO", "GIT_ASKPASS"]) delete env[key];
  if (!inherit)
    return (await execute(file, args, { cwd, env, signal, timeout, maxBuffer: 1024 * 1024 }))
      .stdout;
  await new Promise((resolveRun, reject) => {
    const grouped = process.platform !== "win32";
    const child = spawn(file, args, { cwd, env, detached: grouped, stdio: "inherit" });
    let escalation;
    let interrupted = false;
    const kill = (kind) => {
      if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
      try {
        if (grouped) process.kill(-child.pid, kind);
        else child.kill(kind);
      } catch (error) {
        if (error.code !== "ESRCH") reject(error);
      }
    };
    const terminate = () => {
      interrupted = true;
      kill("SIGTERM");
      escalation ??= setTimeout(() => kill("SIGKILL"), 5000);
    };
    const deadline = timeout === 0 ? undefined : setTimeout(terminate, timeout);
    signal?.addEventListener("abort", terminate, { once: true });
    if (signal?.aborted) terminate();
    const clear = () => {
      clearTimeout(deadline);
      clearTimeout(escalation);
      signal?.removeEventListener("abort", terminate);
    };
    child.once("error", (error) => {
      clear();
      reject(error);
    });
    child.once("exit", (code, exitSignal) => {
      clear();
      if (code === 0 && !interrupted) resolveRun();
      else
        reject(
          Object.assign(new Error(`Container command failed (${exitSignal ?? code}).`), {
            interrupted: interrupted || code === 130 || code === 143 || exitSignal !== null,
            exitCode: code || (exitSignal === "SIGINT" ? 130 : exitSignal === "SIGTERM" ? 143 : 1),
          }),
        );
    });
  });
  return "";
}

async function save(file, value) {
  await mkdir(join(file, ".."), { recursive: true });
  if ((await realpath(join(file, ".."))) !== resolve(file, ".."))
    throw new Error("Refusing a symlink-redirected container configuration directory.");
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  try {
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function manageContainer(directory, action, args = [], ports = {}) {
  if (!["prepare", "up", "exec", "down"].includes(action) || (action !== "exec" && args.length))
    throw new Error("Use devcontainer prepare|up|exec <command> [args...]|down.");
  if (action === "exec" && !args.length) throw new Error("Supply a command after exec.");
  const invoke = ports.run ?? run;
  const root = await realpath(directory);
  const git = async (...argv) => (await invoke("git", ["-C", root, ...argv])).replace(/\r?\n$/, "");
  if ((await realpath(await git("rev-parse", "--show-toplevel"))) !== root)
    throw new Error("Run devcontainer management at the checkout root.");
  const common = await realpath(
    await git("rev-parse", "--path-format=absolute", "--git-common-dir"),
  );
  const uid = process.platform === "linux" ? process.getuid() || 1000 : 1000;
  const gid = process.platform === "linux" ? process.getgid() : 1000;
  const { id, compose } = containerConfiguration(root, common, uid, gid);
  const local = join(root, ".devcontainer/local");
  const cli = fileURLToPath(import.meta.resolve("@devcontainers/cli/devcontainer.js"));
  const cliArgs = [
    "--workspace-folder",
    root,
    "--config",
    join(root, ".devcontainer/devcontainer.json"),
  ];
  const write = ports.write ?? ((message) => process.stdout.write(message));

  if (action === "prepare") {
    await save(join(local, "compose.json"), compose);
    await save(join(local, "editor-profile/User/settings.json"), {
      "dev.containers.copyGitConfig": false,
      "dev.containers.gitCredentialHelperConfigLocation": "none",
      "remote.localPortHost": "localhost",
    });
    write(`Prepared ${root}\nSee .devcontainer/README.md for the isolated editor launch.\n`);
    return;
  }

  try {
    if (
      (await invoke("docker", ["info", "--format", "{{.OSType}}"], { timeout: 5000 })).trim() !==
      "linux"
    )
      throw new Error("A Linux Docker engine is required.");
  } catch {
    throw new Error(
      "Docker is unavailable. Start Docker Desktop or the Docker daemon, then retry.",
    );
  }

  const list = async (kind) =>
    (
      await invoke("docker", [
        kind,
        "ls",
        ...(kind === "container" ? ["--all"] : []),
        "--quiet",
        "--filter",
        `label=${label}=${id}`,
      ])
    )
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  const cleanup = async () => {
    const failures = [];
    for (const container of await list("container")) {
      try {
        await invoke("docker", ["stop", "--time", "30", container], { timeout: 45_000 });
        await invoke("docker", ["rm", container]);
      } catch (error) {
        failures.push(error);
      }
    }
    // UID-adjusted editor images can reference the base image. Retry parents
    // only after a child was removed; never force shared-image removal.
    let images = [...new Set(await list("image"))];
    while (images.length) {
      const remaining = [];
      for (const image of images) {
        try {
          await invoke("docker", ["image", "rm", image]);
        } catch {
          remaining.push(image);
        }
      }
      if (remaining.length === images.length) break;
      images = remaining;
    }
    if ((await list("container")).length || (await list("image")).length)
      failures.push(new Error("Owned containers or images remain; inspect their workspace label."));
    if (failures.length) throw new AggregateError(failures, "Container cleanup did not complete.");
    write(
      "Owned containers and images removed. Dependency, build, browser and model caches retained.\n",
    );
  };
  if (action === "down") return cleanup();
  if (action === "up") {
    await manageContainer(root, "prepare", [], ports);
    try {
      await invoke(process.execPath, [cli, "up", ...cliArgs, "--default-user-env-probe", "none"], {
        cwd: root,
        inherit: true,
        signal: ports.signal,
      });
    } catch (error) {
      try {
        await cleanup();
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "Startup and cleanup failed.");
      }
      throw error;
    }
    return;
  }
  try {
    await invoke(
      process.execPath,
      [cli, "exec", ...cliArgs, "--default-user-env-probe", "none", "--", ...args],
      { cwd: root, inherit: true, signal: ports.signal, timeout: 0 },
    );
  } catch (error) {
    if (ports.signal?.aborted || error.interrupted) await cleanup();
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const abort = new AbortController();
  const stop = () => abort.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await manageContainer(repository, process.argv[2], process.argv.slice(3), {
      signal: abort.signal,
    });
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.exitCode || (abort.signal.aborted ? 130 : 1);
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}
