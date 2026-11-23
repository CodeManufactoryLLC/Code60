import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { developmentPort } from "../scripts/dev-ports.mjs";
import { containerConfiguration, manageContainer } from "../scripts/devcontainer.mjs";

const directories = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function checkout(worktree = false) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "code60 container spaces ")));
  directories.push(directory);
  const root = join(directory, "source clone");
  await mkdir(root);
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
  git("init", "-q");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--allow-empty",
    "-qm",
    "fixture",
  );
  if (!worktree) return root;
  const linked = join(directory, "linked worktree");
  git("worktree", "add", "-qb", "fixture", linked);
  return linked;
}
function control({ unavailable = false, failStartup = false, failRemoval = false } = {}) {
  let containers = ["owned-container"];
  let images = ["owned-image"];
  const run = vi.fn(async (file, args) => {
    if (file === "git") return execFileSync(file, args, { encoding: "utf8" });
    if (file === "docker") {
      if (args[0] === "info") {
        if (unavailable) throw new Error("daemon unavailable");
        return "linux\n";
      }
      if (args[1] === "ls")
        return `${(args[0] === "container" ? containers : images).join("\n")}\n`;
      if (args[0] === "rm") containers = [];
      if (args[1] === "rm") {
        if (failRemoval) throw new Error("image shared");
        images = [];
      }
      return "";
    }
    if (failStartup) throw new Error("build failed");
    return "";
  });
  return { run, write: vi.fn(), available: async () => true };
}

it("generates isolated amd64 mounts and keeps root initialization away from the checkout", () => {
  const { compose } = containerConfiguration("/source with spaces", "/main/.git", 1001, 1002, {
    gateway: 44000,
    vite: 44001,
  });
  const service = compose.services.code60;
  expect(service.platform).toBe("linux/amd64");
  expect(service.user).toBe("1001:1002");
  expect(service.volumes.filter((mount) => mount.type === "bind")).toEqual([
    { type: "bind", source: "/source with spaces", target: "/source with spaces" },
    { type: "bind", source: "/main/.git", target: "/main/.git" },
  ]);
  expect(
    service.volumes.filter((mount) => mount.type === "volume").map((mount) => mount.target),
  ).toEqual([
    "/source with spaces/node_modules",
    "/source with spaces/dist",
    "/home/node/.npm",
    "/home/node/.cache/ms-playwright",
    "/source with spaces/models",
  ]);
  expect(compose.services["cache-init"].volumes.every((mount) => mount.type === "volume")).toBe(
    true,
  );
  expect(service.ports).toBeUndefined();
  expect(service.environment.SSH_AUTH_SOCK).toBe("");
  expect(service.environment.GIT_CONFIG_GLOBAL).toBe("/dev/null");
  expect(service.environment.CODE60_DEV_GATEWAY_PORT).toBe("44000");
  expect(service.environment.CODE60_VITE_PORT).toBe("44001");
  expect(JSON.stringify(compose)).not.toContain("docker.sock");
});

it.each([false, true])(
  "prepares real Git checkouts and linked worktrees without Docker (%s)",
  async (linked) => {
    const root = await checkout(linked);
    const ports = control({ unavailable: true });
    await manageContainer(root, "prepare", [], ports);
    const config = JSON.parse(
      await readFile(join(root, ".devcontainer/local/compose.json"), "utf8"),
    );
    const binds = config.services.code60.volumes.filter((mount) => mount.type === "bind");
    expect(binds).toHaveLength(linked ? 2 : 1);
    for (const bind of binds) expect(await realpath(bind.source)).toBe(bind.target);
    expect(ports.run.mock.calls.every(([file]) => file === "git")).toBe(true);
    expect(
      JSON.parse(
        await readFile(join(root, ".devcontainer/local/editor-profile/User/settings.json"), "utf8"),
      )["dev.containers.copyGitConfig"],
    ).toBe(false);
    const before = JSON.stringify(config);
    await manageContainer(root, "prepare", [], ports);
    expect(
      JSON.stringify(
        JSON.parse(await readFile(join(root, ".devcontainer/local/compose.json"), "utf8")),
      ),
    ).toBe(before);
  },
);

it("refuses redirected output directories", async () => {
  const root = await checkout();
  const target = join(root, "unrelated");
  await mkdir(target);
  await mkdir(join(root, ".devcontainer"));
  await symlink(target, join(root, ".devcontainer/local"));
  await writeFile(join(target, "compose.json"), "preserve");
  await expect(manageContainer(root, "prepare", [], control())).rejects.toThrow(
    /symlink|redirect/i,
  );
  expect(await readFile(join(target, "compose.json"), "utf8")).toBe("preserve");
});

