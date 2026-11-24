import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { automationClient, schedulerControl } from "../automation/index.js";
import { CODE60_VERSION } from "../core/index.js";
import {
  absoluteInstallationPath,
  controlUserService,
  fileCode,
  inspectUserService,
  lockPrivateState,
  privateDirectory,
  readPrivateJson,
  type ServiceRuntime,
  userHome,
  userServiceDefinition,
  userServiceSnapshot,
  writePrivateJson,
} from "../platform/index.js";
import { gatewayRoot, managementRequest } from "./server.js";

export type GatewayControl = "install" | "repair" | "start" | "stop" | "uninstall" | "status";
type RegisteredRuntime = { runtime: ServiceRuntime; appVersion: string };
type Registration = RegisteredRuntime & {
  version: 1;
  installed: boolean;
  previous?: RegisteredRuntime;
};
function validRuntime(value: RegisteredRuntime) {
  return (
    value &&
    typeof value.appVersion === "string" &&
    value.runtime &&
    typeof value.runtime.executable === "string" &&
    Array.isArray(value.runtime.args) &&
    value.runtime.args.every((arg) => typeof arg === "string") &&
    value.runtime.env &&
    Object.values(value.runtime.env).every((item) => typeof item === "string")
  );
}

async function registration(env: Readonly<NodeJS.ProcessEnv>) {
  const value = (await readPrivateJson(join(gatewayRoot(env), "registration.json"), 16_384).catch(
    (error) => {
      if (fileCode(error) !== "ENOENT") throw error;
      return null;
    },
  )) as Registration | null;
  if (
    value &&
    (value.version !== 1 ||
      typeof value.installed !== "boolean" ||
      !validRuntime(value) ||
      (value.previous !== undefined && !validRuntime(value.previous)))
  )
    throw new Error("Gateway registration is invalid. Existing state was preserved.");
  return value;
}
async function currentRuntime(env: Readonly<NodeJS.ProcessEnv>): Promise<ServiceRuntime> {
  if (Number(process.versions.node.split(".")[0]) !== 24)
    throw new Error("Code60 requires Node 24.");
  const runtimeEnv: Record<string, string> = {};
  if (env.CODEX_HOME) absoluteInstallationPath(env.CODEX_HOME);
  for (const name of [
    "PATH",
    "HOME",
    "SHELL",
    "XDG_STATE_HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "CODEX_HOME",
  ])
    if (env[name]) runtimeEnv[name] = env[name];
  return {
    executable: await realpath(process.execPath),
    args: [fileURLToPath(new URL("./main.js", import.meta.url))],
    env: runtimeEnv,
  };
}

