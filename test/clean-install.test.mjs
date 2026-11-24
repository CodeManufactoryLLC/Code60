import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  acceptanceInput,
  cleanupAcceptance,
  commandEnvironment,
  runCleanInstall,
  updateAcceptanceLayout,
} from "../scripts/test-clean-install.mjs";

const directories = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "code60 clean install spaces ")));
  directories.push(root);
  await mkdir(join(root, "release/build"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ version: "0.4.1" }));
  await writeFile(
    join(root, "package-lock.json"),
    JSON.stringify({ packages: { "node_modules/@playwright/test": { version: "1.64.1" } } }),
  );
  await writeFile(
    join(root, "release/build/code60-0.4.1.tgz"),
    "synthetic archive for stubbed Docker",
  );
  return root;
}
function docker({
  unavailable = false,
  installFailure = false,
  removalFailure = false,
  abort,
  wrongFault = false,
  imageArchitecture = "amd64",
} = {}) {
  const resources = { container: new Set(), image: new Set(), volume: new Set() };
  const leaks = new Set();
  const starts = new Map();
  const run = vi.fn(async (_file, args, options) => {
    if (args.some((value) => value.includes("readFileSync('/work/control/update-layout.json'")))
      return JSON.stringify({
        home: "/work/home",
        launcher: "/work/home/.local/bin/code60",
        setupDatabase: "/work/home/custom database.sqlite",
        fakeAgent: "/work/update-fixture/provider/fake-agent.mjs",
        application: `/installation/code60/releases/${"2".repeat(64)}`,
        archiveSha256: "2".repeat(64),
        version: "0.4.2",
      });
    if (args[0] === "info") {
      if (unavailable) throw new Error("Docker stopped");
      return "linux\n";
    }
    if (args[1] === "ls") return [...resources[args[0]]].join("\n");
    if (args[0] === "image" && args[1] === "inspect")
      return `sha256:${"1".repeat(64)} ${imageArchitecture}`;
    if (args[0] === "inspect") {
      const start = starts.get(args.at(-1));
      const mounts = start.flatMap((value, index) => {
        if (value !== "--mount") return [];
        const spec = start[index + 1];
        const fields = Object.fromEntries(spec.split(",").map((part) => part.split("=")));
        return [
          {
            Type: fields.type,
            Source: fields.source,
            Destination: fields.target,
            RW: !spec.includes(",readonly"),
          },
        ];
      });
      return JSON.stringify({
        network: "none",
        user: start[start.indexOf("--user") + 1],
        ports: null,
        mounts,
      });
    }
    if (args[0] === "build") resources.image.add(args[args.indexOf("-t") + 1]);
    if (args[0] === "volume" && args[1] === "create") resources.volume.add(args.at(-1));
    if (args[0] === "run" && args.includes("--name")) {
      resources.container.add(args[args.indexOf("--name") + 1]);
      starts.set(args[args.indexOf("--name") + 1], args);
    }
    if (args.includes("/harness/install.mjs")) {
      if (abort) {
        abort.abort();
        throw new Error("aborted");
      }
      if (installFailure) throw new Error("invalid tarball");
    }
    if (args[0] === "exec") {
      if (args[2] === "/harness/bin/systemctl")
        throw Object.assign(new Error("supervisor refused"), {
          stderr: "Acceptance refuses native supervisor/opener mutations.",
        });
      const mode = args[4];
      if (mode === "leak") leaks.add(args[1]);
      let message;
      if (mode === "architecture") message = "Acceptance runtime architecture mismatch";
      if (mode === "verify-cleanup" && leaks.has(args[1]))
        message = "Installed process leak detected";
      if (args[1].endsWith("-model") && mode === "model")
        message = "Installed bundled model assets are missing";
      if (args[1].endsWith("-assets") && mode === "assets")
        message = "Installed browser assets are unavailable";
      if (message)
        throw Object.assign(new Error("probe failed"), {
          stderr: wrongFault ? "unrelated transport failure" : message,
        });
    }
    if (args[0] === "rm") resources.container.delete(args[1]);
    if (args[1] === "rm") {
      if (removalFailure && args[0] === "image") throw new Error("image removal refused");
      resources[args[0]].delete(args[2]);
    }
    if (options?.signal?.aborted) throw new Error("aborted command");
    return "";
  });
  return { run, write: vi.fn(), resources };
}

