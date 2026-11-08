import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runDesktopContainer } from "../scripts/test-desktop-container.mjs";

const fixture = fileURLToPath(new URL("fixtures/fake-docker.mjs", import.meta.url));
const directories = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function setup(environment = {}) {
  const root = await mkdtemp(join(tmpdir(), "Code60 container with spaces, "));
  directories.push(root);
  const callsFile = join(root, "docker.jsonl");
  const options = {
    root,
    docker: process.execPath,
    dockerArgs: [fixture],
    env: { ...process.env, DOCKER_TEST_LOG: callsFile, ...environment },
    signals: new EventEmitter(),
    log: vi.fn(),
    preflightTimeout: 2_000,
    cleanupTimeout: 2_000,
  };
  const calls = async () =>
    (await readFile(callsFile, "utf8").catch(() => ""))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  return { root, options, calls };
}

describe("desktop container runner", () => {
  it("uses native Linux, preserves arguments and host files, and gives each run separate artifacts", async () => {
    const { root, options, calls } = await setup({ DOCKER_DEFAULT_PLATFORM: "linux/amd64" });
    await mkdir(join(root, "node_modules"));
    await mkdir(join(root, "dist"));
    await writeFile(join(root, "node_modules", "host"), "macOS dependencies");
    await writeFile(join(root, "dist", "host"), "macOS build");
    const args = ["--grep", "search; $(touch unwanted) `echo hi`", "--workers=1"];
    expect(await runDesktopContainer(args, options)).toBe(0);
    const commands = await calls();
    expect(
      commands.map((args) => (args[0] === "image" ? args.slice(0, 2).join(" ") : args[0])),
    ).toEqual(["info", "build", "create", "start", "rm", "image ls", "image rm"]);
    const build = commands[1];
    expect(build.slice(0, 5)).toEqual([
      "build",
      "--platform",
      "linux/arm64",
      "--file",
      join(root, "scripts/desktop-container/Dockerfile"),
    ]);
    expect(build.at(-1)).toBe(root);
    const create = commands[2];
    expect(create.slice(-args.length)).toEqual(args);
    expect(create).toEqual(expect.arrayContaining(["--init", "--shm-size=1g", "node"]));
    expect(create).toContain(`seccomp=${join(root, "scripts/desktop-container/seccomp.json")}`);
    expect(create.join(" ")).not.toContain("--privileged");
    expect(create.join(" ")).not.toContain("--no-sandbox");
    const name = create[create.indexOf("--name") + 1];
    expect(commands[3]).toEqual(["start", "--attach", name]);
    expect(commands[4]).toEqual(["rm", "--force", name]);
    const tag = build[build.indexOf("--tag") + 1];
    expect(create).toContain(tag);
    expect(build).toContain(`com.code60.test-run=${name}`);
    expect(build).toContain("--provenance=false");
    expect(commands[5]).toEqual([
      "image",
      "ls",
      "--all",
      "--quiet",
      "--filter",
      `reference=${tag}`,
    ]);
    expect(commands[6]).toEqual(["image", "rm", "--no-prune", tag]);
    await runDesktopContainer([], {
      ...options,
      env: { ...options.env, DOCKER_TEST_LOG: join(root, "second.jsonl") },
    });
    expect(await readdir(join(root, "test-results/container"))).toHaveLength(2);
    expect(await readFile(join(root, "node_modules/host"), "utf8")).toBe("macOS dependencies");
    expect(await readFile(join(root, "dist/host"), "utf8")).toBe("macOS build");
    expect(options.signals.eventNames()).toEqual([]);
  });

  it("reports a missing Docker executable", async () => {
    const { root, options } = await setup();
    expect(await runDesktopContainer([], { ...options, docker: join(root, "missing") })).toBe(1);
    expect(options.log).toHaveBeenCalledWith(expect.stringContaining("Docker was not found"));
  });

  it("bounds an unresponsive daemon without building or creating a container", async () => {
    const { options, calls } = await setup({ DOCKER_TEST_HANG: "info" });
    expect(await runDesktopContainer([], { ...options, preflightTimeout: 300 })).toBe(1);
    expect(
      (await calls()).map((args) => (args[0] === "image" ? args.slice(0, 2).join(" ") : args[0])),
    ).toEqual(["info"]);
    expect(options.log).toHaveBeenCalledWith(expect.stringContaining("Docker is unavailable"));
  });

  it("rejects a non-Linux engine", async () => {
    const { options, calls } = await setup({ DOCKER_TEST_PLATFORM: "windows/x86_64" });
    expect(await runDesktopContainer([], options)).toBe(1);
    expect(await calls()).toHaveLength(1);
  });

  it("returns the test failure and preserves its artifacts", async () => {
    const { root, options, calls } = await setup({ DOCKER_TEST_FAIL: "start" });
    expect(await runDesktopContainer([], options)).toBe(42);
    const [directory] = await readdir(join(root, "test-results/container"));
    expect(
      await readFile(join(root, "test-results/container", directory, "failure.txt"), "utf8"),
    ).toBe("retained artifact\n");
    expect(
      (await calls()).map((args) => (args[0] === "image" ? args.slice(0, 2).join(" ") : args[0])),
    ).toEqual(["info", "build", "create", "start", "stop", "rm", "image ls", "image rm"]);
  });

  it("does not start a container after a failed image build", async () => {
    const { options, calls } = await setup({ DOCKER_TEST_FAIL: "build" });
    expect(await runDesktopContainer([], options)).toBe(42);
    expect(
      (await calls()).map((args) => (args[0] === "image" ? args.slice(0, 2).join(" ") : args[0])),
    ).toEqual(["info", "build", "image ls", "image rm"]);
  });

  it.each([
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ])("cleans up its container after %s", async (signal, status) => {
    const { options, calls } = await setup({ DOCKER_TEST_HANG: "start" });
    const running = runDesktopContainer([], options);
    try {
      await vi.waitFor(async () => expect((await calls()).at(-1)?.[0]).toBe("start"), {
        timeout: 4_000,
      });
    } finally {
      options.signals.emit(signal);
    }
    expect(await running).toBe(status);
    const commands = await calls();
    const name = commands.find((args) => args[0] === "create")[2];
    expect(commands.slice(-4, -2)).toEqual([
      ["stop", "--time", "5", name],
      ["rm", "--force", name],
    ]);
    expect(options.signals.eventNames()).toEqual([]);
  });

  it("reports cleanup failure without hiding the original test failure", async () => {
    const { options } = await setup({ DOCKER_TEST_FAIL: "start", DOCKER_TEST_HANG: "rm" });
    expect(await runDesktopContainer([], { ...options, cleanupTimeout: 300 })).toBe(42);
    expect(options.log).toHaveBeenCalledWith(
      expect.stringContaining("Retry: docker rm --force code60-desktop-"),
    );
  });

  it("waits for an in-flight create before cancelling, and never starts that container", async () => {
    const { options, calls } = await setup({ DOCKER_TEST_DELAY: "create" });
    const running = runDesktopContainer([], options);
    try {
      await vi.waitFor(async () => expect((await calls()).at(-1)?.[0]).toBe("create"), {
        timeout: 4_000,
      });
    } finally {
      options.signals.emit("SIGINT");
    }
    expect(await running).toBe(130);
    expect(
      (await calls()).map((args) => (args[0] === "image" ? args.slice(0, 2).join(" ") : args[0])),
    ).toEqual(["info", "build", "create", "stop", "rm", "image ls", "image rm"]);
  });

  it("uses x64 natively when the Docker engine is x64", async () => {
    const { options, calls } = await setup({ DOCKER_TEST_PLATFORM: "linux/x86_64" });
    expect(await runDesktopContainer([], options)).toBe(0);
    expect((await calls()).find((args) => args[0] === "build").slice(0, 3)).toEqual([
      "build",
      "--platform",
      "linux/amd64",
    ]);
  });

  it("does not remove an image when a build failed before exporting one", async () => {
    const { options, calls } = await setup({
      DOCKER_TEST_FAIL: "build",
      DOCKER_TEST_NO_IMAGE: "1",
    });
    expect(await runDesktopContainer([], options)).toBe(42);
    expect((await calls()).filter((args) => args[0] === "image")).toHaveLength(1);
    expect((await calls()).at(-1).slice(0, 2)).toEqual(["image", "ls"]);
    expect(options.log.mock.calls.flat().join(" ")).not.toContain("Could not clean up");
  });

  it("removes a partially exported image after interruption during build", async () => {
    const { options, calls } = await setup({ DOCKER_TEST_HANG: "build" });
    const running = runDesktopContainer([], options);
    try {
      await vi.waitFor(async () => expect((await calls()).at(-1)?.[0]).toBe("build"), {
        timeout: 4_000,
      });
    } finally {
      options.signals.emit("SIGINT");
    }
    expect(await running).toBe(130);
    const commands = await calls();
    expect(commands.some((args) => args[0] === "create")).toBe(false);
    expect(commands.at(-1).slice(0, 3)).toEqual(["image", "rm", "--no-prune"]);
    await expect(readFile(`${options.env.DOCKER_TEST_LOG}.image`)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it.each([
    [undefined, 1],
    ["start", 42],
  ])("reports image cleanup failure while preserving test status %s", async (failure, status) => {
    const { options } = await setup({
      ...(failure ? { DOCKER_TEST_FAIL: failure } : {}),
      DOCKER_TEST_IMAGE_REMOVE_FAIL: "1",
    });
    expect(await runDesktopContainer([], options)).toBe(status);
    expect(options.log).toHaveBeenCalledWith(
      expect.stringContaining("Retry: docker image rm --no-prune code60-desktop-test:"),
    );
  });

  it("gives concurrent runs different image tags and cleans up only their own images", async () => {
    const first = await setup();
    const second = await setup();
    expect(
      await Promise.all([
        runDesktopContainer([], first.options),
        runDesktopContainer([], second.options),
      ]),
    ).toEqual([0, 0]);
    const tags = [];
    for (const run of [first, second]) {
      const commands = await run.calls();
      const build = commands.find((args) => args[0] === "build");
      const tag = build[build.indexOf("--tag") + 1];
      tags.push(tag);
      expect(commands.at(-1)).toEqual(["image", "rm", "--no-prune", tag]);
    }
    expect(tags[0]).not.toBe(tags[1]);
  });
});