/** Service mutation requires local consent; browser code receives no command execution API. */
export async function gatewayControl(
  env: Readonly<NodeJS.ProcessEnv>,
  action: GatewayControl,
  consent = false,
) {
  if (!["status", "start"].includes(action) && !consent)
    throw new Error("Explicit consent is required for this service action.");
  const root = gatewayRoot(env);
  const saved = await registration(env);
  if (action === "install" && saved?.installed)
    throw new Error("The Gateway is already installed. Use code60 service repair to update it.");
  if (action === "stop" && !saved?.installed) throw new Error("The Gateway is not installed.");
  const runtime =
    action === "install" || action === "repair" ? await currentRuntime(env) : saved?.runtime;
  if (!runtime) {
    if (action === "status") return { installed: false, nativeState: "stopped", service: null };
    throw new Error("Install the Gateway first with code60 service install.");
  }
  const definition = userServiceDefinition(
    process.platform,
    userHome(env),
    root,
    runtime,
    "gateway",
  );
  const definitionFile = await userServiceSnapshot(definition.path);
  const savedDefinitions = saved
    ? [saved, ...(saved.previous ? [saved.previous] : [])].map((value) =>
        userServiceDefinition(process.platform, userHome(env), root, value.runtime, "gateway"),
      )
    : [];
  const existing =
    savedDefinitions.find((item) => item.contents === definitionFile?.text) ??
    savedDefinitions[0] ??
    definition;
  if (definitionFile && !savedDefinitions.some((item) => item.contents === definitionFile.text))
    throw Error(
      "Gateway definition ownership changed; existing registration and outside edits were preserved",
    );
  const ownership = { expected: definitionFile?.identity ?? null };
  if (action === "status") {
    const native = await inspectUserService(existing);
    const service = await managementRequest(env, "status").catch(() => null);
    return {
      installed: saved?.installed === true,
      nativeState:
        service && (native.state !== "running" || native.pid !== service.pid)
          ? "unavailable"
          : native.state,
      service: native.state === "running" && native.pid === service?.pid ? service : null,
      runtimeCurrent:
        !saved?.previous &&
        (!definitionFile || definitionFile.text === definition.contents) &&
        saved?.appVersion === CODE60_VERSION &&
        saved.runtime.executable === (await realpath(process.execPath)) &&
        JSON.stringify(saved.runtime.args) ===
          JSON.stringify([fileURLToPath(new URL("./main.js", import.meta.url))]),
    };
  }
  await privateDirectory(root);
  const release = await lockPrivateState(join(root, "registration-operation"));
  try {
    if (JSON.stringify(await registration(env)) !== JSON.stringify(saved))
      throw new Error("Gateway registration changed. Check status before retrying.");
    if (action === "start") {
      if (!saved?.installed) throw new Error("The Gateway is not installed.");
      await realpath(runtime.executable).catch(() => {
        throw new Error("The registered Node runtime moved. Run code60 service repair.");
      });
      if (saved.previous)
        throw Error("Gateway registration is partial; use explicit service repair before starting");
      await controlUserService(existing, action, undefined, undefined, ownership);
      return { installed: true };
    }
    if (action === "install" || action === "repair") {
      const native = await inspectUserService(definition);
      if (native.state === "unavailable" || (native.state === "running" && !saved?.installed))
        throw new Error("Gateway ownership is unavailable. Existing registration was preserved.");
      if (action === "install" && native.definitionPresent)
        throw new Error("A Gateway definition already exists. Use code60 service repair.");
      // Preserve the legacy scheduler pause setting before its confirmed shutdown.
      const legacy = await schedulerControl(env, "status").catch((error) => {
        if (fileCode(error) === "ENOENT") return null;
        throw error;
      });
      if (legacy && "installed" in legacy && (legacy.installed || legacy.service)) {
        if (!legacy.installed || legacy.nativeState === "unavailable")
          throw new Error(
            "Legacy scheduler ownership is unavailable. Resolve it before installing the Gateway.",
          );
        const status = (await automationClient(env)({ action: "status" }).catch(() => null)) as {
          pausedAll?: boolean;
        } | null;
        if (!status && legacy.nativeState !== "stopped")
          throw new Error("Legacy scheduler stop could not be verified.");
        const handoffPath = join(root, "scheduler-handoff.json");
        const handoff = (await readPrivateJson(handoffPath, 4096).catch((error) => {
          if (fileCode(error) !== "ENOENT") throw error;
          return null;
        })) as { version?: unknown; pausedAll?: unknown } | null;
        if (handoff && (handoff.version !== 1 || typeof handoff.pausedAll !== "boolean"))
          throw new Error("Existing scheduler handoff needs recovery.");
        if (!handoff)
          await writePrivateJson(
            handoffPath,
            { version: 1, pausedAll: status?.pausedAll ?? true },
            undefined,
            4096,
          );
        await schedulerControl(env, "uninstall", true);
      }
    }
    if (saved?.installed && ["stop", "uninstall", "repair"].includes(action)) {
      const native = await inspectUserService(existing);
      if (native.state === "unavailable")
        throw new Error("Gateway ownership could not be verified. Registration was preserved.");
      if (native.state === "running") {
        const live = await managementRequest(env, "status");
        if (!native.pid || live.pid !== native.pid)
          throw new Error("Gateway process ownership could not be verified.");
        await managementRequest(env, "shutdown");
        await controlUserService(existing, "stop", undefined, undefined, ownership);
      }
    }
    if (action === "stop") return { installed: true };
    let previous = saved;
    if (action === "install" || action === "repair") {
      // Keep the pinned runtime recoverable if native enrollment partially fails.
      previous = {
        version: 1,
        installed: saved?.installed === true,
        runtime,
        appVersion: CODE60_VERSION,
        ...(saved
          ? { previous: saved.previous ?? { runtime: saved.runtime, appVersion: saved.appVersion } }
          : {}),
      };
      await writePrivateJson(join(root, "registration.json"), previous, saved ?? undefined, 16_384);
    }
    await controlUserService(definition, action, undefined, undefined, ownership);
    await writePrivateJson(
      join(root, "registration.json"),
      { version: 1, installed: action !== "uninstall", runtime, appVersion: CODE60_VERSION },
      previous ?? undefined,
      16_384,
    );
    return { installed: action !== "uninstall" };
  } finally {
    await release();
  }
}

export async function restoreSchedulerHandoff(
  env: Readonly<NodeJS.ProcessEnv>,
  request: ReturnType<typeof automationClient>,
) {
  const path = join(gatewayRoot(env), "scheduler-handoff.json");
  const saved = (await readPrivateJson(path, 4096).catch((error) => {
    if (fileCode(error) !== "ENOENT") throw error;
    return null;
  })) as { version?: unknown; pausedAll?: unknown } | null;
  if (!saved) return;
  if (saved.version !== 1 || typeof saved.pausedAll !== "boolean")
    throw new Error("Scheduler handoff requires recovery.");
  if (!saved.pausedAll) await request({ action: "resumeAll" });
  const { unlink } = await import("node:fs/promises");
  await unlink(path);
}