it("validates archive arguments and preserves paths containing spaces", async () => {
  const root = await fixture();
  expect(await acceptanceInput(root, [])).toBe(join(root, "release/build/code60-0.4.1.tgz"));
  await expect(acceptanceInput(root, ["missing.tgz"])).rejects.toThrow("Build the npm tarball");
  await expect(acceptanceInput(root, ["--unknown"])).rejects.toThrow("Use npm run");
  await expect(acceptanceInput(root, ["one", "two"])).rejects.toThrow("Use npm run");
});

it("keeps Docker connection settings without forwarding provider/agent/Node configuration", () => {
  expect(
    commandEnvironment({
      PATH: "/bin",
      HOME: "/home/fixture",
      DOCKER_CONTEXT: "fixture",
      OPENAI_API_KEY: "secret",
      SSH_AUTH_SOCK: "/socket",
      NODE_OPTIONS: "--require malicious",
      NODE_PATH: "/source/node_modules",
      NPM_CONFIG_USERCONFIG: "/private/npmrc",
    }),
  ).toEqual({ PATH: "/bin", HOME: "/home/fixture", DOCKER_CONTEXT: "fixture" });
});

it("fails before building when Docker is unavailable", async () => {
  const ports = docker({ unavailable: true });
  await expect(runCleanInstall(await fixture(), [], ports)).rejects.toThrow(
    "Start the Linux Docker engine",
  );
  expect(ports.run.mock.calls).toHaveLength(1);
});

