import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { bootstrapAdapter } from "./distribution/bootstrap-adapter.mjs";
import { copyPayloadVerifier, writeBootstrapVerifier } from "./distribution/copy-verifier.mjs";
import { descriptor } from "./distribution/descriptor.mjs";

const execute = promisify(execFile);
const repository = fileURLToPath(new URL("..", import.meta.url));
const owner = "com.code60.acceptance.run";

export function commandEnvironment(env) {
  return Object.fromEntries(
    [
      "PATH",
      "HOME",
      "TMPDIR",
      "DOCKER_HOST",
      "DOCKER_CONTEXT",
      "DOCKER_CONFIG",
      "DOCKER_TLS_VERIFY",
      "DOCKER_CERT_PATH",
      "XDG_RUNTIME_DIR",
    ]
      .filter((name) => env[name] !== undefined)
      .map((name) => [name, env[name]]),
  );
}

export async function acceptanceInput(directory, args) {
  if (args.length > 1 || args[0]?.startsWith("-"))
    throw new Error("Use npm run test:packaged:clean -- [archive.tgz].");
  const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
  const archive = resolve(directory, args[0] ?? `release/build/code60-${manifest.version}.tgz`);
  if (!(await stat(archive).catch(() => null))?.isFile())
    throw new Error(
      "Build the npm tarball first with npm run package:app, or supply an existing archive.",
    );
  return archive;
}

export function updateAcceptanceLayout(value) {
  if (
    value?.home !== "/work/home" ||
    value.launcher !== "/work/home/.local/bin/code60" ||
    value.setupDatabase !== "/work/home/custom database.sqlite" ||
    !/^[a-f0-9]{64}$/.test(value.archiveSha256) ||
    value.application !== `/installation/code60/releases/${value.archiveSha256}` ||
    !/^\d+\.\d+\.\d+$/.test(value.version) ||
    typeof value.fakeAgent !== "string" ||
    value.fakeAgent.length > 4096 ||
    !value.fakeAgent.startsWith("/work/") ||
    !value.fakeAgent.endsWith("/provider/fake-agent.mjs") ||
    /[\0\r\n]/.test(value.fakeAgent) ||
    resolve(value.fakeAgent) !== value.fakeAgent
  )
    throw Error("Invalid updated customer handoff; preserve run evidence");
  return {
    application: value.application,
    launcher: value.launcher,
    home: value.home,
    setupDatabase: value.setupDatabase,
    fakeAgent: value.fakeAgent,
    version: value.version,
    archiveSha256: value.archiveSha256,
  };
}

export async function cleanupAcceptance(run, id) {
  const list = async (kind) =>
    (
      await run("docker", [
        kind,
        "ls",
        ...(kind === "container" || kind === "image" ? ["--all"] : []),
        "--quiet",
        "--filter",
        `label=${owner}=${id}`,
      ])
    )
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  const failures = [];
  for (const container of await list("container")) {
    try {
      await run("docker", ["stop", "--time", "25", container]);
      await run("docker", ["rm", container]);
    } catch (error) {
      if ((await list("container")).includes(container)) failures.push(error);
    }
  }
  for (const image of new Set(await list("image"))) {
    try {
      await run("docker", ["image", "rm", image]);
    } catch (error) {
      failures.push(error);
    }
  }
  for (const volume of await list("volume")) {
    try {
      await run("docker", ["volume", "rm", volume]);
    } catch (error) {
      failures.push(error);
    }
  }
  const inventory = {
    containers: await list("container"),
    images: await list("image"),
    volumes: await list("volume"),
  };
  if (Object.values(inventory).some((items) => items.length))
    failures.push(new Error("Owned acceptance resources remain; inspect the run label."));
  if (failures.length)
    throw Object.assign(new AggregateError(failures, "Acceptance cleanup did not complete."), {
      inventory,
    });
  return inventory;
}

