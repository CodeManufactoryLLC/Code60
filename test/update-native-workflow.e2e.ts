import { execFile, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { test as baseTest, expect, type TestInfo } from "@playwright/test";
import type { LocalTransmission as TransmissionFactory } from "../src/application/index.js";
import type { installManagedRelease as InstallFactory } from "../src/management/index.js";
import type {
  acquirePayload as AcquireFactory,
  PayloadDescriptor,
  resolveTransmissionRuntime as RuntimeFactory,
} from "../src/platform/index.js";
import { expandNavigation, onboard } from "./fixtures/browser-actions.js";
import { commitFixture } from "./fixtures/git-repository.js";
import {
  nativeProcessAlive,
  nativeProcessFamily,
  stopNativeEngines,
} from "./fixtures/transmission-processes.js";
import { transmissionProvider } from "./fixtures/transmission-provider.js";

const execute = promisify(execFile);
interface Supervisor {
  socket: string;
  calls: unknown[];
  pid(): number | null;
  close(): Promise<void>;
}
interface UpdateFixture {
  descriptor: PayloadDescriptor;
  archive: string;
  bootstrap: string;
  registry: unknown;
}

async function prepareInstallation(info: TestInfo) {
  if (`${process.platform}-${process.arch}` !== "darwin-arm64")
    throw Error("Native update acceptance requires macOS arm64");
  const root = resolve(".");
  const identity = JSON.parse(
    await readFile(join(root, "release/payloads/darwin-arm64.json"), "utf8"),
  ) as PayloadDescriptor;
  const input = join(root, "release/payloads", identity.archive.name);
  const directory = await realpath(await mkdtemp(join(tmpdir(), "code60 active update ' ")));
  const owner = await lstat(directory, { bigint: true });
  const home = join(directory, "home"),
    bin = join(directory, "bin"),
    repo = join(home, "workflow repository");
  const env = {
    HOME: home,
    SHELL: "/bin/bash",
    PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
    XDG_DATA_HOME: join(home, "data"),
    XDG_CONFIG_HOME: join(home, "config"),
    XDG_STATE_HOME: join(home, "state"),
    CODEX_HOME: join(home, "workflow-codex"),
    CODE60_TEST_BACKEND_SOCKET: "",
    CODE60_TEST_FORBIDDEN_LOG: join(home, "forbidden.log"),
  };
  // Leave cleanup time inside the fixture's six-minute setup budget.
  const signal = AbortSignal.timeout(330000);
  const started = performance.now();
  const checkpoints: { stage: string; elapsedMs: number }[] = [];
  const checkpoint = async (stage: string) => {
    checkpoints.push({ stage, elapsedMs: performance.now() - started });
    await writeFile(
      info.outputPath("installation-preparation.json"),
      JSON.stringify({
        input: identity,
        fixture: {
          path: directory,
          dev: String(owner.dev),
          ino: String(owner.ino),
          uid: String(owner.uid),
        },
        checkpoints,
      }),
      { mode: 0o600 },
    );
  };
  try {
    for (const path of [
      home,
      bin,
      repo,
      env.CODEX_HOME,
      join(home, "processes"),
      join(env.XDG_CONFIG_HOME, "code60"),
    ])
      await mkdir(path, { recursive: true, mode: 0o700 });
    const { installManagedRelease } = (await import(
      pathToFileURL(join(root, "build/distribution/management/index.js")).href
    )) as { installManagedRelease: typeof InstallFactory };
    const { acquirePayload } = (await import(
      pathToFileURL(join(root, "dist/platform/index.js")).href
    )) as { acquirePayload: typeof AcquireFactory };
    const { updateFixture } = (await import(
      pathToFileURL(join(root, "scripts/distribution/update-fixture.mjs")).href
    )) as {
      updateFixture(
        identity: PayloadDescriptor,
        parent: string,
        transport: () => ReturnType<typeof createReadStream>,
        signal?: AbortSignal,
      ): Promise<UpdateFixture>;
    };
    await checkpoint("preparing-candidate");
    const candidate = await updateFixture(
      identity,
      directory,
      () => createReadStream(input),
      signal,
    );
    await checkpoint("candidate-ready");
    const installed = await installManagedRelease({
      env,
      signal,
      runtimeDirectory: join(root, "build/distribution"),
      artifact: {
        identity,
        acquire: ({ parent, signal: requestSignal }) =>
          acquirePayload(identity, {
            parent,
            signal: requestSignal ?? signal,
            transport: () => createReadStream(input),
          }),
      },
    });
    await checkpoint("installation-ready");
    return { root, identity, directory, home, bin, repo, env, candidate, installed };
  } catch (error) {
    // No backend, provider or engine has been started during file preparation.
    // Only this fresh synthetic customer's verified directory can be removed.
    try {
      const current = await lstat(directory, { bigint: true });
      if (
        !current.isDirectory() ||
        current.dev !== owner.dev ||
        current.ino !== owner.ino ||
        current.uid !== owner.uid ||
        current.mode !== owner.mode
      )
        throw Error("Native update preparation cleanup ownership changed");
      await rm(directory, { recursive: true });
      await checkpoint("preparation-failed-cleaned");
    } catch (cleanup) {
      throw new AggregateError(
        [error, cleanup],
        "Native update preparation failed; preserved uncertain fixture",
      );
    }
    throw error;
  }
}

const test = baseTest.extend<{ installation: Awaited<ReturnType<typeof prepareInstallation>> }>({
  installation: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright requires a destructured dependency list; this fixture has none.
    async ({}, use, info) => use(await prepareInstallation(info)),
    { timeout: 360000 },
  ],
});

