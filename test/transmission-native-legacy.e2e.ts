import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import type { LocalTransmission as ClientFactory } from "../src/application/index.js";
import type { startGateway as GatewayFactory } from "../src/gateway/index.js";
import type {
  OwnedProcess,
  preserveTransmissionBundle as PreserveFactory,
  spawnOwnedProcess as SpawnFactory,
} from "../src/platform/index.js";
import { expandNavigation } from "./fixtures/browser-actions.js";
import { commitFixture } from "./fixtures/git-repository.js";
import {
  nativeProcessAlive as alive,
  nativeProcessFamily as family,
  stopNativeEngines,
} from "./fixtures/transmission-processes.js";
import { transmissionProvider } from "./fixtures/transmission-provider.js";

const root = resolve(import.meta.dirname, "..");
const { startGateway } = (await import(
  pathToFileURL(join(root, "dist/gateway/index.js")).href
)) as { startGateway: typeof GatewayFactory };
const { LocalTransmission } = (await import(
  pathToFileURL(join(root, "dist/application/index.js")).href
)) as { LocalTransmission: typeof ClientFactory };
const { preserveTransmissionBundle, spawnOwnedProcess } = (await import(
  pathToFileURL(join(root, "dist/platform/index.js")).href
)) as {
  preserveTransmissionBundle: typeof PreserveFactory;
  spawnOwnedProcess: typeof SpawnFactory;
};