async function stage(
  context,
  input,
  harness,
  archive,
  version,
  payload,
  managed,
  setup = false,
  update = false,
  uninstall = false,
) {
  await mkdir(join(context, "driver/test/fixtures"), { recursive: true });
  await mkdir(join(context, "driver/test/clean-install"), { recursive: true });
  await mkdir(input);
  await mkdir(join(harness, "bin"), { recursive: true });
  await cp(archive, join(input, "package.tgz"));
  const application = setup
    ? `/installation/code60/releases/${payload.archive.sha256}`
    : managed
      ? `/installation/customer-home/.local/share/code60/releases/${payload.archive.sha256}`
      : "/installation/product/node_modules/code60";
  await writeFile(
    join(harness, "layout.json"),
    JSON.stringify({
      application,
      setup,
      update,
      uninstall,
      fakeAgent: managed
        ? "/installation/fixtures/fake-agent.mjs"
        : `${application}/fixtures/fake-agent.mjs`,
      launcher: setup
        ? "/work/home/.local/bin/code60"
        : managed
          ? "/installation/customer-home/.local/bin/code60"
          : null,
    }),
  );
  if (managed || setup) {
    await mkdir(join(harness, "bootstrap/lib"), { recursive: true });
    await mkdir(join(harness, "bootstrap/bin"));
    await cp(
      join(repository, "scripts/distribution/bootstrap.mjs"),
      join(harness, "bootstrap/bin/code60.mjs"),
    );
    await cp(join(repository, "build/distribution"), join(harness, "bootstrap/lib/runtime"), {
      recursive: true,
    });
    await writeBootstrapVerifier(join(harness, "bootstrap/lib"));
    await writeFile(
      join(harness, "bootstrap/package.json"),
      JSON.stringify({ type: "module", private: true, version: payload.version }),
    );
    await writeFile(
      join(harness, "bootstrap/platforms.json"),
      JSON.stringify({ "linux-x64": payload }),
    );
    await writeFile(join(harness, "bootstrap/lib/index.mjs"), bootstrapAdapter);
    await cp(
      join(repository, `test/clean-install/${setup ? "install-setup" : "install-managed"}.mjs`),
      join(harness, setup ? "install-setup.mjs" : "install-managed.mjs"),
    );
  }

  if (payload) {
    await writeFile(join(input, "descriptor.json"), JSON.stringify(payload));
    await mkdir(join(harness, "scripts/distribution"), { recursive: true });
    await mkdir(join(harness, "src/platform"), { recursive: true });
    await copyPayloadVerifier(join(harness, "src"));
    for (const name of ["acquire.mjs", "archive.mjs", "descriptor.mjs"])
      await cp(
        join(repository, "scripts/distribution", name),
        join(harness, "scripts/distribution", name),
      );
    await mkdir(join(harness, "test/clean-install"), { recursive: true });
    for (const name of ["install-payload.mjs", "support.mjs"])
      await cp(
        join(repository, "test/clean-install", name),
        join(harness, "test/clean-install", name),
      );
  }
  if (update) {
    await mkdir(join(harness, "test/fixtures"), { recursive: true });
    await cp(join(repository, "scripts/test-update.mjs"), join(harness, "scripts/test-update.mjs"));
    for (const name of ["update-fixture.mjs", "policy.mjs", "command.mjs", "probe-native.mjs"])
      await cp(
        join(repository, "scripts/distribution", name),
        join(harness, "scripts/distribution", name),
      );
    for (const name of [
      "backend-supervisor.mjs",
      "backend-supervisor-command.mjs",
      "update-command.mjs",
      "fake-agent.mjs",
      "fake-agent-app.mjs",
    ])
      await cp(join(repository, "test/fixtures", name), join(harness, "test/fixtures", name));
    await mkdir(join(harness, "build"));
    await cp(join(repository, "build/distribution"), join(harness, "build/distribution"), {
      recursive: true,
    });
    await writeFile(join(harness, "build/distribution/package.json"), '{"type":"module"}\n');
  }
  for (const name of ["Customer.Dockerfile", "Driver.Dockerfile"])
    await cp(join(repository, "test/clean-install", name), join(context, name));
  for (const name of [
    "support.mjs",
    "install.mjs",
    "runtime.mjs",
    "probe.mjs",
    "supervisor.mjs",
    "supervisor-calls.mjs",
  ])
    await cp(join(repository, "test/clean-install", name), join(harness, name));
  if (setup) {
    for (const name of ["backend-supervisor.mjs", "backend-supervisor-command.mjs"])
      await cp(join(repository, "test/fixtures", name), join(harness, name));
    await cp(
      join(repository, "test/clean-install/runtime-setup.mjs"),
      join(harness, "runtime-setup.mjs"),
    );
  }
  if (uninstall) {
    await mkdir(join(harness, "test/fixtures"), { recursive: true });
    await cp(
      join(repository, "test/clean-install/uninstall.mjs"),
      join(harness, "test/clean-install/uninstall.mjs"),
    );
    await cp(
      join(repository, "test/fixtures/uninstall-journey.mjs"),
      join(harness, "test/fixtures/uninstall-journey.mjs"),
    );
  }
  await chmod(join(harness, setup ? "backend-supervisor-command.mjs" : "supervisor.mjs"), 0o755);
  for (const name of ["systemctl", "launchctl", "xdg-open"])
    await symlink(
      setup ? "../backend-supervisor-command.mjs" : "../supervisor.mjs",
      join(harness, "bin", name),
    );
  for (const name of ["fake-agent.mjs", "fake-agent-app.mjs"])
    await cp(join(repository, "test/fixtures", name), join(harness, name));
  for (const name of ["golden-journey.ts", "browser-actions.ts", "git-repository.ts"])
    await cp(join(repository, "test/fixtures", name), join(context, "driver/test/fixtures", name));
  await cp(
    join(repository, "test/clean-install/installed.e2e.ts"),
    join(context, "driver/test/clean-install/installed.e2e.ts"),
  );
  await cp(
    join(repository, "test/clean-install/installed.config.ts"),
    join(context, "driver/installed.config.ts"),
  );
  await writeFile(
    join(context, "driver-package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      dependencies: { "@playwright/test": version },
    }),
  );
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(join(input, "package.tgz"))) hash.update(chunk);
  return hash.digest("hex");
}

