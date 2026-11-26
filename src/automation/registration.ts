import { realpath, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SchedulerStatus, ServiceStatus } from "../contracts/index.js";
import { CODE60_VERSION } from "../core/index.js";
import {
  controlUserService,
  fileCode,
  inspectUserService,
  lockPrivateState,
  privateDirectory,
  readPrivateJson,
  type ServiceRuntime,
  userHome,
  userServiceDefinition,
  writePrivateJson,
} from "../platform/index.js";
import { AutomationError } from "./errors.js";
import { automationClient, automationRoot } from "./service.js";

const updatePath = (env: Readonly<NodeJS.ProcessEnv>) =>
  join(automationRoot(env), "update-restart.json");

/** Persist restart intent before stopping: the installer replaces this process too. */
export async function prepareSchedulerUpdate(env: Readonly<NodeJS.ProcessEnv>): Promise<void> {
  await schedulerRuntime(env, true);
  await withUpdateOwnership(env, () => prepareUpdate(env));
}

async function withUpdateOwnership(env: Readonly<NodeJS.ProcessEnv>, action: () => Promise<void>) {
  const release = await lockPrivateState(join(automationRoot(env), "update-recovery"));
  try {
    await action();
  } finally {
    await release();
  }
}

async function prepareUpdate(env: Readonly<NodeJS.ProcessEnv>): Promise<void> {
  // Validate the destination before persisting intent, pausing, or stopping work.
  await schedulerRuntime(env, true);
  const first = await automationClient(env)({ action: "status" }).catch(() => null);
  const registration = await registrationStatus(env);
  const status = registration.service ?? (first as ServiceStatus | null);
  registration.service = status;
  if (!status) {
    if (registration.installed && registration.native.state !== "stopped")
      throw new AutomationError(
        "unavailable",
        "Scheduler stop could not be verified. No binaries were replaced.",
      );
    return;
  }
  assertNativeResponder(registration);
  const previous = await readPrivateJson(updatePath(env), 4096).catch((error) => {
    if (fileCode(error) !== "ENOENT") throw error;
    return undefined;
  });
  await writePrivateJson(
    updatePath(env),
    previous ?? { version: 1, pausedAll: status.pausedAll },
    previous,
    4096,
  );
  try {
    await schedulerControl(env, "stop");
    const deadline = Date.now() + 15_000;
    for (;;) {
      try {
        process.kill(status.pid, 0);
      } catch (error) {
        if (fileCode(error) === "ESRCH") break;
        throw error;
      }
      if (Date.now() >= deadline) throw new Error("Previous scheduler has not exited");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } catch (error) {
    if (error instanceof AutomationError) throw error;
    throw new AutomationError("unavailable", "Scheduler stop failed. No binaries were replaced.");
  }
}

/** Repair the previously consented registration to point at the newly installed runtime. */
export async function restoreSchedulerUpdate(
  env: Readonly<NodeJS.ProcessEnv>,
  reconcileInstalled = false,
): Promise<void> {
  const marker = await readPrivateJson(updatePath(env), 4096).catch((error) => {
    if (fileCode(error) !== "ENOENT") throw error;
    return null;
  });
  if (marker === null) {
    if (!reconcileInstalled) return;
    // Read-only preflight keeps pristine/stopped/current installations untouched.
    // Recheck inside the ownership claim before granting any mutation authority.
    const registered = await readPrivateJson(
      join(automationRoot(env), "registration.json"),
      16_384,
    ).catch((error) => {
      if (fileCode(error) !== "ENOENT") throw error;
      return null;
    });
    if (registered === null) return;
    const status = await registrationStatus(env);
    if (!status.installed) return;
    if (!status.service) {
      if (status.native.state !== "stopped")
        throw new AutomationError(
          "unavailable",
          "Scheduler upgrade could not verify service health.",
        );
      return;
    }
    if (!olderVersion(status.service.appVersion, CODE60_VERSION)) return;
    assertNativeResponder(status);
  }
  await schedulerRuntime(env, true);
  await withUpdateOwnership(env, () => restoreUpdate(env, reconcileInstalled));
}

async function restoreUpdate(
  env: Readonly<NodeJS.ProcessEnv>,
  reconcileInstalled: boolean,
): Promise<void> {
  let marker = await readPrivateJson(updatePath(env), 4096).catch((error) => {
    if (fileCode(error) !== "ENOENT") throw error;
    return null;
  });
  if (marker === null) {
    if (!reconcileInstalled) return;
    const registration = await registrationStatus(env);
    if (!registration.installed) return;
    if (!registration.service) {
      if (registration.native.state !== "stopped")
        throw new AutomationError(
          "unavailable",
          "Scheduler upgrade could not verify service health.",
        );
      return;
    }
    if (!olderVersion(registration.service.appVersion, CODE60_VERSION)) return;
    assertNativeResponder(registration);
    // Manual installation has no pre-install marker. Capture the running service's
    // pause state and stop it before replacing its previously consented registration.
    await prepareUpdate(env);
    marker = await readPrivateJson(updatePath(env), 4096);
  }
  const saved = marker as { version?: unknown; pausedAll?: unknown };
  if (saved.version !== 1 || typeof saved.pausedAll !== "boolean")
    throw new AutomationError("unavailable", "Scheduler update recovery metadata is invalid.");
  // Pending intent never authorizes taking over a standalone or newer process.
  await schedulerRuntime(env, true);
  const existing = await registrationStatus(env);
  if (!existing.installed)
    throw new AutomationError(
      "refused",
      "Scheduling Service is no longer installed. Restart recovery is still pending.",
    );
  if (existing.service) {
    assertNativeResponder(existing);
    if (
      existing.service.appVersion !== CODE60_VERSION &&
      !olderVersion(existing.service.appVersion, CODE60_VERSION)
    )
      throw new AutomationError(
        "refused",
        "A newer or unverifiable scheduler cannot be replaced by this app.",
      );
  }
  try {
    if (existing.service?.appVersion !== CODE60_VERSION)
      await schedulerControl(env, "repair", true);
  } catch (error) {
    if (error instanceof AutomationError) throw error;
    throw new AutomationError(
      "unavailable",
      "Scheduler upgrade failed. Restart recovery is still pending.",
    );
  }
  const client = automationClient(env);
  const deadline = Date.now() + 15_000;
  for (;;) {
    const status = await client({ action: "status" }).catch(() => null);
    if (status) {
      const running = status as ServiceStatus;
      const native = await registrationStatus(env);
      assertNativeResponder(native);
      if (native.service?.pid !== running.pid)
        throw new AutomationError("unavailable", "Scheduler changed during recovery.");
      if (running.appVersion !== CODE60_VERSION)
        throw new AutomationError(
          "unavailable",
          "Scheduler version does not match the installed app.",
        );
      if (running.block)
        throw new AutomationError(
          "refused",
          "Scheduler recovery is blocked. Review System Manager.",
        );
      if (running.pausedAll !== saved.pausedAll)
        await client(
          saved.pausedAll ? { action: "pauseAll", cancelActive: false } : { action: "resumeAll" },
        );
      const verified = (await client({ action: "status" })) as ServiceStatus;
      if (
        verified.appVersion !== CODE60_VERSION ||
        verified.block ||
        verified.pausedAll !== saved.pausedAll
      )
        throw new AutomationError("unavailable", "Scheduler reactivation could not be verified.");
      assertNativeResponder(await registrationStatus(env));
      break;
    }
    if (Date.now() >= deadline)
      throw new AutomationError("unavailable", "Scheduler did not restart after the update.");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await unlink(updatePath(env));
}

async function schedulerRuntime(
  env: Readonly<NodeJS.ProcessEnv>,
  _validate = false,
): Promise<ServiceRuntime> {
  const executable = await realpath(process.execPath);
  const runtimeEnv: Record<string, string> = {};
  for (const key of ["PATH", "HOME", "XDG_STATE_HOME", "XDG_CONFIG_HOME"])
    if (env[key]) runtimeEnv[key] = env[key];
  return {
    executable,
    args: [resolve(dirname(fileURLToPath(import.meta.url)), "main.js")],
    env: runtimeEnv,
  };
}

export async function schedulerControl(
  env: Readonly<NodeJS.ProcessEnv>,
  action: "install" | "repair" | "start" | "stop" | "uninstall" | "status",
  consent = false,
) {
  const root = automationRoot(env);
  const marker = join(root, "registration.json");
  const registered = await readPrivateJson(marker, 16_384).catch((error) => {
    if (fileCode(error) !== "ENOENT") throw error;
    return null;
  });
  if ((action === "install" || action === "repair") && !consent)
    throw new AutomationError(
      "refused",
      "Explicit consent is required to install or repair the Scheduling Service.",
    );
  const runtime = await schedulerRuntime(env, action === "install" || action === "repair");
  const definition = userServiceDefinition(process.platform, userHome(env), root, runtime);
  if (action === "status") {
    const status = await registrationStatus(env);
    return {
      installed: status.installed,
      nativeState: status.native.state,
      service: status.service,
    } satisfies SchedulerStatus;
  }
  if (action === "stop" || action === "uninstall" || action === "repair") {
    const status = await registrationStatus(env);
    if (status.service) assertNativeResponder(status);
    await suspendScheduler(env);
  }
  if (action === "install" || action === "repair") await privateDirectory(root);
  const result = await controlUserService(definition, action);
  if (action === "install" || action === "repair" || action === "uninstall")
    await writePrivateJson(
      marker,
      { installed: action !== "uninstall", runtime },
      registered ?? undefined,
      16_384,
    );
  return result;
}

/** Updates cannot replace a running agent's executable. Never silently abandon cleanup. */
async function suspendScheduler(env: Readonly<NodeJS.ProcessEnv>): Promise<void> {
  const client = automationClient(env);
  const status = await client({ action: "status" }).catch(() => null);
  if (!status) return;
  await client({ action: "pauseAll", cancelActive: true });
  const deadline = Date.now() + 60_000;
  for (;;) {
    const current = (await client({ action: "status" })) as {
      activeExecutionId: string | null;
      block: unknown;
    };
    if (current.block)
      throw new AutomationError(
        "refused",
        "Resolve blocked automation ownership before stopping or updating the service.",
      );
    if (!current.activeExecutionId) return;
    if (Date.now() >= deadline)
      throw new AutomationError(
        "refused",
        "Automation cleanup did not finish. No binaries were replaced.",
      );
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function registrationStatus(env: Readonly<NodeJS.ProcessEnv>) {
  const root = automationRoot(env);
  const registered = await readPrivateJson(join(root, "registration.json"), 16_384).catch(
    (error) => {
      if (fileCode(error) !== "ENOENT") throw error;
      return null;
    },
  );
  if (
    registered !== null &&
    (typeof registered !== "object" ||
      Array.isArray(registered) ||
      typeof (registered as { installed?: unknown }).installed !== "boolean")
  )
    throw new AutomationError("unavailable", "Scheduling Service registration is invalid.");
  const installed = (registered as { installed: boolean } | null)?.installed === true;
  const definition = userServiceDefinition(
    process.platform,
    userHome(env),
    root,
    await schedulerRuntime(env),
  );
  const [native, service] = await Promise.all([
    inspectUserService(definition),
    automationClient(env)({ action: "status" }).catch(() => null),
  ]);
  if (installed !== native.definitionPresent || (!installed && native.state === "running"))
    throw new AutomationError("unavailable", "Scheduling Service registration needs repair.");
  return { installed, native, service: service as ServiceStatus | null };
}

function assertNativeResponder(status: Awaited<ReturnType<typeof registrationStatus>>) {
  if (
    !status.installed ||
    status.native.state !== "running" ||
    !status.native.pid ||
    status.service?.pid !== status.native.pid
  )
    throw new AutomationError(
      "refused",
      "Stop the standalone or unverified scheduler before updating the Scheduling Service.",
    );
}

function olderVersion(service: string, app: string): boolean {
  // Bounded semantic versions (X.Y.Z with optional prerelease). Unknown versions
  // do not grant automatic downgrade/replacement authority.
  const parse = (value: string) => {
    const match =
      /^([0-9]{1,8})\.([0-9]{1,8})\.([0-9]{1,8})(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(
        value,
      );
    if (!match) return undefined;
    const pre = match[4]?.split(".");
    if (pre?.some((part) => /^\d+$/.test(part) && /^0\d/.test(part))) return undefined;
    return { core: match.slice(1, 4).map(Number), pre };
  };
  const left = parse(service),
    right = parse(app);
  if (!left || !right) return false;
  for (let i = 0; i < 3; i++) {
    const a = left.core[i] ?? 0;
    const b = right.core[i] ?? 0;
    if (a !== b) return a < b;
  }
  if (!left.pre && !right.pre) return false;
  if (left.pre && !right.pre) return true;
  if (!left.pre && right.pre) return false;
  const leftPre = left.pre ?? [];
  const rightPre = right.pre ?? [];
  const max = Math.max(leftPre.length, rightPre.length);
  for (let i = 0; i < max; i++) {
    const a = leftPre[i];
    const b = rightPre[i];
    if (a === undefined) return true;
    if (b === undefined) return false;
    if (a === b) continue;
    const aNum = /^\d+$/.test(a);
    const bNum = /^\d+$/.test(b);
    if (aNum && bNum) return BigInt(a) < BigInt(b);
    if (aNum !== bNum) return aNum;
    return a < b;
  }
  return false;
}
