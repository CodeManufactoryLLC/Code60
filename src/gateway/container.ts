import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CODE60_VERSION } from "../core/index.js";
import { type ContainerGatewayOptions, managementRequest, startGateway } from "./server.js";

export const DEFAULT_CONTAINER_PORT = 6060;

export interface ContainerRuntimeConfig {
  container: ContainerGatewayOptions;
  roots?: readonly string[];
}

export interface ContainerIo {
  env?: NodeJS.ProcessEnv;
  nodeMajor?: number;
  stdout?: { write(chunk: string): unknown };
  stderr?: { write(chunk: string): unknown };
  onSignal?: (signal: "SIGINT" | "SIGTERM", listener: () => void) => void;
  start?: typeof startGateway;
  request?: typeof managementRequest;
}

const HELP = `Usage:
  code60-gateway [serve]   Run Code60 Gateway in the foreground for container use.
  code60-gateway pair      Print the browser URL and a fresh 60-second pairing code.
  code60-gateway health    Verify that the running container gateway responds on loopback.
  code60-gateway --help    Show this help.

Environment:
  CODE60_PORT              Container listening port (default: ${DEFAULT_CONTAINER_PORT}).
  CODE60_BIND              Listening interface: 0.0.0.0 (default) or 127.0.0.1.
  CODE60_ORIGIN            Exact browser origin (default: http://127.0.0.1:<CODE60_PORT>).
                           Non-loopback origins require pairing.
  CODE60_WORKSPACE_ROOTS   Optional colon-separated absolute paths for the workspace chooser.
`;

function parsePort(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return DEFAULT_CONTAINER_PORT;
  if (!/^[1-9]\d{0,4}$/.test(value.trim()) || Number(value.trim()) > 65535)
    throw new Error("CODE60_PORT must be an integer between 1 and 65535.");
  return Number(value.trim());
}

function parseBind(value: string | undefined): "0.0.0.0" | "127.0.0.1" {
  if (value === undefined || value.trim() === "") return "0.0.0.0";
  const trimmed = value.trim();
  if (trimmed !== "0.0.0.0" && trimmed !== "127.0.0.1")
    throw new Error("CODE60_BIND must be 0.0.0.0 or 127.0.0.1.");
  return trimmed;
}

function parseOrigin(value: string | undefined, port: number): string {
  const candidate =
    value === undefined || value.trim() === "" ? `http://127.0.0.1:${port}` : value.trim();
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("CODE60_ORIGIN must be a valid http:// or https:// origin.");
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    parsed.origin !== candidate
  )
    throw new Error(
      "CODE60_ORIGIN must be a normalized http:// or https:// origin without path, query or credentials.",
    );
  return parsed.origin;
}

function parseWorkspaceRoots(value: string | undefined): readonly string[] | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parts = value.split(":").map((entry) => entry.trim());
  if (
    !parts.length ||
    parts.length > 32 ||
    parts.some((entry) => !entry.startsWith("/") || entry.includes("\0"))
  )
    throw new Error("CODE60_WORKSPACE_ROOTS must list 1 to 32 colon-separated absolute paths.");
  return parts;
}

export function parseContainerConfig(env: Readonly<NodeJS.ProcessEnv>): ContainerRuntimeConfig {
  const port = parsePort(env.CODE60_PORT);
  const bindHost = parseBind(env.CODE60_BIND);
  const origin = parseOrigin(env.CODE60_ORIGIN, port);
  const roots = parseWorkspaceRoots(env.CODE60_WORKSPACE_ROOTS);
  return {
    container: { port, bindHost, origin },
    ...(roots ? { roots } : {}),
  };
}

export async function runContainerCommand(
  args: readonly string[],
  io: ContainerIo = {},
): Promise<number> {
  const env = io.env ?? process.env;
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const nodeMajor = io.nodeMajor ?? Number(process.versions.node.split(".")[0]);
  const [command = "serve", ...rest] = args;

  if (command === "--help" || command === "-h" || command === "help") {
    stdout.write(HELP);
    return 0;
  }
  if (rest.length > 0) {
    stderr.write("Use code60-gateway --help for supported commands.\n");
    return 1;
  }
  if (nodeMajor !== 24) {
    stderr.write("Code60 requires Node 24.\n");
    return 1;
  }

  const request = io.request ?? managementRequest;
  if (command === "health") {
    try {
      const status = await request(env, "status");
      if (typeof status.pid === "number" && typeof status.version === "number") return 0;
      stderr.write("Code60 gateway status response is invalid.\n");
      return 1;
    } catch {
      stderr.write("Code60 gateway is not ready.\n");
      return 1;
    }
  }
  if (command === "pair") {
    try {
      const pairing = await request(env, "pair");
      if (typeof pairing.origin !== "string" || typeof pairing.requirePairing !== "boolean") {
        stderr.write("Code60 gateway pairing response is invalid.\n");
        return 1;
      }
      stdout.write(`Open ${pairing.origin}\n`);
      if (pairing.requirePairing && typeof pairing.code === "string")
        stdout.write(`Pairing code (valid for 60 seconds): ${pairing.code}\n`);
      else stdout.write("Pairing is off. Enable it with: code60 pairing on --yes\n");
      return 0;
    } catch {
      stderr.write("Code60 gateway is not running. Start the container first.\n");
      return 1;
    }
  }
  if (command !== "serve") {
    stderr.write("Use code60-gateway --help for supported commands.\n");
    return 1;
  }

  let config: ContainerRuntimeConfig;
  try {
    config = parseContainerConfig(env);
  } catch (error) {
    stderr.write(
      `${error instanceof Error ? error.message : "Invalid container configuration."}\n`,
    );
    return 1;
  }

  const start = io.start ?? startGateway;
  let gateway: Awaited<ReturnType<typeof startGateway>>;
  try {
    gateway = await start({
      env,
      container: config.container,
      ...(config.roots ? { roots: config.roots } : {}),
    });
  } catch {
    stderr.write(
      "Code60 container gateway could not start. Check Node 24, private storage, assets and port availability.\n",
    );
    return 1;
  }

  stdout.write(
    `Code60 v${CODE60_VERSION} listening on http://${config.container.bindHost}:${config.container.port}\n`,
  );
  stdout.write(`Open ${gateway.origin}\n`);
  if (gateway.requirePairing)
    stdout.write(`Pairing code (valid for 60 seconds): ${gateway.proof()}\n`);

  const onSignal =
    io.onSignal ??
    ((signal, listener) => {
      process.once(signal, listener);
    });

  return await new Promise<number>((done) => {
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      void gateway.stop().then(
        () => done(0),
        () => {
          stderr.write("Backend cleanup could not finish. Ownership was retained.\n");
          done(1);
        },
      );
    };
    onSignal("SIGINT", stop);
    onSignal("SIGTERM", stop);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runContainerCommand(process.argv.slice(2));
}