export async function runCleanInstall(directory, args = [], ports = {}) {
  const root = await realpath(directory);
  let payload;
  let archive;
  const update = args[0] === "--update";
  const uninstall = args[0] === "--uninstall";
  const setup = args[0] === "--setup" || update || uninstall;
  const managed = args[0] === "--managed" || setup;
  if (args[0] === "--payload" || managed) {
    if (args.length !== 2)
      throw new Error(
        "Use npm run test:packaged:clean -- --payload|--managed|--setup|--update|--uninstall <descriptor.json>",
      );
    const path = resolve(root, args[1]);
    payload = descriptor(JSON.parse(await readFile(path, "utf8")));
    archive = join(dirname(path), payload.archive.name);
    if (!(await stat(archive).catch(() => null))?.isFile())
      throw new Error("Build the platform payload first with npm run package:payload");
  } else archive = await acceptanceInput(root, args);
  const id = randomUUID();
  const name = `code60-acceptance-${id}`;
  const output = join(root, "test-results/clean-install", id);
  await mkdir(dirname(output), { recursive: true });
  if ((await realpath(dirname(output))) !== dirname(output))
    throw new Error("Refusing redirected acceptance evidence directory.");
  await mkdir(output, { mode: 0o700 });
  const temporary = await realpath(await mkdtemp(join(tmpdir(), "code60-clean-install-")));
  const context = join(temporary, "context");
  const input = join(temporary, "input");
  const harness = join(temporary, "harness");
  const abort = new AbortController();
  const forwardAbort = () => abort.abort();
  ports.signal?.addEventListener("abort", forwardAbort, { once: true });
  if (ports.signal?.aborted) abort.abort();
  const deadline = setTimeout(() => abort.abort(), 20 * 60_000);
  let logIndex = 0;
  const command =
    ports.run ??
    (async (file, argv, options = {}) => {
      try {
        const result = await execute(file, argv, {
          env: commandEnvironment(process.env),
          timeout: options.timeout ?? 60_000,
          killSignal: "SIGKILL",
          signal: options.signal,
          maxBuffer: 16 * 1024 * 1024,
        });
        if (options.log)
          await writeFile(options.log, `${result.stdout}${result.stderr}`, { mode: 0o600 });
        return result.stdout;
      } catch (error) {
        if (options.log)
          await writeFile(options.log, `${error.stdout ?? ""}${error.stderr ?? ""}`, {
            mode: 0o600,
          });
        throw error;
      }
    });
  const docker = (argv, timeout = 60_000) =>
    command("docker", argv, {
      timeout,
      signal: abort.signal,
      log: join(output, `${String(++logIndex).padStart(2, "0")}-${argv[0]}.log`),
    });
  const progress = ports.write ?? ((message) => process.stdout.write(`${message}\n`));
  const summary = {
    id,
    archive,
    output,
    status: "failed",
    phases: [],
    expectedFailures: [],
    nativeServiceValidation: "not performed",
  };
  const checked = async (phase, operation) => {
    await progress(`Clean installation: ${phase}`, {
      id,
      output,
      runtimeContainer: summary.runtimeContainer,
    });
    await operation();
    summary.phases.push(phase);
    await writeFile(join(output, "summary.json"), JSON.stringify(summary, null, 2));
  };
  const rejected = async (phase, expected, operation) => {
    try {
      await operation();
    } catch (error) {
      if (abort.signal.aborted) throw error;
      if (!expected.test(`${error.stderr ?? ""}${error.message}`)) throw error;
      summary.expectedFailures.push({ scenario: phase, detected: true });
      return;
    }
    throw new Error(`Acceptance failed to detect ${phase}.`);
  };
  let failure;
  let dockerReady = false;
  try {
    try {
      if ((await docker(["info", "--format", "{{.OSType}}"], 5000)).trim() !== "linux")
        throw new Error("Linux required");
    } catch {
      throw new Error(
        "Docker is unavailable. Start the Linux Docker engine and retry; it is never started automatically.",
      );
    }
    dockerReady = true;
    const lock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
    const version = lock.packages["node_modules/@playwright/test"].version;
    summary.artifactSha256 = await stage(
      context,
      input,
      harness,
      archive,
      version,
      payload,
      managed,
      setup,
      update,
      uninstall,
    );
    summary.playwright = version;
    const uid = process.platform === "linux" ? process.getuid() || 1000 : 1000;
    const gid = process.platform === "linux" ? process.getgid() : 1000;
    const label = ["--label", `${owner}=${id}`];
    const image = `${name}-customer`;
    const driver = `${name}-driver`;
    const installation = `${name}-installation`;
    const state = `${name}-state`;
    const mount = (type, source, target, readonly = false) => [
      "--mount",
      `type=${type},source=${source},target=${target}${readonly ? ",readonly" : ""}${type === "volume" ? ",volume-nocopy" : ""}`,
    ];
    const common = ["--platform", "linux/amd64", ...label, "--user", `${uid}:${gid}`];
    const fixtures = [
      ...mount("bind", input, "/input", true),
      ...mount("bind", harness, "/harness", true),
      ...mount("bind", output, "/evidence"),
    ];
    const volume = async (value) => {
      await docker(["volume", "create", ...label, value]);
    };
    const initialize = (volumes) =>
      docker([
        "run",
        "--rm",
        ...common,
        "--user",
        "0:0",
        "--network",
        "none",
        ...volumes,
        image,
        "node",
        "-e",
        `const fs=require('node:fs');for(const path of ['/installation','/work']){if(fs.existsSync(path)){fs.chownSync(path,${uid},${gid});fs.chmodSync(path,0o700)}}`,
      ]);
    await checked("build customer and driver images", async () => {
      for (const [file, tag] of [
        ["Customer.Dockerfile", image],
        ["Driver.Dockerfile", driver],
      ])
        await docker(
          [
            "build",
            "--platform",
            "linux/amd64",
            "--build-arg",
            `ACCEPTANCE_RUN=${id}`,
            "-f",
            join(context, file),
            "-t",
            tag,
            context,
          ],
          10 * 60_000,
        );
      summary.images = [];
      for (const tag of [image, driver]) {
        const [identity, architecture] = (
          await docker(["image", "inspect", "--format", "{{.Id}} {{.Architecture}}", tag])
        )
          .trim()
          .split(/\s+/);
        if (architecture !== "amd64" || !/^sha256:[a-f0-9]{64}$/.test(identity))
          throw new Error("Acceptance image architecture mismatch.");
        summary.images.push({ tag, identity, architecture });
      }
    });
    await volume(installation);
    await volume(state);
    await initialize([
      ...mount("volume", installation, "/installation"),
      ...mount("volume", state, "/work"),
    ]);
    await checked(
      update
        ? "offline managed update preparation"
        : payload
          ? "verified payload extraction without npm"
          : "online installation from read-only local artifact",
      async () => {
        await docker(
          [
            "run",
            "--rm",
            ...common,
            "--network",
            payload ? "none" : "bridge",
            ...(update
              ? [
                  "--workdir",
                  "/harness",
                  "-e",
                  "TMPDIR=/work",
                  "-e",
                  "CODE60_ACCEPTANCE_UPDATE_HANDOFF=1",
                ]
              : []),
            ...fixtures,
            ...mount("volume", installation, "/installation"),
            ...mount("volume", state, "/work"),
            image,
            "node",
            update
              ? "/harness/scripts/test-update.mjs"
              : setup
                ? "/harness/install-setup.mjs"
                : managed
                  ? "/harness/install-managed.mjs"
                  : payload
                    ? "/harness/test/clean-install/install-payload.mjs"
                    : "/harness/install.mjs",
            ...(update ? ["/input/descriptor.json"] : []),
          ],
          (update ? 10 : payload ? 4 : 7) * 60_000,
        );
      },
    );
    if (update) {
      await checked("verified update handoff and bootstrap cache removal", async () => {
        const text = await docker([
          "run",
          "--rm",
          ...common,
          "--network",
          "none",
          ...mount("volume", state, "/work"),
          image,
          "node",
          "-e",
          "process.stdout.write(require('node:fs').readFileSync('/work/control/update-layout.json','utf8'))",
        ]);
        const installed = updateAcceptanceLayout(JSON.parse(text));
        await writeFile(
          join(harness, "layout.json"),
          JSON.stringify({ ...installed, setup: true, update: true }),
        );
        await rm(join(harness, "build"), { recursive: true });
        await rm(join(harness, "bootstrap"), { recursive: true });
        summary.updatedInstallation = installed;
      });
    }
    const runtime = `${name}-runtime`;
    const start = async (container, work, extra = [], override = [], scenario = "baseline") => {
      return docker([
        "run",
        "--detach",
        "--name",
        container,
        ...common,
        "--network",
        "none",
        ...fixtures,
        ...mount("volume", installation, "/installation", !setup),
        ...(setup
          ? ["releases", "activations"].flatMap((part) => [
              "--mount",
              `type=volume,source=${installation},target=/installation/code60/${part},volume-subpath=code60/${part},readonly,volume-nocopy`,
            ])
          : []),
        ...mount("volume", work, "/work"),
        ...extra,
        "-e",
        "HOME=/work/home",
        "-e",
        "XDG_CONFIG_HOME=/work/home/config",
        "-e",
        "XDG_STATE_HOME=/work/home/state",
        "-e",
        "SHELL=/bin/sh",
        "-e",
        "PATH=/harness/bin:/usr/local/bin:/usr/bin:/bin",
        "-e",
        `ACCEPTANCE_CASE=${scenario}`,
        image,
        ...override,
      ]);
    };
    const probe = (container, ...values) =>
      docker(["exec", container, "node", "/harness/probe.mjs", ...values], 130_000);
    summary.runtimeContainer = { name: runtime, identity: (await start(runtime, state)).trim() };
    await checked("independent runtime isolation inspection", async () => {
      const shape =
        '{"network":{{json .HostConfig.NetworkMode}},"user":{{json .Config.User}},"mounts":{{json .Mounts}},"ports":{{json .HostConfig.PortBindings}}}';
      const observed = JSON.parse(await docker(["inspect", "--format", shape, runtime]));
      const allowed = new Map([
        ["/input", input],
        ["/harness", harness],
        ["/evidence", output],
      ]);
      if (
        observed.network !== "none" ||
        observed.user !== `${uid}:${gid}` ||
        Object.keys(observed.ports ?? {}).length ||
        observed.mounts.length !== (setup ? 7 : 5)
      )
        throw new Error("Customer isolation inspection failed.");
      for (const item of observed.mounts) {
        if (item.Type === "bind") {
          if (
            allowed.get(item.Destination) !== item.Source ||
            (item.Destination !== "/evidence" && item.RW)
          )
            throw new Error("Unexpected customer bind mount.");
        } else if (
          item.Type !== "volume" ||
          ![
            "/installation",
            "/work",
            ...(setup ? ["/installation/code60/releases", "/installation/code60/activations"] : []),
          ].includes(item.Destination) ||
          (item.Destination === "/installation" && item.RW !== setup) ||
          (setup &&
            ["/installation/code60/releases", "/installation/code60/activations"].includes(
              item.Destination,
            ) &&
            item.RW)
        )
          throw new Error("Unexpected customer volume mount.");
      }
      summary.isolation = observed;
    });
    await checked("offline CLI, assets and real embeddings", async () => {
      await probe(runtime, "ready");
      await probe(runtime, "cli");
      await probe(runtime, "model");
    });
    await checked("installed first-use golden journey", async () => {
      await docker(
        [
          "run",
          "--name",
          `${name}-browser`,
          ...common,
          "--network",
          `container:${runtime}`,
          "-e",
          "HOME=/work/driver-home",
          "-e",
          "SHELL=/bin/sh",
          ...mount("volume", state, "/work"),
          ...(setup
            ? [
                "--mount",
                `type=volume,source=${installation},target=/installation/code60/databases,volume-subpath=code60/databases,readonly,volume-nocopy`,
              ]
            : []),
          ...mount("bind", output, "/evidence"),
          driver,
        ],
        190_000,
      );
    });
    if (uninstall) {
      await checked("owned uninstall and retained-data reinstall", async () => {
        const maintenance = `${name}-maintenance`;
        await docker([
          "create",
          "--name",
          maintenance,
          ...common,
          "--network",
          `container:${runtime}`,
          "--pid",
          `container:${runtime}`,
          ...fixtures,
          ...mount("volume", installation, "/installation"),
          ...mount("volume", state, "/work"),
          "--entrypoint",
          "node",
          image,
          "/harness/test/clean-install/uninstall.mjs",
        ]);
        const observed = JSON.parse(
          await docker([
            "inspect",
            "--format",
            '{"network":{{json .HostConfig.NetworkMode}},"pid":{{json .HostConfig.PidMode}},"user":{{json .Config.User}},"mounts":{{json .Mounts}},"ports":{{json .HostConfig.PortBindings}}}',
            maintenance,
          ]),
        );
        const namespaces = new Set([
          `container:${runtime}`,
          `container:${summary.runtimeContainer.identity}`,
        ]);
        const allowed = new Map([
          ["/input", input],
          ["/harness", harness],
          ["/evidence", output],
        ]);
        if (
          !namespaces.has(observed.network) ||
          !namespaces.has(observed.pid) ||
          observed.user !== `${uid}:${gid}` ||
          Object.keys(observed.ports ?? {}).length ||
          observed.mounts.length !== 5
        )
          throw Error("Maintenance customer namespace isolation inspection failed");
        for (const item of observed.mounts) {
          if (item.Type === "bind") {
            if (
              allowed.get(item.Destination) !== item.Source ||
              (item.Destination !== "/evidence" && item.RW)
            )
              throw Error("Unexpected maintenance customer bind mount");
          } else if (
            item.Type !== "volume" ||
            !item.RW ||
            !new Map([
              ["/installation", installation],
              ["/work", state],
            ]).has(item.Destination) ||
            item.Name !==
              new Map([
                ["/installation", installation],
                ["/work", state],
              ]).get(item.Destination)
          )
            throw Error("Unexpected maintenance customer volume mount");
        }
        summary.maintenanceIsolation = observed;
        await docker(["start", "--attach", maintenance], 9 * 60_000);
        const exit = (
          await docker(["inspect", "--format", "{{.State.ExitCode}}", maintenance])
        ).trim();
        if (exit !== "0") throw Error("Installed uninstall/reinstall maintenance failed");
        await probe(runtime, "ready");
        await probe(runtime, "model");
      });
      await checked("reinstalled browser preserves project and database", async () => {
        await docker(
          [
            "run",
            "--name",
            `${name}-reinstalled-browser`,
            ...common,
            "--network",
            `container:${runtime}`,
            "-e",
            "HOME=/work/driver-home",
            "-e",
            "ACCEPTANCE_REINSTALLED=1",
            ...mount("volume", state, "/work"),
            "--mount",
            `type=volume,source=${installation},target=/installation/code60/databases,volume-subpath=code60/databases,readonly,volume-nocopy`,
            ...mount("bind", output, "/evidence"),
            driver,
          ],
          190_000,
        );
      });
    }
    await checked("backend/provider/helper process shutdown", async () => {
      await probe(runtime, "request-stop");
      await probe(runtime, "stopped");
      await probe(runtime, "verify-cleanup");
    });
    await checked("architecture and leaked-child detection", async () => {
      await rejected("wrong architecture", /runtime architecture mismatch/, () =>
        probe(runtime, "architecture", "arm64"),
      );
      await probe(runtime, "leak");
      await rejected("leaked child", /Installed process leak detected/, () =>
        probe(runtime, "verify-cleanup"),
      );
      await rejected(
        "supervisor mutation",
        /refuses (?:native|unexpected backend) supervisor(?:\/opener)? mutations/,
        () =>
          docker([
            "exec",
            runtime,
            "/harness/bin/systemctl",
            "--user",
            "enable",
            "--now",
            setup ? "unexpected.service" : "code60-backend.service",
          ]),
      );
    });
    await checked("missing renderer/model detection", async () => {
      for (const [kind, target] of [
        ["assets", "/dist/renderer"],
        ["model", "/models"],
      ]) {
        const work = `${name}-${kind}-state`;
        const mask = `${name}-${kind}-mask`;
        const container = `${name}-${kind}`;
        await volume(work);
        await volume(mask);
        await initialize(mount("volume", work, "/work"));
        await start(
          container,
          work,
          mount(
            "volume",
            mask,
            `${summary.updatedInstallation?.application ?? (setup ? `/installation/code60/releases/${payload.archive.sha256}` : managed ? `/installation/customer-home/.local/share/code60/releases/${payload.archive.sha256}` : "/installation/product/node_modules/code60")}${target}`,
            true,
          ),
          kind === "model" ? ["sleep", "infinity"] : [],
          kind,
        );
        await rejected(
          `missing ${kind}`,
          kind === "model"
            ? /Installed bundled model assets are missing/
            : /Installed browser assets are unavailable/,
          () => probe(container, kind),
        );
        if (kind === "assets") {
          await probe(container, "request-stop");
          await probe(container, "stopped");
        }
      }
    });
    summary.status = "passed";
  } catch (error) {
    failure = error;
  } finally {
    clearTimeout(deadline);
    const cleanupAbort = new AbortController();
    const cleanupDeadline = setTimeout(() => cleanupAbort.abort(), 90_000);
    try {
      summary.cleanup = dockerReady
        ? await cleanupAcceptance(
            (file, argv) =>
              command(file, argv, {
                signal: cleanupAbort.signal,
                timeout: 35_000,
                log: join(output, `${String(++logIndex).padStart(2, "0")}-cleanup-${argv[0]}.log`),
              }),
            id,
          )
        : { resourcesCreated: false };
    } catch (error) {
      summary.status = "failed";
      summary.cleanup = {
        failed: true,
        remaining: error.inventory ?? null,
        verificationUnavailable: !error.inventory,
      };
      failure = new AggregateError(
        [...(failure ? [failure] : []), error],
        "Acceptance cleanup did not complete.",
      );
    } finally {
      clearTimeout(cleanupDeadline);
    }
    ports.signal?.removeEventListener("abort", forwardAbort);
    if (abort.signal.aborted && !failure)
      failure = new Error("Acceptance interrupted or timed out.");
    await rm(temporary, { recursive: true, force: true });
    summary.status = failure ? "failed" : summary.status;
    await writeFile(join(output, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  }
  if (failure)
    throw Object.assign(new Error(`${failure.message}\nEvidence: ${output}`, { cause: failure }), {
      aborted: abort.signal.aborted,
    });
  await progress(`Clean installation passed. Evidence: ${output}`, {
    id,
    output,
    runtimeContainer: summary.runtimeContainer,
  });
  return summary;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController();
  let exitCode;
  const interrupt = () => {
    exitCode = 130;
    controller.abort();
  };
  const terminate = () => {
    exitCode = 143;
    controller.abort();
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", terminate);
  try {
    await runCleanInstall(repository, process.argv.slice(2), { signal: controller.signal });
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = exitCode ?? 1;
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", terminate);
    if (exitCode !== undefined) process.exitCode = exitCode;
  }
}