it("prepares concurrent linked worktrees with matching, distinct container and editor ports", async () => {
  const linked = await checkout(true);
  const root = join(linked, "../source clone");
  const roots = [await realpath(root), linked];
  await Promise.all(roots.map((path) => manageContainer(path, "prepare", [], control())));
  const configs = await Promise.all(
    roots.map(async (path) => ({
      compose: JSON.parse(await readFile(join(path, ".devcontainer/local/compose.json"), "utf8")),
      editor: JSON.parse(await readFile(join(path, ".devcontainer/devcontainer.json"), "utf8")),
    })),
  );
  const forwarded = [];
  for (const { compose, editor } of configs) {
    const env = compose.services.code60.environment;
    expect(editor.forwardPorts).toEqual([
      Number(env.CODE60_DEV_GATEWAY_PORT),
      Number(env.CODE60_VITE_PORT),
    ]);
    for (const port of editor.forwardPorts)
      expect(editor.portsAttributes[port].requireLocalPort).toBe(true);
    forwarded.push(...editor.forwardPorts);
  }
  expect(new Set(forwarded).size).toBe(4);
  expect(configs[0].compose.name).not.toBe(configs[1].compose.name);
  expect(Object.values(configs[0].compose.volumes).map((value) => value.name)).not.toEqual(
    Object.values(configs[1].compose.volumes).map((value) => value.name),
  );
});

it("reports a stopped daemon before attempting builds", async () => {
  const ports = control({ unavailable: true });
  await expect(manageContainer(await checkout(), "up", [], ports)).rejects.toThrow("Start Docker");
  expect(ports.run.mock.calls.some(([file]) => file === process.execPath)).toBe(false);
});

it("passes terminal commands as exact arguments and prepares before startup", async () => {
  const ports = control();
  const root = await checkout();
  await manageContainer(root, "up", [], ports);
  await manageContainer(root, "exec", ["node", "-e", "console.log('$HOME; untouched')"], ports);
  const calls = ports.run.mock.calls.filter(([file]) => file === process.execPath);
  expect(calls[0][1]).toContain("up");
  expect(calls[1][1].slice(-4)).toEqual(["--", "node", "-e", "console.log('$HOME; untouched')"]);
  expect(calls[1][1]).toContain(root);
});

it("cleans owned containers and images after startup failure and retains caches", async () => {
  const ports = control({ failStartup: true });
  await expect(manageContainer(await checkout(), "up", [], ports)).rejects.toThrow("build failed");
  const docker = ports.run.mock.calls.filter(([file]) => file === "docker").map(([, args]) => args);
  expect(docker).toContainEqual(["stop", "--time", "30", "owned-container"]);
  expect(docker).toContainEqual(["rm", "owned-container"]);
  expect(docker).toContainEqual(["image", "rm", "owned-image"]);
  expect(docker.some((args) => args.includes("prune") || args.includes("volume"))).toBe(false);
  expect(
    docker
      .filter((args) => args[1] === "ls")
      .every((args) => args.some((arg) => arg.startsWith("label=com.code60.devcontainer="))),
  ).toBe(true);
});

it("reports cleanup failures instead of force-removing shared images", async () => {
  const ports = control({ failRemoval: true });
  await expect(manageContainer(await checkout(), "down", [], ports)).rejects.toThrow(
    "cleanup did not complete",
  );
  expect(ports.run.mock.calls.some(([, args]) => args.includes("--force"))).toBe(false);
});

it.each(["host-signal", "remote-exit-130"])("cleans up a cancelled exec (%s)", async (kind) => {
  const ports = control();
  const base = ports.run;
  const controller = new AbortController();
  ports.signal = controller.signal;
  ports.run = vi.fn(async (file, args, options) => {
    if (file === process.execPath) {
      if (kind === "host-signal") controller.abort();
      throw Object.assign(new Error("cancelled"), { interrupted: kind === "remote-exit-130" });
    }
    return base(file, args, options);
  });
  await expect(
    manageContainer(await checkout(), "exec", ["node", "fixture"], ports),
  ).rejects.toThrow("cancelled");
  expect(base.mock.calls).toContainEqual(["docker", ["rm", "owned-container"], undefined]);
  expect(base.mock.calls).toContainEqual(["docker", ["image", "rm", "owned-image"], undefined]);
});

it.each(["unknown", undefined])("rejects invalid actions (%s)", async (action) => {
  await expect(manageContainer("/unused", action)).rejects.toThrow("Use devcontainer");
});
it("rejects missing commands and extra arguments", async () => {
  await expect(manageContainer("/unused", "exec")).rejects.toThrow("Supply a command");
  await expect(manageContainer("/unused", "down", ["--all"])).rejects.toThrow("Use devcontainer");
});

it("keeps ephemeral ports by default and validates requested development ports", () => {
  expect(developmentPort(undefined, "port")).toBeUndefined();
  expect(developmentPort("43160", "port")).toBe(43160);
  expect(developmentPort("65535", "port")).toBe(65535);
  for (const value of ["", "0", "-1", "65536", "1.5", " 80", "080", "NaN"])
    expect(() => developmentPort(value, "port")).toThrow("between 1 and 65535");
});
