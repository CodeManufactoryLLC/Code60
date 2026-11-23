import { execFile } from "node:child_process";
import { createInterface } from "node:readline/promises";
import {
  type BackendControl,
  backendControl,
  managementRequest,
  pairingControl,
} from "../gateway/index.js";

import { combinedStatus, runSetup } from "./setup.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function confirmChange(description: string, flags: readonly string[]) {
  if (flags.includes("--yes")) return true;
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error(
      "Explicit consent is required. Supply --yes for a local setting or service change.",
    );
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(?:es)?$/i.test((await input.question(`${description} [y/N] `)).trim());
  } finally {
    input.close();
  }
}
export async function runManagement(args: readonly string[], env: NodeJS.ProcessEnv = process.env) {
  if (Number(process.versions.node.split(".")[0]) !== 24)
    throw new Error("Code60 requires Node 24.");
  const [command = "open", action, ...flags] = args;
  if (command === "setup") {
    await runSetup(args.slice(1), env);
    return;
  }
  if (command === "status") {
    if (args.length !== 1) throw Error("Use code60 status.");
    process.stdout.write(`${JSON.stringify(await combinedStatus(env))}\n`);
    return;
  }
  if (command === "--help" || command === "help") {
    process.stdout.write(
      "code60 setup [--yes] [--no-open]\ncode60 status\ncode60 open\ncode60 service install|status|start|stop|repair|uninstall [--yes]\ncode60 pairing on|off|status [--yes]\n",
    );
    return;
  }
  if (command === "pairing") {
    const mode = action ?? "status";
    if (!["on", "off", "status"].includes(mode) || flags.some((flag) => flag !== "--yes"))
      throw new Error("Use code60 pairing on|off|status [--yes].");
    if (
      mode !== "status" &&
      !(await confirmChange(
        `Turn pairing ${mode}? Current browser sessions will reconnect; approved work keeps running.`,
        flags,
      ))
    )
      return;
    process.stdout.write(
      `${JSON.stringify(await pairingControl(env, mode === "status" ? undefined : mode === "on"))}\n`,
    );
    return;
  }
  if (command === "service") {
    if (
      !["install", "status", "start", "stop", "repair", "uninstall"].includes(action ?? "") ||
      flags.some((flag) => flag !== "--yes")
    )
      throw new Error("Use code60 service install|status|start|stop|repair|uninstall [--yes].");
    const consent =
      ["status", "start"].includes(action ?? "") ||
      (await confirmChange(
        `Confirm ${action} Code60 Backend Service? Active work may stop; existing scheduler registration may be transferred.`,
        flags,
      ));
    if (!consent) return;
    const result = await backendControl(env, action as BackendControl, consent);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (command !== "open" || action !== undefined)
    throw new Error("Use code60 open, code60 service or code60 pairing. See code60 --help.");
  const status = await backendControl(env, "status");
  if (!status.installed) throw new Error("Install the login backend with code60 service install.");
  if (!status.service) await backendControl(env, "start");
  let pairing: Record<string, unknown> | undefined;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      pairing = await managementRequest(env, "pair");
      break;
    } catch {
      await sleep(100);
    }
  }
  if (
    !pairing ||
    typeof pairing.origin !== "string" ||
    typeof pairing.requirePairing !== "boolean" ||
    (pairing.requirePairing && typeof pairing.code !== "string")
  )
    throw new Error("Backend did not become ready. Run code60 service status.");
  // Pairing is an intentional terminal result, never a diagnostic or subprocess argument.
  process.stdout.write(`Open ${pairing.origin}\n`);
  if (pairing.requirePairing)
    process.stdout.write(`Pairing code (valid for 60 seconds): ${pairing.code}\n`);
  const opener = process.platform === "darwin" ? "/usr/bin/open" : "xdg-open";
  await new Promise<void>((resolve) =>
    execFile(opener, [pairing.origin as string], { timeout: 5000, env }, (error) => {
      if (error) process.stderr.write("Open the address above in your browser.\n");
      resolve();
    }),
  );
}
