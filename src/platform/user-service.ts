import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, unlink } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
  createInstallationParents,
  type FileIdentity,
  installationFileCode,
  installationSnapshot,
  writeInstallationFile,
} from "./installation-files.js";
import { atomicReplace, writePrivateFile } from "./storage.js";

export interface ServiceRuntime {
  executable: string;
  args: string[];
  env: Record<string, string>;
}
export interface UserServiceDefinition {
  path: string;
  contents: string;
  install: readonly string[][];
  start: readonly string[][];
  stop: readonly string[][];
  uninstall: readonly string[][];
  status: readonly string[];
}
const xml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
const unit = (value: string) =>
  `"${value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("%", "%%")
    .replaceAll("$", "$$")}"`;

export function userServiceDefinition(
  platform: NodeJS.Platform,
  home: string,
  root: string,
  runtime: ServiceRuntime,
  kind: "scheduler" | "backend" = "scheduler",
): UserServiceDefinition {
  const LABEL = `com.codemanufactory.code60.${kind}`;
  const unitName = `code60-${kind}.service`;
  if (
    !isAbsolute(runtime.executable) ||
    !isAbsolute(home) ||
    !isAbsolute(root) ||
    [runtime.executable, ...runtime.args, ...Object.values(runtime.env)].some((v) =>
      /[\0\r\n]/.test(v),
    ) ||
    Object.keys(runtime.env).some((v) => !/^[A-Z_][A-Z0-9_]*$/.test(v))
  )
    throw new Error("Invalid Scheduling Service runtime");
  if (platform === "darwin") {
    const path = join(home, "Library", "LaunchAgents", `${LABEL}.plist`);
    const target = `gui/${process.getuid?.() ?? -1}`;
    return {
      path,
      contents: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${LABEL}</string>
<key>ProgramArguments</key><array>${[runtime.executable, ...runtime.args].map((v) => `<string>${xml(v)}</string>`).join("")}</array>
<key>EnvironmentVariables</key><dict>${Object.entries(runtime.env)
        .map(([k, v]) => `<key>${xml(k)}</key><string>${xml(v)}</string>`)
        .join("")}</dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>30</integer>
<key>ProcessType</key><string>Background</string>
</dict></plist>\n`,
      install: [["launchctl", "bootstrap", target, path]],
      start: [
        ["launchctl", "bootstrap", target, path],
        ["launchctl", "kickstart", `${target}/${LABEL}`],
      ],
      stop: [["launchctl", "bootout", `${target}/${LABEL}`]],
      uninstall: [["launchctl", "bootout", `${target}/${LABEL}`]],
      status: ["launchctl", "print", `${target}/${LABEL}`],
    };
  }
  if (platform === "linux") {
    const path = join(home, ".config", "systemd", "user", unitName);
    return {
      path,
      contents: `[Unit]\nDescription=Code60 ${kind}\n
[Service]\nType=simple
ExecStart=${[runtime.executable, ...runtime.args].map(unit).join(" ")}
${Object.entries(runtime.env)
  .map(([k, v]) => `Environment=${unit(`${k}=${v}`)}`)
  .join("\n")}
Restart=on-failure\nRestartSec=30\nTimeoutStopSec=60\nKillMode=control-group
\n[Install]\nWantedBy=default.target\n`,
      install: [
        ["systemctl", "--user", "daemon-reload"],
        ["systemctl", "--user", "enable", "--now", unitName],
      ],
      start: [["systemctl", "--user", "start", unitName]],
      stop: [["systemctl", "--user", "stop", unitName]],
      uninstall: [["systemctl", "--user", "disable", "--now", unitName]],
      status: ["systemctl", "--user", "is-active", unitName],
    };
  }
  throw new Error("Background scheduling is unsupported on this platform");
}

export type ServiceCommand = (argv: readonly string[]) => Promise<boolean>;
export async function userServiceSnapshot(path: string) {
  const entry = await lstat(path).catch((error: unknown) => {
    if (installationFileCode(error) !== "ENOENT") throw error;
    return null;
  });
  return entry ? installationSnapshot(path, 64 * 1024, true) : null;
}
type ServiceInspectionCommand = (
  argv: readonly string[],
) => Promise<{ ok: boolean; stdout: string }>;
const inspectCommand: ServiceInspectionCommand = (argv) =>
  new Promise((resolve) => {
    const [file, ...args] = argv;
    if (!file) return resolve({ ok: false, stdout: "" });
    execFile(
      file,
      args,
      { timeout: 5000, maxBuffer: 64 * 1024, windowsHide: true },
      (error, stdout) => resolve({ ok: !error, stdout }),
    );
  });

/** Inspect only fixed supervisor commands; never install, repair or start on a read. */
export async function inspectUserService(
  definition: UserServiceDefinition,
  command: ServiceInspectionCommand = inspectCommand,
): Promise<{
  definitionPresent: boolean;
  state: "running" | "stopped" | "unavailable";
  pid?: number;
  loaded?: boolean;
}> {
  const file = await lstat(definition.path).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return null;
  });
  if (file && (!file.isFile() || file.size > 64 * 1024))
    throw new Error("Scheduling Service registration is unavailable.");
  const definitionPresent = file !== null;
  if (definition.status[0] === "systemctl") {
    const result = await command([
      "systemctl",
      "--user",
      "show",
      definition.status.at(-1) ?? "",
      "--property=LoadState",
      "--property=ActiveState",
      "--property=MainPID",
    ]);
    const fields = new Map(
      result.stdout
        .trim()
        .split("\n")
        .map((line) => {
          const [key = "", value = ""] = line.split("=");
          return [key, value] as const;
        }),
    );
    const load = fields.get("LoadState");
    const state = fields.get("ActiveState");
    return {
      definitionPresent,
      ...(Number(fields.get("MainPID")) > 0 ? { pid: Number(fields.get("MainPID")) } : {}),
      state:
        (!result.ok && !(load === "not-found" && state === "inactive")) ||
        !["loaded", "not-found"].includes(load ?? "")
          ? "unavailable"
          : state === "active" ||
              state === "activating" ||
              state === "reloading" ||
              state === "deactivating"
            ? "running"
            : state === "inactive" || state === "failed"
              ? "stopped"
              : "unavailable",
    };
  }
  const result = await command(definition.status);
  if (result.ok) {
    const state = /^\s*state = (.+)$/m.exec(result.stdout)?.[1]?.trim();
    return {
      definitionPresent,
      loaded: true,
      ...(/^\s*pid = ([1-9]\d*)$/m.exec(result.stdout)
        ? { pid: Number(/^\s*pid = ([1-9]\d*)$/m.exec(result.stdout)?.[1]) }
        : {}),
      state:
        state === "running"
          ? "running"
          : state === "not running" || state === "waiting"
            ? "stopped"
            : "unavailable",
    };
  }
  // A reachable domain alone is insufficient. Its successful service inventory
  // must positively show that this job is absent, even after a failed bootout.
  const supervisor = await command(["launchctl", "print", `gui/${process.getuid?.() ?? -1}`]);
  const services = /^\s*services = \{\n([\s\S]*?)^\s*\}/m.exec(supervisor.stdout)?.[1];
  const unloaded =
    supervisor.ok &&
    services !== undefined &&
    !services.includes((definition.status.at(-1) ?? "").split("/").at(-1) ?? "");
  return {
    definitionPresent,
    ...(unloaded ? { loaded: false } : {}),
    state: unloaded ? "stopped" : "unavailable",
  };
}
const runServiceCommand: ServiceCommand = (argv) =>
  new Promise((resolve) => {
    const [file, ...args] = argv;
    if (!file) {
      resolve(false);
      return;
    }
    execFile(file, args, { timeout: 15_000, maxBuffer: 64 * 1024, windowsHide: true }, (error) =>
      resolve(!error),
    );
  });

/** Only invoked after explicit consent, or repair of an already consented registration. */
export async function controlUserService(
  definition: UserServiceDefinition,
  action: "install" | "repair" | "start" | "stop" | "uninstall" | "status",
  command: ServiceCommand = runServiceCommand,
  inspectionCommand: ServiceInspectionCommand = inspectCommand,
  ownership: { expected?: FileIdentity | null } = {},
): Promise<{ available: boolean }> {
  if (action === "status") return { available: await command(definition.status) };
  const verifyOwnership = async () => {
    if (!Object.hasOwn(ownership, "expected")) return;
    const current = await userServiceSnapshot(definition.path);
    if (JSON.stringify(current?.identity ?? null) !== JSON.stringify(ownership.expected))
      throw Error("Service definition changed; preserved outside edits");
  };
  await verifyOwnership();
  if (action === "install" || action === "repair") {
    if (action === "repair")
      for (const argv of definition.stop)
        if (!(await command(argv))) {
          const native = await inspectUserService(definition, inspectionCommand);
          if (native.state !== "stopped" || (argv[0] === "launchctl" && native.loaded !== false))
            throw new Error(
              "Scheduling Service could not stop. Its registration was not replaced.",
            );
        }
    if (Object.hasOwn(ownership, "expected")) {
      await createInstallationParents(join(definition.path, ".."));
      await writeInstallationFile(definition.path, definition.contents, ownership.expected ?? null);
    } else {
      await mkdir(join(definition.path, ".."), { recursive: true, mode: 0o700 });
      const temporary = join(definition.path, "..", `${randomUUID()}.tmp`);
      await writePrivateFile(temporary, definition.contents, { mode: 0o600, flag: "wx" });
      try {
        await atomicReplace(temporary, definition.path);
      } finally {
        await unlink(temporary).catch((error) => {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        });
      }
    }
    for (const argv of definition.install)
      if (!(await command(argv)))
        throw new Error(
          "Scheduling Service registration failed. The native user supervisor may be unavailable.",
        );
    return { available: true };
  }
  for (const argv of definition[action])
    if (!(await command(argv))) {
      // Bootstrap fails for an already loaded job; only a successful kickstart
      // proves that start succeeded. All other failures remain fatal.
      if (action === "start" && argv[0] === "launchctl" && argv[1] === "bootstrap") continue;
      // Stop may already have unloaded this exact job. Require positive native
      // absence before treating a second bootout as successful (e.g. uninstall).
      if (
        (action === "stop" || action === "uninstall") &&
        argv[0] === "launchctl" &&
        argv[1] === "bootout"
      ) {
        const native = await inspectUserService(definition, inspectionCommand);
        if (native.state === "stopped" && native.loaded === false) continue;
      }
      throw new Error("Scheduling Service control failed. Check the native user supervisor.");
    }
  if (action === "uninstall") {
    await verifyOwnership();
    await unlink(definition.path);
  }
  return { available: action === "start" };
}
