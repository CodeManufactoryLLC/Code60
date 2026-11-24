import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { defaultWorkflowEngine } from "../contracts/index.js";
import {
  absoluteInstallationPath,
  resolveTransmissionRuntime,
  runInstallationCommand,
  workflowHostSupported,
} from "../platform/index.js";

interface LoginPorts {
  interactive: boolean;
  runtime(
    env: NodeJS.ProcessEnv,
    signal: AbortSignal,
  ): Promise<{ root: string; node: string; codex: string }>;
  probe(
    node: string,
    env: NodeJS.ProcessEnv,
    signal: AbortSignal,
  ): Promise<{ version: string; executable: string }>;
  run(
    node: string,
    args: readonly string[],
    env: NodeJS.ProcessEnv,
    signal: AbortSignal,
  ): Promise<number>;
  deadline(): AbortSignal;
  listen(interrupt: () => void, terminate: () => void, hangup: () => void): () => void;
}
const execute = promisify(execFile);
const defaultPorts = (): LoginPorts => ({
  interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  runtime: (env, signal) =>
    resolveTransmissionRuntime(env, defaultWorkflowEngine(process.platform), signal),
  probe: async (node, env, signal) => {
    const { stdout } = await execute(
      node,
      ["-p", "JSON.stringify({version:process.versions.node,executable:process.execPath})"],
      { env, signal, timeout: 5000, maxBuffer: 4096 },
    );
    return JSON.parse(stdout);
  },
  run: runInstallationCommand,
  deadline: () => AbortSignal.timeout(10 * 60_000),
  listen: (interrupt, terminate, hangup) => {
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", terminate);
    process.on("SIGHUP", hangup);
    return () => {
      process.removeListener("SIGINT", interrupt);
      process.removeListener("SIGTERM", terminate);
      process.removeListener("SIGHUP", hangup);
    };
  },
});

/** Explicit terminal-only provider authentication; never installs or starts an engine. */
export async function workflowLogin(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  ports = defaultPorts(),
) {
  if (args.length !== 1 || args[0] !== "login") throw Error("Use code60 workflows login.");
  if (!workflowHostSupported())
    throw Error("Workflow login requires macOS Apple Silicon or Linux x64 with glibc.");
  if (!ports.interactive)
    throw Error(
      "Workflow login requires an interactive terminal. Run code60 workflows login after setup.",
    );
  if (env.CODEX_HOME) absoluteInstallationPath(env.CODEX_HOME);
  const environment = { ...env };
  for (const key of Object.keys(environment))
    if (/^npm_config_/i.test(key) || key === "NODE_OPTIONS" || key === "NODE_PATH")
      delete environment[key];
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, ports.deadline()]);
  let interrupted: number | undefined;
  const interrupt = () => {
    interrupted = 130;
    controller.abort();
  };
  const terminate = () => {
    interrupted = 143;
    controller.abort();
  };
  const hangup = () => {
    interrupted = 129;
    controller.abort();
  };
  const unlisten = ports.listen(interrupt, terminate, hangup);
  try {
    const runtime = await ports.runtime(environment, signal);
    environment.CODEX_PATH = runtime.codex;
    const node = await ports.probe(runtime.node, environment, signal);
    if (
      !/^24\.(?:2[2-9]|[3-9]\d|\d{3,})\.[0-9]+$/.test(node.version) ||
      node.executable !== runtime.node
    )
      throw Error(
        "Workflow login requires the recorded Node >=24.22.0 <25; reconcile its runtime binding.",
      );
    const code = await ports.run(
      runtime.node,
      [join(runtime.root, "node_modules/@openai/codex/bin/codex.js"), "login"],
      environment,
      signal,
    );
    if (interrupted) return interrupted;
    if (signal.aborted)
      throw Error("Workflow login timed out; inspect Codex login before retrying.");
    return code;
  } catch (error) {
    if (interrupted) return interrupted;
    if (signal.aborted)
      throw Error("Workflow login timed out; inspect Codex login before retrying.");
    throw error;
  } finally {
    unlisten();
  }
}
