import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, unlink } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
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
const LABEL = "com.codemanufactory.code60.scheduler";
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
): UserServiceDefinition {
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
    const path = join(home, ".config", "systemd", "user", "code60-scheduler.service");
    return {
      path,
      contents: `[Unit]\nDescription=Code60 scheduled agents\n
[Service]\nType=simple
ExecStart=${[runtime.executable, ...runtime.args].map(unit).join(" ")}
${Object.entries(runtime.env)
  .map(([k, v]) => `Environment=${unit(`${k}=${v}`)}`)
  .join("\n")}
Restart=on-failure\nRestartSec=30\nTimeoutStopSec=60\nKillMode=control-group
\n[Install]\nWantedBy=default.target\n`,
      install: [
        ["systemctl", "--user", "daemon-reload"],
        ["systemctl", "--user", "enable", "--now", "code60-scheduler.service"],
      ],
      start: [["systemctl", "--user", "start", "code60-scheduler.service"]],
      stop: [["systemctl", "--user", "stop", "code60-scheduler.service"]],
      uninstall: [["systemctl", "--user", "disable", "--now", "code60-scheduler.service"]],
      status: ["systemctl", "--user", "is-active", "code60-scheduler.service"],
    };
  }
  throw new Error("Background scheduling is unsupported on this platform");
}

export type ServiceCommand = (argv: readonly string[]) => Promise<boolean>;
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
): Promise<{ definitionPresent: boolean; state: "running" | "stopped" | "unavailable" }> {
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
      "code60-scheduler.service",
      "--property=LoadState",
      "--property=ActiveState",
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
      state:
        state === "running"
          ? "running"
          : state === "not running" || state === "waiting"
            ? "stopped"
            : "unavailable",
    };
  }
  const supervisor = await command([
    "launchctl",
    "print-disabled",
    `gui/${process.getuid?.() ?? -1}`,
  ]);
  return { definitionPresent, state: supervisor.ok ? "stopped" : "unavailable" };
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
  inspect: typeof inspectUserService = inspectUserService,
): Promise<{ available: boolean }> {
  if (action === "status") return { available: await command(definition.status) };
  if (action === "install" || action === "repair") {
    if (action === "repair")
      for (const argv of definition.stop)
        if (!(await command(argv)) && (await inspect(definition)).state !== "stopped")
          throw new Error("Scheduling Service could not stop. Its registration was not replaced.");
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
      throw new Error("Scheduling Service control failed. Check the native user supervisor.");
    }
  if (action === "uninstall") await unlink(definition.path);
  return { available: action === "start" };
}