for (const engineVersion of ["0.1.0-staging.20", "0.1.0-staging.18"] as const)
  test(`native update: ${engineVersion} ${engineVersion.endsWith("18") ? "retained uncertain start" : "approved workflow"} keeps its original engine while the application is replaced`, async ({
    browser,
    installation,
  }, info) => {
    test.setTimeout(360000);
    const { root, identity, directory, home, bin, repo, env, installed, candidate } = installation;
    const engineRoot = join(env.XDG_STATE_HOME, `code60/workflows/transmission-${engineVersion}`);
    const owned = new Set<number>();
    let supervisor: Supervisor | undefined;
    let server: ReturnType<typeof createServer> | undefined;
    let context: Awaited<ReturnType<typeof browser.newContext>> | undefined;
    let provider: Awaited<ReturnType<typeof transmissionProvider>> | undefined;
    const errors: unknown[] = [];
    try {
      const bindings = new Map<string, string>();
      for (const version of ["0.1.0-staging.18", "0.1.0-staging.20"])
        bindings.set(
          version,
          await readFile(join(installed.root, "engines", `${version}.json`), "utf8"),
        );
      await cp(
        join(root, "test/fixtures/backend-supervisor-command.mjs"),
        join(bin, "supervisor.mjs"),
      );
      await chmod(join(bin, "supervisor.mjs"), 0o700);
      for (const command of ["systemctl", "launchctl", "xdg-open"])
        await symlink("supervisor.mjs", join(bin, command));
      const fake = join(directory, "provider");
      await mkdir(fake, { mode: 0o700 });
      for (const name of ["fake-agent.mjs", "fake-agent-app.mjs"])
        await cp(join(root, "test/fixtures", name), join(fake, name));
      await symlink(join(installed.release, "node_modules"), join(fake, "node_modules"));
      await writeFile(
        join(env.XDG_CONFIG_HOME, "code60/config.json"),
        JSON.stringify({
          agents: {
            claude: {
              command: [
                process.execPath,
                join(fake, "fake-agent.mjs"),
                "--relay",
                "--session-info",
                "--process-log",
                join(home, "processes"),
              ],
            },
          },
        }),
        { mode: 0o600 },
      );
      provider = await transmissionProvider();
      await writeFile(join(env.CODEX_HOME, "config.toml"), provider.toml, { mode: 0o600 });
      const { backendSupervisor } = (await import(
        pathToFileURL(join(root, "test/fixtures/backend-supervisor.mjs")).href
      )) as {
        backendSupervisor(options: {
          directory: string;
          application: string;
          candidateApplication: string;
          env: NodeJS.ProcessEnv;
          log: string;
        }): Promise<Supervisor>;
      };
      supervisor = await backendSupervisor({
        directory: join(directory, "supervisor"),
        application: installed.release,
        candidateApplication: join(installed.root, "releases", candidate.descriptor.archive.sha256),
        env,
        log: info.outputPath("backend.log"),
      });
      env.CODE60_TEST_BACKEND_SOCKET = supervisor.socket;
      await execute(installed.launcher, ["setup", "--yes", "--no-open"], {
        env,
        cwd: "/",
        timeout: 60000,
      });
      await execute(installed.launcher, ["service", "stop", "--yes"], {
        env,
        cwd: "/",
        timeout: 30000,
      });
      const selection = join(env.XDG_STATE_HOME, "code60/desktop.json");
      const preferences = JSON.parse(await readFile(selection, "utf8"));
      const customDatabase = join(home, "custom database.sqlite");
      await cp(preferences.database, customDatabase);
      await writeFile(
        selection,
        JSON.stringify({
          ...preferences,
          database: customDatabase,
          updateFixtureUnrelated: "preserve",
        }),
        { mode: 0o600 },
      );
      for (const command of ["npm", "npx", "clang", "cc", "gcc", "make"])
        await writeFile(
          join(bin, command),
          '#!/bin/sh\nprintf "%s\\n" "$0" >> "$CODE60_TEST_FORBIDDEN_LOG"\nexit 91\n',
          { mode: 0o700 },
        );
      const git = (...args: string[]) =>
        execFileSync("/usr/bin/git", ["-C", repo, ...args], {
          env,
          encoding: "utf8",
          timeout: 10000,
        }).trim();
      git("init", "-q", "-b", "main");
      await writeFile(join(repo, "source.txt"), "committed\n");
      git("add", ".");
      commitFixture(repo);
      await writeFile(join(repo, "source.txt"), "staged\n");
      git("add", ".");
      await writeFile(join(repo, "source.txt"), "saved unstaged\n");
      const index = await readFile(join(repo, ".git/index")),
        head = git("rev-parse", "HEAD");
      const { LocalTransmission } = (await import(
        pathToFileURL(join(installed.release, "dist/application/index.js")).href
      )) as { LocalTransmission: typeof TransmissionFactory };
      const engineClient = new LocalTransmission(engineRoot, env, engineVersion);
      const engine = (operation: string, args: Record<string, unknown> = {}) =>
        engineClient.call(operation, args);
      const registryPath = join(env.XDG_STATE_HOME, "code60/workflows/registry.json");
      let retainedRunId: string | undefined;
      if (engineVersion.endsWith("18")) {
        const id = randomUUID(),
          key = randomUUID(),
          branch = `code60/transmission-${id}`;
        const worktree = join(home, "retained execution");
        git("worktree", "add", "-qb", branch, worktree);
        await engineClient.connect(AbortSignal.timeout(30000));
        const definition = {
          name: "Work across application update",
          tasks: [
            {
              name: "Retain native work",
              instructions:
                "Create workflow-result.txt containing isolated native workflow; preserve source.txt.",
              verify: "Read workflow-result.txt and verify it contains isolated native workflow.",
              checks: [],
            },
          ],
          repairs: 2,
          retries: 2,
          autoApprove: true,
        };
        // Historical starting state: an approved staging.18 start reached its
        // engine but its original backend lost the acknowledgement. This fixture
        // is separate from the visible first-use approval journey above.
        retainedRunId = (
          (await engine("start_workflow", {
            repository: worktree,
            tasks: definition.tasks,
            confirmed: true,
            idempotencyKey: key,
            repairs: 2,
            retries: 2,
            autoApprove: true,
          })) as { runId: string }
        ).runId;
        const fileIdentity = async (path: string) => {
          const entry = await stat(path, { bigint: true });
          return `${path}:${entry.dev}:${entry.ino}`;
        };
        await writeFile(
          registryPath,
          JSON.stringify({
            format: 1,
            version: engineVersion,
            entries: [
              {
                id,
                key,
                branch,
                name: definition.name,
                definition,
                repository: repo,
                worktree,
                baseline: head,
                repositoryIdentity: await fileIdentity(repo),
                repositoryGitIdentity: await fileIdentity(join(repo, ".git")),
                worktreeIdentity: await fileIdentity(worktree),
                createdAt: new Date().toISOString(),
                state: "uncertain",
                engineVersion,
              },
            ],
          }),
          { mode: 0o600 },
        );
      }
      await execute(installed.launcher, ["service", "start"], { env, cwd: "/", timeout: 30000 });
      await expect
        .poll(
          async () =>
            JSON.parse(
              (
                await execute(installed.launcher, ["service", "status"], {
                  env,
                  cwd: "/",
                  timeout: 15000,
                })
              ).stdout,
            ).service?.appVersion,
          { timeout: 30000 },
        )
        .toBe(identity.version);
      const connection = async () =>
        JSON.parse(
          await readFile(join(env.XDG_STATE_HOME, "code60/gateway/connection.json"), "utf8"),
        ) as { origin: string; pid: number };
      context = await browser.newContext();
      const page = await context.newPage();
      await page.goto((await connection()).origin);
      await onboard(page);
      await expandNavigation(page, "Automation");
      await page.locator("#tab-workflows").click();
      if (engineVersion.endsWith("18")) {
        await page.getByRole("tab", { name: "Execution history", exact: true }).click();
        await page.getByRole("button", { name: /Work across application update/ }).click();
        await expect(
          page.getByRole("button", { name: "Recover same start request", exact: true }),
        ).toBeVisible();
      } else {
        await page.getByRole("button", { name: "New workflow", exact: true }).click();
        const form = page.getByRole("region", { name: "New workflow", exact: true });
        await form
          .getByLabel("Workflow name", { exact: true })
          .fill("Work across application update");
        await form.getByRole("button", { name: "Choose repository", exact: true }).click();
        const chooser = page.getByRole("dialog", { name: "Choose folder", exact: true });
        await chooser.getByRole("option", { name: home, exact: true }).dblclick();
        await chooser.getByRole("option", { name: "workflow repository", exact: true }).dblclick();
        await chooser.getByRole("button", { name: "Choose folder", exact: true }).click();
        await form.getByLabel("Task name", { exact: true }).fill("Retain native work");
        await form
          .getByLabel("Implementation instructions", { exact: true })
          .fill(
            "Create workflow-result.txt containing isolated native workflow; preserve source.txt.",
          );
        await form
          .getByLabel("Verification criteria", { exact: true })
          .fill("Read workflow-result.txt and verify it contains isolated native workflow.");
        await form.getByRole("button", { name: "Review workflow", exact: true }).click();
        await form.getByRole("button", { name: "Start workflow", exact: true }).click();
      }
      await expect.poll(() => provider?.pending, { timeout: 30000 }).toBeGreaterThan(0);
      const enginePid = ((await engine("health")) as { pid: number }).pid;
      for (const pid of nativeProcessFamily(enginePid)) owned.add(pid);
      expect(owned.size).toBeGreaterThan(2);
      const processSnapshot = () =>
        execFileSync("/bin/ps", ["-p", [...owned].join(","), "-o", "pid=,ppid=,comm="], {
          encoding: "utf8",
          timeout: 5000,
        });
      const processesBefore = processSnapshot();
      const { resolveTransmissionRuntime } = (await import(
        pathToFileURL(join(installed.release, "dist/platform/index.js")).href
      )) as { resolveTransmissionRuntime: typeof RuntimeFactory };
      const runtime = await resolveTransmissionRuntime(env, engineVersion);
      // Codex may briefly spawn Git initialization helpers. Track all descendants
      // for cleanup; require continuity of the actual engine, ACP and Codex workers.
      const workers = processesBefore
        .trim()
        .split("\n")
        .map((row) => /^\s*(\d+)\s+\d+\s+(.+)$/.exec(row))
        .filter((row) => row && [runtime.node, runtime.codex].includes(row[2] ?? ""))
        .map((row) => Number(row?.[1]));
      expect(workers.length).toBeGreaterThanOrEqual(3);
      expect(workers).toContain(enginePid);
      await info.attach("native-processes-before", {
        contentType: "text/plain",
        body: processesBefore,
      });
      type Registry = {
        entries: {
          key: string;
          worktree: string;
          engineVersion?: string;
          snapshot?: { runId: string };
        }[];
      };
      const before = JSON.parse(await readFile(registryPath, "utf8")) as Registry;
      expect(before.entries).toHaveLength(1);
      const originalRunId = retainedRunId ?? before.entries[0]?.snapshot?.runId;
      expect(originalRunId).toBeTruthy();
      const databaseHash = createHash("sha256")
        .update(await readFile(customDatabase))
        .digest("hex");
      const prior = await readlink(join(installed.root, "current")),
        priorPid = supervisor.pid();
      await context.close();
      context = undefined;
      server = createServer((request, response) => {
        if (request.url === "/metadata") {
          response.end(JSON.stringify(candidate.registry));
          return;
        }
        const file =
          request.url === "/bootstrap"
            ? candidate.bootstrap
            : request.url === "/payload"
              ? candidate.archive
              : null;
        if (!file) {
          response.statusCode = 404;
          response.end();
          return;
        }
        createReadStream(file)
          .on("error", () => response.destroy())
          .pipe(response);
      });
      const artifactServer = server;
      await new Promise<void>((ready, reject) => {
        artifactServer.once("error", reject);
        artifactServer.listen(0, "127.0.0.1", ready);
      });
      const address = server.address();
      if (!address || typeof address === "string") throw Error("No update artifact listener");
      const updateInput = join(directory, "update.json");
      await writeFile(
        updateInput,
        JSON.stringify({
          application: installed.release,
          version: candidate.descriptor.version,
          payloadUrl: candidate.descriptor.archive.url,
          origin: `http://127.0.0.1:${address.port}`,
          progressLog: info.outputPath("update-progress.jsonl"),
        }),
        { mode: 0o600 },
      );
      const updated = await execute(
        process.execPath,
        [join(root, "test/fixtures/update-command.mjs"), updateInput, "--yes"],
        { env, cwd: "/", timeout: 180000, maxBuffer: 1024 ** 2 },
      );
      await writeFile(info.outputPath("update.log"), updated.stdout + updated.stderr);
      expect(updated.stdout).toContain("is ready");
      expect(await readlink(join(installed.root, "current"))).not.toBe(prior);
      expect(supervisor.pid()).not.toBe(priorPid);
      expect(nativeProcessAlive(priorPid as number)).toBe(false);
      expect(((await engine("health")) as { pid: number }).pid).toBe(enginePid);
      await info.attach("native-processes-after", {
        contentType: "text/plain",
        body: processSnapshot(),
      });
      for (const pid of workers)
        expect(nativeProcessAlive(pid), `Original native worker ${pid} remains alive`).toBe(true);
      for (const [version, bytes] of bindings)
        expect(await readFile(join(installed.root, "engines", `${version}.json`), "utf8")).toBe(
          bytes,
        );
      expect(
        createHash("sha256")
          .update(await readFile(customDatabase))
          .digest("hex"),
      ).toBe(databaseHash);
      expect(JSON.parse(await readFile(selection, "utf8"))).toMatchObject({
        database: customDatabase,
        updateFixtureUnrelated: "preserve",
      });
      context = await browser.newContext();
      const reopened = await context.newPage();
      await reopened.goto((await connection()).origin);
      await expandNavigation(reopened, "Automation");
      await reopened.locator("#tab-workflows").click();
      await reopened.getByRole("tab", { name: "Execution history", exact: true }).click();
      await reopened.getByRole("button", { name: /Work across application update/ }).click();
      if (engineVersion.endsWith("18"))
        await reopened
          .getByRole("button", { name: "Recover same start request", exact: true })
          .click();
      provider.setMode("complete");
      await expect(reopened.locator(".workflow-task-list summary")).toContainText("Accepted", {
        timeout: 60000,
      });
      await reopened.getByText("Accepted diff", { exact: true }).click();
      await reopened.getByRole("button", { name: "Load accepted diff", exact: true }).click();
      await expect(
        reopened.locator("pre").filter({ hasText: "workflow-result.txt" }),
      ).toBeVisible();
      const after = JSON.parse(await readFile(registryPath, "utf8")) as Registry;
      expect(after.entries).toHaveLength(1);
      expect(after.entries[0]?.key).toBe(before.entries[0]?.key);
      expect(after.entries[0]?.snapshot?.runId).toBe(originalRunId);
      expect(after.entries[0]?.engineVersion).toBe(engineVersion);
      const retained = after.entries[0];
      if (!retained) throw Error("Updated installation lost its approved workflow");
      expect(await readFile(join(retained.worktree, "workflow-result.txt"), "utf8")).toBe(
        "isolated native workflow\n",
      );
      expect(await readFile(join(repo, "source.txt"), "utf8")).toBe("saved unstaged\n");
      expect(await readFile(join(repo, ".git/index"))).toEqual(index);
      expect(git("rev-parse", "HEAD")).toBe(head);
      expect(((await engine("health")) as { pid: number }).pid).toBe(enginePid);
      expect(provider.calls.filter((call) => call.tool).length).toBeGreaterThan(0);
      await expect(stat(env.CODE60_TEST_FORBIDDEN_LOG)).rejects.toMatchObject({ code: "ENOENT" });
      await info.attach("update-native-outcomes", {
        contentType: "application/json",
        body: JSON.stringify({
          enginePid,
          engineVersion,
          startingState: retainedRunId
            ? "historical approved start with lost acknowledgement"
            : "visible first-use approval",
          workerPids: workers,
          backendChanged: true,
          originalRuntimeBindingsPreserved: true,
          runId: after.entries[0]?.snapshot?.runId,
          customDatabasePreserved: true,
          keyPreserved: true,
          nativeTools: provider.calls.filter((call) => call.tool).length,
          indexPreserved: true,
          headPreserved: true,
        }),
      });
      await reopened.screenshot({ path: info.outputPath("updated-native-workflow.png") });
    } catch (error) {
      errors.push(error);
    } finally {
      for (const close of [() => context?.close(), () => supervisor?.close()])
        try {
          await close();
        } catch (error) {
          errors.push(error);
        }
      try {
        const logs = await readdir(join(home, "processes"));
        for (const name of logs) {
          const value = JSON.parse(await readFile(join(home, "processes", name), "utf8")) as {
            pid: number;
          };
          if (!Number.isSafeInteger(value.pid) || value.pid < 1) {
            errors.push(Error("Invalid provider process evidence"));
            continue;
          }
          owned.add(value.pid);
          if (nativeProcessAlive(value.pid))
            errors.push(Error("Owned application provider survived backend shutdown"));
        }
      } catch (error) {
        errors.push(error);
      }
      try {
        await stopNativeEngines([engineRoot], owned);
      } catch (error) {
        errors.push(error);
      }
      if (server) {
        server.closeAllConnections();
        const artifactServer = server;
        await new Promise<void>((done) => artifactServer.close(() => done()));
      }
      try {
        await provider?.close();
      } catch (error) {
        errors.push(error);
      }
      const remaining = [...owned].filter(nativeProcessAlive);
      await info.attach("cleanup", {
        contentType: "application/json",
        body: JSON.stringify({
          owned: [...owned],
          remaining,
          backendExited: !supervisor || supervisor.pid() === null,
          failures: errors.length,
        }),
      });
      if (!errors.length && !remaining.length) await rm(directory, { recursive: true });
    }
    if (errors.length)
      throw new AggregateError(
        errors,
        `Native workflow update acceptance failed; preserved ${directory}`,
      );
  });