it("runs isolated stages, detects known faults and removes only labelled resources", async () => {
  const root = await fixture();
  const ports = docker();
  const result = await runCleanInstall(root, [], ports);
  expect(result.status).toBe("passed");
  expect(result.artifactSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(result.cleanup).toEqual({ containers: [], images: [], volumes: [] });
  expect(result.phases).toContain("installed first-use golden journey");
  expect(result.expectedFailures).toContainEqual({ scenario: "missing model", detected: true });
  const args = ports.run.mock.calls.map(([, argv]) => argv);
  const runtime = args.find(
    (argv) =>
      argv[0] === "run" &&
      argv.includes("--detach") &&
      argv.some((arg) => arg.endsWith("-runtime")),
  );
  expect(runtime).toContain("none");
  expect(runtime).toContain(
    "type=volume,source=" +
      `code60-acceptance-${result.id}-installation,target=/installation,readonly,volume-nocopy`,
  );
  expect(runtime.some((arg) => arg.includes("target=/input,readonly"))).toBe(true);
  expect(runtime.some((arg) => arg.includes("docker.sock") || arg.includes("NODE_PATH"))).toBe(
    false,
  );
  const driver = args.find((argv) =>
    argv.includes(`container:code60-acceptance-${result.id}-runtime`),
  );
  expect(driver).toContain("HOME=/work/driver-home");
  expect(driver.some((arg) => arg.includes("target=/installation"))).toBe(false);
  expect(
    args
      .filter((argv) => argv[1] === "ls")
      .every((argv) => argv.includes(`label=com.code60.acceptance.run=${result.id}`)),
  ).toBe(true);
  expect(args.some((argv) => argv.includes("prune") || argv.includes("--force"))).toBe(false);
  expect(JSON.parse(await readFile(join(result.output, "summary.json"), "utf8")).status).toBe(
    "passed",
  );
});

it("does not count an unrelated probe error as an expected negative result", async () => {
  const ports = docker({ wrongFault: true });
  await expect(runCleanInstall(await fixture(), [], ports)).rejects.toThrow("probe failed");
  expect([
    ...ports.resources.container,
    ...ports.resources.image,
    ...ports.resources.volume,
  ]).toEqual([]);
});

it("rejects a wrong image architecture before installing and still removes its images", async () => {
  const ports = docker({ imageArchitecture: "arm64" });
  await expect(runCleanInstall(await fixture(), [], ports)).rejects.toThrow(
    "image architecture mismatch",
  );
  expect(ports.run.mock.calls.some(([, args]) => args.includes("/harness/install.mjs"))).toBe(
    false,
  );
  expect(ports.resources.image.size).toBe(0);
});

it.each(["installation", "cancellation"])(
  "cleans all created resources after %s failure",
  async (mode) => {
    const controller = new AbortController();
    const ports = docker({
      installFailure: mode === "installation",
      abort: mode === "cancellation" ? controller : undefined,
    });
    await expect(
      runCleanInstall(await fixture(), [], { ...ports, signal: controller.signal }),
    ).rejects.toThrow(mode === "installation" ? "invalid tarball" : "aborted");
    expect([
      ...ports.resources.container,
      ...ports.resources.image,
      ...ports.resources.volume,
    ]).toEqual([]);
  },
);

it("reports image cleanup failure without a global prune or forced removal", async () => {
  const ports = docker({ removalFailure: true });
  const root = await fixture();
  await expect(runCleanInstall(root, [], ports)).rejects.toThrow("cleanup did not complete");
  expect(ports.resources.image.size).toBe(2);
  const [id] = await readdir(join(root, "test-results/clean-install"));
  const report = JSON.parse(
    await readFile(join(root, "test-results/clean-install", id, "summary.json"), "utf8"),
  );
  expect(report.cleanup.failed).toBe(true);
  expect(report.cleanup.remaining.images).toHaveLength(2);
  const imageRemoval = ports.run.mock.calls.filter(
    ([, args]) => args[0] === "image" && args[1] === "rm",
  );
  expect(imageRemoval).toHaveLength(2);
  for (const [, , options] of imageRemoval) expect(options.log).toMatch(/\d+-cleanup-image\.log$/);
  expect(
    ports.run.mock.calls.some(([, args]) => args.includes("--force") || args.includes("prune")),
  ).toBe(false);
});

it("preserves cancellation during cleanup while still finishing owned removal", async () => {
  const controller = new AbortController();
  const ports = docker();
  const run = async (file, args, options) => {
    if (args[0] === "stop") controller.abort();
    return ports.run(file, args, options);
  };
  await expect(
    runCleanInstall(await fixture(), [], { ...ports, run, signal: controller.signal }),
  ).rejects.toThrow("interrupted");
  expect([
    ...ports.resources.container,
    ...ports.resources.image,
    ...ports.resources.volume,
  ]).toEqual([]);
});

it("assigns independent identities and evidence paths to concurrent sessions", async () => {
  const root = await fixture();
  const [a, b] = await Promise.all([
    runCleanInstall(root, [], docker()),
    runCleanInstall(root, [], docker()),
  ]);
  expect(a.id).not.toBe(b.id);
  expect(a.output).not.toBe(b.output);
});

it("retains a foreign session when cleaning a selected run", async () => {
  const resources = new Map(
    ["container", "image", "volume"].map((kind) => [
      kind,
      new Map([
        [`owned-${kind}`, "owned"],
        [`foreign-${kind}`, "foreign"],
      ]),
    ]),
  );
  const run = vi.fn(async (_file, args) => {
    if (args[1] === "ls") {
      expect(args).toContain("label=com.code60.acceptance.run=owned");
      return [...resources.get(args[0])]
        .filter(([, label]) => label === "owned")
        .map(([name]) => name)
        .join("\n");
    }
    if (args[0] === "rm") resources.get("container").delete(args[1]);
    if (args[1] === "rm") resources.get(args[0]).delete(args[2]);
    return "";
  });
  await cleanupAcceptance(run, "owned");
  for (const [kind, entries] of resources)
    expect([...entries]).toEqual([[`foreign-${kind}`, "foreign"]]);
});

it("uses the same isolation and cleanup for explicit payload mode without npm installation", async () => {
  const root = await fixture();
  const folder = join(root, "release/payloads");
  await mkdir(folder);
  const name = "code60-0.4.1-linux-x64.tar.gz";
  await writeFile(join(folder, name), "synthetic payload for Docker orchestration");
  await writeFile(
    join(folder, "linux-x64.json"),
    JSON.stringify({
      schemaVersion: 1,
      version: "0.4.1",
      commit: "a".repeat(40),
      dirty: false,
      os: "linux",
      arch: "x64",
      runtime: { node: ">=24.22.0 <25", libc: "glibc" },
      archive: {
        name,
        size: 100,
        sha256: "1".repeat(64),
        url: `https://github.com/CodeManufactoryLLC/Code60/releases/download/v0.4.1/${name}`,
      },
    }),
  );
  const ports = docker();
  const result = await runCleanInstall(
    root,
    ["--payload", "release/payloads/linux-x64.json"],
    ports,
  );
  expect(result.phases).toContain("verified payload extraction without npm");
  const installer = ports.run.mock.calls
    .map(([, args]) => args)
    .find((args) => args.includes("/harness/test/clean-install/install-payload.mjs"));
  expect(installer[installer.indexOf("--network") + 1]).toBe("none");
  expect(result.cleanup).toEqual({ containers: [], images: [], volumes: [] });
  const updatedPorts = docker();
  const updated = await runCleanInstall(
    root,
    ["--update", "release/payloads/linux-x64.json"],
    updatedPorts,
  );
  expect(updated.status).toBe("passed");
  expect(updated.phases).toContain("offline managed update preparation");
  expect(updated.updatedInstallation.version).toBe("0.4.2");
  expect(updated.phases).toContain("verified update handoff and bootstrap cache removal");
  const updateCalls = updatedPorts.run.mock.calls.map(([, args]) => args);
  const prepare = updateCalls.find((args) => args.includes("/harness/scripts/test-update.mjs"));
  expect(prepare[prepare.indexOf("--network") + 1]).toBe("none");
  expect(prepare).toContain("CODE60_ACCEPTANCE_UPDATE_HANDOFF=1");
  for (const target of ["dist/renderer", "models"])
    expect(
      updateCalls.some((args) =>
        args.some((value) =>
          value.includes(`/installation/code60/releases/${"2".repeat(64)}/${target}`),
        ),
      ),
    ).toBe(true);
  expect(updated.cleanup).toEqual({ containers: [], images: [], volumes: [] });
  await expect(runCleanInstall(root, ["--payload"], ports)).rejects.toThrow("<descriptor.json>");
  await rm(join(folder, name));
  await expect(
    runCleanInstall(root, ["--payload", "release/payloads/linux-x64.json"], ports),
  ).rejects.toThrow("Build the platform payload");
});

it("validates and allowlists the offline update handoff without forwarding arbitrary fields", () => {
  const value = {
    home: "/work/home",
    launcher: "/work/home/.local/bin/code60",
    setupDatabase: "/work/home/custom database.sqlite",
    fakeAgent: "/work/owned/provider/fake-agent.mjs",
    application: `/installation/code60/releases/${"2".repeat(64)}`,
    archiveSha256: "2".repeat(64),
    version: "0.4.2",
    unwanted: "must not propagate",
  };
  expect(updateAcceptanceLayout(value)).not.toHaveProperty("unwanted");
  for (const patch of [
    { home: "/elsewhere" },
    { launcher: "/usr/bin/code60" },
    { setupDatabase: "/other/db" },
    { archiveSha256: "3".repeat(64) },
    { fakeAgent: "/work/../private/provider/fake-agent.mjs" },
    { fakeAgent: "/host/provider/fake-agent.mjs" },
    { version: "latest" },
    { application: "/unowned/release" },
  ])
    expect(() => updateAcceptanceLayout({ ...value, ...patch })).toThrow(
      "Invalid updated customer handoff",
    );
  expect(() => updateAcceptanceLayout(null)).toThrow();
});

it("setup mode keeps installed subtrees read-only and retains separate writable customer state", async () => {
  const root = await fixture();
  const path = join(root, "linux-x64.json");
  const archive = {
    name: "code60-0.4.1-linux-x64.tar.gz",
    size: 37,
    sha256: "a".repeat(64),
    url: "https://github.com/CodeManufactoryLLC/Code60/releases/download/v0.4.1/code60-0.4.1-linux-x64.tar.gz",
  };
  await writeFile(join(root, archive.name), "synthetic payload");
  await writeFile(
    path,
    JSON.stringify({
      schemaVersion: 1,
      version: "0.4.1",
      commit: "a".repeat(40),
      dirty: false,
      os: "linux",
      arch: "x64",
      runtime: { node: ">=24.22.0 <25", libc: "glibc" },
      archive,
    }),
  );
  const ports = docker();
  const result = await runCleanInstall(root, ["--setup", path], ports);
  expect(result.status).toBe("passed");
  expect(
    result.isolation.mounts
      .filter((item) =>
        ["/installation/code60/releases", "/installation/code60/activations"].includes(
          item.Destination,
        ),
      )
      .every((item) => !item.RW),
  ).toBe(true);
  const invocations = ports.run.mock.calls.map((call) => call[1]);
  expect(invocations.some((args) => args.includes("/harness/install-setup.mjs"))).toBe(true);
  expect(
    invocations.some((args) =>
      args.some((value) => value.includes("volume-subpath=code60/databases")),
    ),
  ).toBe(true);
  await expect(runCleanInstall(root, ["--setup"], ports)).rejects.toThrow("--setup");
});
