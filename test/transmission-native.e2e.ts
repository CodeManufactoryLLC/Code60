import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import type { LocalTransmission as ClientFactory } from "../src/application/index.js";
import { defaultWorkflowEngine } from "../src/contracts/index.js";
import type { startGateway as GatewayFactory } from "../src/gateway/index.js";
import type { preserveTransmissionBundle as PreserveFactory } from "../src/platform/index.js";
import { commitFixture } from "./fixtures/git-repository.js";
import {
  nativeProcessAlive as alive,
  nativeProcessFamily as family,
  stopNativeEngines,
} from "./fixtures/transmission-processes.js";
import { transmissionProvider } from "./fixtures/transmission-provider.js";

const checkout = resolve(import.meta.dirname, "..");
const root = process.env.CODE60_TEST_INSTALLED_ROOT
  ? resolve(process.env.CODE60_TEST_INSTALLED_ROOT)
  : checkout;
const { startGateway } = (await import(
  pathToFileURL(join(root, "dist/gateway/index.js")).href
)) as {
  startGateway: typeof GatewayFactory;
};
const { preserveTransmissionBundle } = (await import(
  pathToFileURL(join(root, "dist/platform/index.js")).href
)) as {
  preserveTransmissionBundle: typeof PreserveFactory;
};
const { LocalTransmission } = (await import(
  pathToFileURL(join(root, "dist/application/index.js")).href
)) as { LocalTransmission: typeof ClientFactory };
test("native workflow: bundled engine survives backend restart, pauses, resumes and verifies isolated edits", async ({
  browser,
}, info) => {
  if (!["darwin-arm64", "linux-x64"].includes(`${process.platform}-${process.arch}`))
    throw Error("Native Transmission acceptance requires macOS arm64 or Linux x64");
  const directory = await realpath(await mkdtemp(join(tmpdir(), "code60 native workflow ' ")));
  const home = join(directory, "home");
  const repo = join(home, "project");
  const provider = await transmissionProvider(repo + ".worktrees");
  const config = join(home, "config/code60");
  const shell = join(home, "test-shell");
  const forbidden = join(home, "forbidden-runtime-tools.log");
  const env = {
    HOME: home,
    SHELL: shell,
    PATH: `${home}/bin:/usr/bin:/bin`,
    XDG_CONFIG_HOME: join(home, "config"),
    XDG_STATE_HOME: join(home, "state"),
    XDG_DATA_HOME: join(home, "data"),
    CODEX_HOME: join(home, "codex"),
    // Application provider overrides cannot select the pinned workflow runtime.
    CODEX_PATH: join(home, "missing-application-codex"),
    CODEX_CONFIG: provider.config,
    CODE60_TEST_FORBIDDEN_LOG: forbidden,
    GIT_CONFIG_NOSYSTEM: "1",
  };
  const git = (...args: string[]) =>
    execFileSync("/usr/bin/git", ["-C", repo, ...args], { env, encoding: "utf8" }).trim();
  const engineRoot = join(
    env.XDG_STATE_HOME,
    `code60/workflows/transmission-${defaultWorkflowEngine(process.platform)}`,
  );
  const client = new LocalTransmission(engineRoot, env);
  let gateway: Awaited<ReturnType<typeof startGateway>> | undefined;
  let context: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  const owned = new Set<number>();
  let enginePid: number | undefined;
  const engine = (operation: string, args: Record<string, unknown> = {}) =>
    client.call(operation, args);
  const errors: unknown[] = [];
  try {
    for (const path of [repo, config, join(home, "codex"), join(home, "bin")])
      await mkdir(path, { recursive: true, mode: 0o700 });
    await writeFile(shell, '#!/bin/sh\nexec /bin/sh -c "$2"\n', { mode: 0o700 });
    for (const command of ["npm", "npx", "cc", "clang", "gcc", "make"])
      await writeFile(
        join(home, "bin", command),
        '#!/bin/sh\nprintf "%s\\n" "$0" >> "$CODE60_TEST_FORBIDDEN_LOG"\nexit 91\n',
        { mode: 0o700 },
      );
    git("init", "-q", "-b", "main");
    await writeFile(join(repo, "source.txt"), "committed\n");
    git("add", ".");
    commitFixture(repo);
    await writeFile(join(repo, "source.txt"), "staged\n");
    git("add", ".");
    await writeFile(join(repo, "source.txt"), "saved unstaged\n");
    const index = await readFile(join(repo, ".git/index"));
    const head = git("rev-parse", "HEAD");
    await writeFile(
      join(config, "config.json"),
      JSON.stringify({
        agents: {
          claude: { command: [process.execPath, join(checkout, "test/fixtures/fake-agent.mjs")] },
        },
      }),
    );
    const bundles = await readdir(join(root, "dist/engines"));
    if (bundles.length !== 1 || !/^[a-f0-9]{64}$/.test(bundles[0] ?? ""))
      throw Error("Prepare the native engine bundle before acceptance");
    await preserveTransmissionBundle(join(root, "dist/engines", bundles[0] as string), env);
    if (process.platform === "linux" && process.env.CODE60_TEST_INSTALLED_ROOT) {
      execFileSync(
        "/usr/bin/python3",
        [
          join(checkout, "test/fixtures/workflow-login-terminal.py"),
          process.execPath,
          join(root, "dist/management/main.js"),
        ],
        {
          env,
          timeout: 70_000,
          stdio: ["ignore", "ignore", "pipe"],
        },
      );
      await expect(readFile(join(engineRoot, "endpoint.json"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    }
    gateway = await startGateway({ env, roots: [home], assets: join(root, "dist/renderer") });
    context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    await page.goto(gateway.origin);
    const wizard = page.locator(".agent-setup-dialog");
    await wizard.getByRole("button", { name: "Claude", exact: true }).click();
    await expect(wizard.getByRole("status")).toHaveText("Claude connected");
    await wizard.getByRole("button", { name: "Close provider setup", exact: true }).click();
    await page.getByRole("button", { name: "Start", exact: true }).click();
    const open = async () => {
      await page.locator("#tab-apps").press("ArrowRight");
      await page.locator("#tab-workflows").click();
    };
    await open();
    await expect(readFile(join(engineRoot, "endpoint.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    async function review(page: Page, name: string) {
      await page.getByRole("button", { name: "Workflows actions" }).click();
      await page.getByRole("menuitem", { name: "New workflow", exact: true }).click();
      const form = page.getByRole("region", { name: "New workflow", exact: true });
      await form.getByLabel("Workflow name", { exact: true }).fill(name);
      await form.getByRole("button", { name: "Choose repository", exact: true }).click();
      const chooser = page.getByRole("dialog", { name: "Choose folder", exact: true });
      await chooser.getByRole("option", { name: home, exact: true }).dblclick();
      await chooser.getByRole("option", { name: "project", exact: true }).dblclick();
      await chooser.getByRole("button", { name: "Choose folder", exact: true }).click();
      await form.getByLabel("Task name", { exact: true }).fill("Write and verify isolated result");
      await form
        .getByLabel("Implementation instructions", { exact: true })
        .fill(
          "Create workflow-result.txt containing isolated native workflow and preserve source.txt.",
        );
      await form
        .getByLabel("Verification criteria", { exact: true })
        .fill("Read workflow-result.txt and verify it contains isolated native workflow.");
      await form.getByRole("button", { name: "Review workflow", exact: true }).click();
      await expect(
        form.getByText(
          "Use code60 workflows login in a terminal if Codex authentication is needed. Code60 provider connections are separate.",
          {
            exact: true,
          },
        ),
      ).toBeVisible();
      return form;
    }
    const form = await review(page, "Native preserved execution");
    await expect(readFile(join(engineRoot, "endpoint.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await form.getByRole("button", { name: "Start workflow", exact: true }).click();
    const workflows = page.locator(".workflows-page");
    // Source first use must materialize its uncached bundle before the engine
    // can accept work. Observe readiness without launching it from the test;
    // keep the separate model-request deadline after this startup checkpoint.
    await expect
      .poll(
        () =>
          engine("health").then(
            () => true,
            () => false,
          ),
        { timeout: 30000 },
      )
      .toBe(true);
    const requestedAt = Date.now();
    try {
      await expect.poll(() => provider.pending).toBeGreaterThan(0);
    } catch (error) {
      // Keep the original assertion failure while distinguishing late cold
      // startup from a worker that never reaches the isolated model endpoint.
      const later = await expect
        .poll(() => provider.pending, { timeout: 30000 })
        .toBeGreaterThan(0)
        .then(
          () => true,
          () => false,
        );
      await info.attach("initial-model-request-diagnostic", {
        contentType: "application/json",
        body: JSON.stringify({ later, elapsedMs: Date.now() - requestedAt, calls: provider.calls }),
      });
      throw error;
    }
    const health = (await engine("health")) as { pid: number };
    enginePid = health.pid;
    for (const pid of family(enginePid)) owned.add(pid);
    expect(owned.size).toBeGreaterThan(2);
    await workflows.getByRole("button", { name: "Pause workflow" }).click();
    await expect(workflows.locator(".workflow-task-list summary")).toContainText("Paused");
    await expect
      .poll(() => [...owned].filter((pid) => pid !== enginePid && alive(pid)))
      .toEqual([]);
    await workflows.getByRole("button", { name: "Resume workflow" }).click();
    await expect.poll(() => provider.pending).toBeGreaterThan(0);
    for (const pid of family(enginePid)) owned.add(pid);
    await workflows.getByRole("button", { name: "Steer", exact: true }).click();
    await workflows
      .getByLabel("Guidance for a subsequent turn", { exact: true })
      .fill("Preserve the public API.");
    await workflows.getByRole("button", { name: "Queue guidance", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Steer workflow", exact: true })).toBeHidden();
    const registryPath = join(env.XDG_STATE_HOME, "code60/workflows/registry.json");
    const before = JSON.parse(await readFile(registryPath, "utf8"));
    const guidance = (await engine("get_workflow_events", {
      runId: before.entries[0].snapshot.runId,
      after: 0,
    })) as { events: unknown[] };
    expect(guidance.events).toContainEqual(
      expect.objectContaining({
        kind: "message",
        detail: expect.objectContaining({ message: "Preserve the public API." }),
      }),
    );
    await context.close();
    context = undefined;
    await gateway.stop();
    gateway = undefined;
    expect(alive(enginePid)).toBe(true);
    expect(((await engine("health")) as { pid: number }).pid).toBe(enginePid);
    provider.setMode("complete");
    await expect
      .poll(
        async () =>
          (
            (await engine("get_workflow", {
              runId: before.entries[0].snapshot.runId,
            })) as { status: string }
          ).status,
        { timeout: 45_000 },
      )
      .toBe("completed");
    gateway = await startGateway({ env, roots: [home], assets: join(root, "dist/renderer") });
    context = await browser.newContext();
    context.setDefaultTimeout(20_000);
    const reopened = await context.newPage();
    await reopened.goto(gateway.origin);
    await reopened.getByRole("button", { name: "Start", exact: true }).click();
    await reopened.locator("#tab-apps").press("ArrowRight");
    await reopened.locator("#tab-workflows").click();
    await reopened.getByRole("button", { name: /Native preserved execution/ }).click();
    expect(((await engine("health")) as { pid: number }).pid).toBe(enginePid);
    await expect(reopened.locator(".workflow-task-list summary")).toContainText("Accepted", {
      timeout: 45_000,
    });
    await reopened.getByText("Accepted diff", { exact: true }).click();
    await reopened.getByRole("button", { name: "Load accepted diff", exact: true }).click();
    await expect(
      reopened
        .locator("pre")
        .filter({ hasText: "diff --git a/workflow-result.txt b/workflow-result.txt" }),
    ).toBeVisible();
    const after = JSON.parse(await readFile(registryPath, "utf8"));
    expect(after.entries[0].key).toBe(before.entries[0].key);
    expect(after.entries[0].snapshot.runId).toBe(before.entries[0].snapshot.runId);
    const worktree = after.entries[0].worktree as string;
    expect(await readFile(join(worktree, "workflow-result.txt"), "utf8")).toBe(
      "isolated native workflow\n",
    );
    expect(await readFile(join(worktree, "source.txt"), "utf8")).toBe("saved unstaged\n");
    expect(await readFile(join(repo, "source.txt"), "utf8")).toBe("saved unstaged\n");
    expect(await readFile(join(repo, ".git/index"))).toEqual(index);
    expect(git("rev-parse", "HEAD")).toBe(head);
    await expect(readFile(join(repo, "workflow-result.txt"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(forbidden)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(join(env.XDG_CONFIG_HOME, "systemd/user/code60-transmission.service")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(provider.calls.filter((call) => call.tool).length).toBeGreaterThanOrEqual(2);
    provider.setMode("hold");
    const stopForm = await review(reopened, "Stop an installed workflow");
    await stopForm.getByRole("button", { name: "Start workflow", exact: true }).click();
    await expect.poll(() => provider.pending).toBeGreaterThan(0);
    await reopened.getByRole("button", { name: "Stop workflow", exact: true }).click();
    const stopDialog = reopened.getByRole("dialog", { name: "Stop workflow?" });
    await stopDialog.getByRole("button", { name: "Stop workflow", exact: true }).click();
    await expect(reopened.locator(".workflow-player > [role=status]")).toHaveText("Cancelled");
    await info.attach("native-identities-and-outcomes", {
      contentType: "application/json",
      body: JSON.stringify({
        enginePid,
        bundle: bundles[0],
        runId: after.entries[0].snapshot.runId,
        keyPreserved: true,
        completedWithoutBackend: true,
        guidancePersisted: true,
        indexPreserved: true,
        headPreserved: true,
        runtimeToolsInvoked: false,
        provider: provider.calls,
      }),
    });
    await reopened.screenshot({ path: info.outputPath("accepted.png"), fullPage: true });
  } catch (error) {
    errors.push(error);
  } finally {
    for (const close of [() => context?.close(), () => gateway?.stop()]) {
      try {
        await close();
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      await stopNativeEngines(
        [engineRoot, join(env.XDG_STATE_HOME, "code60/workflows/transmission-0.1.0-staging.18")],
        owned,
      );
    } catch (error) {
      errors.push(error);
    }
    try {
      await provider.close();
    } catch (error) {
      errors.push(error);
    }
    await info.attach("cleanup", {
      contentType: "application/json",
      body: JSON.stringify({
        owned: [...owned],
        remaining: [...owned].filter(alive),
        failures: errors.length,
        ...(errors.length ? { preserved: directory } : {}),
      }),
    });
    if (!errors.length) await rm(directory, { recursive: true });
  }
  if (errors.length)
    throw new AggregateError(
      errors,
      `Native acceptance or cleanup failed; evidence preserved: ${directory}`,
    );
});
