import { execFile } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { backendControl, managementRequest } from "../gateway/index.js";
import { lockInstallation } from "../platform/index.js";
import { managedInstallation, shellQuote } from "./install-state.js";
import { checkSetup, setupFlags } from "./setup-input.js";
import { applyShellIntegration, planShellIntegration } from "./shell-integration.js";

interface ServiceStatus {
  installed: boolean;
  nativeState?: string;
  runtimeCurrent?: boolean;
  service?: Record<string, unknown> | null;
}
export interface SetupPorts {
  interactive: boolean;
  confirm(message: string, signal: AbortSignal): Promise<boolean>;
  write(message: string): void;
  service(action: "status" | "install" | "start", consent?: boolean): Promise<ServiceStatus>;
  request(action: "status" | "prepare-database" | "pair"): Promise<Record<string, unknown>>;
  open(origin: string): Promise<void>;
  readinessMs: number;
}
async function prompt(message: string, signal: AbortSignal) {
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(?:es)?$/i.test((await input.question(`${message} [y/N] `, { signal })).trim());
  } finally {
    input.close();
  }
}
function portsFor(env: NodeJS.ProcessEnv): SetupPorts {
  return {
    interactive: !!process.stdin.isTTY && !!process.stdout.isTTY,
    confirm: prompt,
    write: (text) => {
      process.stdout.write(text);
    },
    service: (action, consent) => backendControl(env, action, consent),
    request: (action) => managementRequest(env, action),
    open: (origin) =>
      new Promise<void>((resolve) => {
        execFile(
          process.platform === "darwin" ? "/usr/bin/open" : "xdg-open",
          [origin],
          { env, timeout: 5000 },
          (error) => {
            if (error) process.stderr.write("Open the address above in your browser.\n");
            resolve();
          },
        );
      }),
    readinessMs: 30000,
  };
}
export async function combinedStatus(env: NodeJS.ProcessEnv) {
  const installation = await managedInstallation(env)
    .then((value) =>
      value
        ? { state: "ready", version: value.receipt.release.version }
        : { state: "not-installed" },
    )
    .catch(() => ({ state: "unavailable" }));
  const backend = await backendControl(env, "status").catch(() => ({
    installed: false,
    nativeState: "unavailable",
    service: null,
  }));
  const live = backend.service;
  return {
    installation,
    runtime: { node: process.versions.node, platform: `${process.platform}-${process.arch}` },
    backend: { installed: backend.installed, nativeState: backend.nativeState, available: !!live },
    database: live?.database ?? { state: "unavailable" },
    engines: live?.engines ?? { bundled: false, state: "unavailable" },
  };
}
export async function runSetup(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  injected?: SetupPorts,
) {
  const flags = setupFlags(args);
  const controller = new AbortController();
  let interrupted: number | undefined;
  const stop = () => {
    interrupted = 130;
    controller.abort();
  };
  const terminate = () => {
    interrupted = 143;
    controller.abort();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", terminate);
  const signal = controller.signal;
  let release: (() => Promise<void>) | undefined;
  let recovery: string | undefined;
  try {
    await checkSetup(args, env, signal);
    const installed = await managedInstallation(env);
    if (
      !installed ||
      (!injected &&
        fileURLToPath(new URL("./cli.js", import.meta.url)) !==
          join(installed.receipt.release.path, "dist/management/cli.js"))
    )
      throw Error("Run the Code60 distribution bootstrap setup to install this release first");
    recovery = `${shellQuote(installed.record.launcher)} status`;
    release = await lockInstallation(installed.record.root, "setup");
    const ports = injected ?? portsFor(env);
    const continuation = `${shellQuote(installed.record.launcher)} setup --yes${flags.noOpen ? " --no-open" : ""}`;
    const preview = await planShellIntegration(env);
    if (preview.edits.length) {
      ports.write(
        `Shell PATH preview:\n${preview.edits.map((edit) => `${edit.path}\n${edit.append}`).join("\n")}\n`,
      );
      if (
        ports.interactive &&
        (await ports.confirm("Apply these shell profile additions?", signal))
      ) {
        const result = await applyShellIntegration(preview, { approved: true, interactive: true });
        for (const message of result.manual) ports.write(`${message}\n`);
        ports.write(`${preview.newTerminal}\n`);
      }
    }
    for (const message of preview.manual) ports.write(`${message}\n`);
    ports.write(
      `Current shell: ${preview.currentSessionCommand}\nLauncher: ${installed.record.launcher}\n`,
    );
    signal.throwIfAborted();
    const status = await ports.service("status");
    if (!status.installed) {
      const approved =
        flags.yes ||
        (ports.interactive &&
          (await ports.confirm("Install the per-user Code60 background service?", signal)));
      if (!approved) {
        ports.write(
          `Code60 files are installed. Setup is incomplete; no service or database was prepared.\nContinue: ${continuation}\n`,
        );
        return;
      }
      signal.throwIfAborted();
      await ports.service("install", true);
    } else {
      if (status.runtimeCurrent !== true || status.nativeState === "unavailable")
        throw Error(
          "Backend registration is conflicting or unavailable. Inspect code60 service status; explicitly reconcile with code60 service repair --yes.",
        );
      if (!status.service) await ports.service("start");
    }
    const deadline = Date.now() + ports.readinessMs;
    let live: Record<string, unknown> | undefined;
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      live = await ports.request("status").catch(() => undefined);
      if (live) {
        const enrolled = await ports.service("status");
        if (
          enrolled.installed &&
          enrolled.nativeState === "running" &&
          enrolled.service?.pid === live.pid
        )
          break;
        live = undefined;
      }
      await delay(100, undefined, { signal });
    }
    if (!live)
      throw Error(
        "Backend readiness timed out. Installed files and service were preserved; run code60 service status.",
      );
    signal.throwIfAborted();
    await ports.request("prepare-database");
    signal.throwIfAborted();
    const pairing = await ports.request("pair");
    if (
      typeof pairing.origin !== "string" ||
      !/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(pairing.origin) ||
      typeof pairing.requirePairing !== "boolean" ||
      (pairing.requirePairing && typeof pairing.code !== "string")
    )
      throw Error("Backend returned invalid browser readiness metadata");
    ports.write(`Code60 is ready.\nOpen ${pairing.origin}\n`);
    if (pairing.requirePairing)
      ports.write(`Pairing code (valid for 60 seconds): ${pairing.code}\n`);
    if (!flags.noOpen)
      await ports
        .open(pairing.origin)
        .catch(() => ports.write("Open the address above in your browser.\n"));
  } catch (error) {
    if (recovery && !signal.aborted)
      throw new Error(
        `${error instanceof Error ? error.message : "Setup failed"} Installed files and committed state were preserved. Inspect ${recovery}.`,
        { cause: error },
      );
    throw error;
  } finally {
    try {
      await release?.();
    } finally {
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", terminate);
      if (interrupted) process.exitCode = interrupted;
    }
  }
}