for (const saved of [undefined, "0.1.0-staging.18", "0.1.0-staging.20"] as const) {
  test(`native retained workflow: ${saved ?? "unversioned staging.18"} recovers the original start and cancels the original run`, async ({
    browser,
  }, info) => {
    if (`${process.platform}-${process.arch}` !== "darwin-arm64")
      throw Error("Native Transmission acceptance requires macOS arm64");
    const home = await realpath(await mkdtemp(join(tmpdir(), "code60 retained native ' ")));
    const version = saved ?? "0.1.0-staging.18";
    const registry = join(home, "state/code60/workflows");
    const engineRoot = join(registry, `transmission-${version}`);
    const otherRoot = join(
      registry,
      `transmission-${version.endsWith("18") ? "0.1.0-staging.20" : "0.1.0-staging.18"}`,
    );
    const provider = await transmissionProvider();
    const env = {
      HOME: home,
      SHELL: join(home, "test-shell"),
      PATH: `${home}/bin:/usr/bin:/bin`,
      XDG_CONFIG_HOME: join(home, "config"),
      XDG_STATE_HOME: join(home, "state"),
      XDG_DATA_HOME: join(home, "data"),
      CODEX_HOME: join(home, "codex"),
      CODEX_CONFIG: provider.config,
      CODE60_TEST_FORBIDDEN_LOG: join(home, "forbidden.log"),
      GIT_CONFIG_NOSYSTEM: "1",
    };
    const client = new LocalTransmission(engineRoot, env, version);
    const repo = join(home, "source");
    const worktree = join(home, "execution");
    const id = randomUUID(),
      key = randomUUID(),
      branch = `code60/transmission-${id}`;
    const owned = new Set<number>();
    let gateway: Awaited<ReturnType<typeof startGateway>> | undefined;
    let context: Awaited<ReturnType<typeof browser.newContext>> | undefined;
    let pid: number | undefined;
    let legacyProcess: OwnedProcess | undefined;
    let legacyExecutable: string | undefined;
    let legacyBytes: Buffer | undefined;
    const errors: unknown[] = [];
    const git = (...args: string[]) =>
      execFileSync("/usr/bin/git", ["-C", repo, ...args], {
        env,
        encoding: "utf8",
        timeout: 5000,
      }).trim();
    try {
      for (const path of [
        repo,
        join(home, "config/code60"),
        join(home, "codex"),
        join(home, "bin"),
      ])
        await mkdir(path, { recursive: true, mode: 0o700 });
      await writeFile(env.SHELL, '#!/bin/sh\nexec /bin/sh -c "$2"\n', { mode: 0o700 });
      for (const command of ["npm", "npx", "clang", "cc", "gcc", "make"])
        await writeFile(
          join(home, "bin", command),
          '#!/bin/sh\nprintf "%s\\n" "$0" >> "$CODE60_TEST_FORBIDDEN_LOG"\nexit 91\n',
          { mode: 0o700 },
        );
      git("init", "-q", "-b", "main");
      await writeFile(join(repo, "baseline.txt"), "retained baseline\n");
      git("add", ".");
      commitFixture(repo);
      const head = git("rev-parse", "HEAD");
      const index = await readFile(join(repo, ".git/index"));
      git("worktree", "add", "-qb", branch, worktree);
      const identity = async (path: string) => {
        const entry = await stat(path, { bigint: true });
        return `${path}:${entry.dev}:${entry.ino}`;
      };
      const bundles = await readdir(join(root, "dist/engines"));
      if (bundles.length !== 1 || !/^[a-f0-9]{64}$/.test(bundles[0] ?? ""))
        throw Error("Prepare native engine assets first");
      const bundle = join(root, "dist/engines", bundles[0] as string);
      if (saved === undefined) {
        // Original starting state: an already-running staging.18 executable in
        // the old private npm cache. No runtime npm invocation is used to seed it.
        const cache = join(registry, "npm-cache/_npx/retained-staging18");
        await mkdir(cache, { recursive: true, mode: 0o700 });
        await cp(bundle, cache, { recursive: true });
        await rename(
          join(cache, "node_modules/transmission-18"),
          join(cache, "node_modules/code60-transmission-server"),
        );
        legacyExecutable = join(cache, "node_modules/code60-transmission-server/dist/src/main.js");
        legacyBytes = await readFile(legacyExecutable);
        legacyProcess = await spawnOwnedProcess(
          [process.execPath, legacyExecutable, "engine"],
          cache,
          { ...env, TRANSMISSION_STATE_DIR: engineRoot },
        );
        pid = legacyProcess.pid;
        owned.add(pid);
        legacyProcess.stdin.end();
        legacyProcess.stdout.resume();
        legacyProcess.stderr.resume();
        await expect
          .poll(
            () =>
              client
                .call("health")
                .then(() => true)
                .catch(() => false),
            { timeout: 10_000 },
          )
          .toBe(true);
      } else {
        await preserveTransmissionBundle(bundle, env);
        await client.connect(AbortSignal.timeout(30_000));
      }
      pid = ((await client.call("health")) as { pid: number }).pid;
      const definition = {
        name: "Retained native workflow",
        tasks: [
          {
            name: "Retained task",
            instructions: "Create workflow-result.txt in the execution worktree.",
            verify: "Read the isolated result.",
            checks: [],
          },
        ],
        repairs: 2,
        retries: 2,
        autoApprove: true,
      };
      // Historical starting state: the engine accepted the approved start, but
      // the old backend did not retain its acknowledgement. No provider or
      // execution authority is seeded into a fresh product/setup journey.
      const original = (await client.call("start_workflow", {
        repository: worktree,
        tasks: definition.tasks,
        confirmed: true,
        idempotencyKey: key,
        repairs: 2,
        retries: 2,
        autoApprove: true,
      })) as { runId: string };
      if (legacyExecutable) {
        await preserveTransmissionBundle(bundle, env);
        await client.connect(AbortSignal.timeout(30_000));
        expect(((await client.call("health")) as { pid: number }).pid).toBe(legacyProcess?.pid);
        expect(await readFile(legacyExecutable)).toEqual(legacyBytes);
      }
      await expect.poll(() => provider.pending).toBeGreaterThan(0);
      for (const child of family(pid)) owned.add(child);
      const record = {
        id,
        key,
        branch,
        name: definition.name,
        definition,
        repository: repo,
        worktree,
        baseline: head,
        repositoryIdentity: await identity(repo),
        repositoryGitIdentity: await identity(join(repo, ".git")),
        worktreeIdentity: await identity(worktree),
        createdAt: new Date().toISOString(),
        state: "uncertain",
        ...(saved ? { engineVersion: saved } : {}),
      };
      const registryPath = join(registry, "registry.json");
      await writeFile(registryPath, JSON.stringify({ format: 1, version, entries: [record] }), {
        mode: 0o600,
      });
      await writeFile(
        join(home, "config/code60/config.json"),
        JSON.stringify({
          agents: {
            claude: { command: [process.execPath, join(root, "test/fixtures/fake-agent.mjs")] },
          },
        }),
      );
      gateway = await startGateway({ env, roots: [home], assets: join(root, "dist/renderer") });
      context = await browser.newContext();
      context.setDefaultTimeout(20_000);
      const page = await context.newPage();
      await page.goto(gateway.origin);
      const wizard = page.locator(".agent-setup-dialog");
      await wizard.getByRole("button", { name: "Claude", exact: true }).click();
      await expect(wizard.getByRole("status")).toHaveText("Claude connected");
      await wizard.getByRole("button", { name: "Close provider setup", exact: true }).click();
      await expect(page.getByRole("banner", { name: "Code60" })).toBeVisible();
      await expandNavigation(page, "Automation");
      await page.locator("#tab-workflows").click();
      const view = page.locator(".workflows-page");
      await view.getByRole("button", { name: /Retained native workflow/ }).click();
      await expect(
        view.getByRole("button", { name: "Recover same start request", exact: true }),
      ).toBeVisible();
      expect(((await client.call("health")) as { pid: number }).pid).toBe(pid);
      await expect(readFile(join(otherRoot, "endpoint.json"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      await view.getByRole("button", { name: "Recover same start request", exact: true }).click();
      await expect(view.locator(".workflow-task-list summary")).toContainText("Implementing");
      const recovered = JSON.parse(await readFile(registryPath, "utf8"));
      expect(recovered.entries[0]).toMatchObject({
        key,
        id,
        worktree,
        state: "submitted",
        snapshot: { runId: original.runId },
      });
      expect(recovered.entries[0].engineVersion).toBe(saved);
      // Model temporarily unavailable private connection metadata while the
      // approved engine keeps running. Reconnect is offered only when offline.
      const endpoint = join(engineRoot, "endpoint.json");
      const suspended = join(engineRoot, "endpoint.fixture-disconnected.json");
      await rename(endpoint, suspended);
      try {
        await page
          .locator(".workflows-page")
          .getByRole("button", { name: "Refresh", exact: true })
          .click();
        await page
          .locator(".workflows-page")
          .getByRole("button", { name: "Reconnect engine…", exact: true })
          .click();
        await expect(
          page.getByRole("dialog", { name: "Reconnect engine", exact: true }),
        ).toBeVisible();
      } finally {
        await rename(suspended, endpoint);
      }
      await page
        .getByRole("dialog", { name: "Reconnect engine", exact: true })
        .getByRole("button", { name: "Reconnect engine", exact: true })
        .click();
      expect(((await client.call("health")) as { pid: number }).pid).toBe(pid);
      if (version.endsWith("18")) {
        await expect(view.getByRole("button", { name: "Pause workflow" })).toBeDisabled();
        await expect(view.getByRole("button", { name: "Resume workflow" })).toBeDisabled();
      }
      await view.getByRole("button", { name: "Stop workflow" }).click();
      const confirmation = view.getByRole("dialog", { name: "Stop workflow?" });
      await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
      expect(
        ((await client.call("get_workflow", { runId: original.runId })) as { status: string })
          .status,
      ).toBe("running");
      await view.getByRole("button", { name: "Stop workflow" }).click();
      await confirmation.getByRole("button", { name: "Stop workflow", exact: true }).click();
      await expect(view.locator(".workflow-player > [role=status]")).toHaveText("Cancelled");
      const cancelled = await client.call("get_workflow", { runId: original.runId });
      expect(cancelled).toMatchObject({ runId: original.runId, status: "cancelled" });
      await expect
        .poll(() => [...owned].filter((child) => child !== pid && alive(child)))
        .toEqual([]);
      const persisted = JSON.parse(await readFile(registryPath, "utf8"));
      expect(persisted.entries).toHaveLength(1);
      expect(persisted.entries[0].key).toBe(key);
      expect(persisted.entries[0].snapshot.runId).toBe(original.runId);
      if (legacyExecutable) expect(await readFile(legacyExecutable)).toEqual(legacyBytes);
      expect(await readFile(join(repo, ".git/index"))).toEqual(index);
      expect(git("rev-parse", "HEAD")).toBe(head);
      expect(await readFile(join(repo, "baseline.txt"), "utf8")).toBe("retained baseline\n");
      expect((await stat(worktree)).isDirectory()).toBe(true);
      await expect(readFile(env.CODE60_TEST_FORBIDDEN_LOG)).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(readFile(join(otherRoot, "endpoint.json"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      await info.attach("retained-identities", {
        contentType: "application/json",
        body: JSON.stringify({
          saved: saved ?? null,
          version,
          pid,
          id,
          key,
          runId: original.runId,
          sameStartRecovered: true,
          legacyCachedExecutableRetained: legacyExecutable !== undefined,
          sourceIndexPreserved: true,
          sourceHeadPreserved: true,
        }),
      });
      await page.screenshot({ path: info.outputPath("cancelled.png"), fullPage: true });
    } catch (error) {
      errors.push(error);
    } finally {
      for (const close of [() => context?.close(), () => gateway?.stop()])
        try {
          await close();
        } catch (error) {
          errors.push(error);
        }
      try {
        await stopNativeEngines([engineRoot, otherRoot], owned);
      } catch (error) {
        errors.push(error);
      }
      if (legacyProcess && !legacyProcess.hasExited()) {
        try {
          await legacyProcess.stop(1000);
        } catch (error) {
          errors.push(error);
        }
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
          ...(errors.length ? { preserved: home } : {}),
        }),
      });
      if (!errors.length) await rm(home, { recursive: true });
    }
    if (errors.length)
      throw new AggregateError(errors, `Retained native acceptance failed; preserved ${home}`);
  });
}
