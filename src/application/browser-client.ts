import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  type BrowserMode,
  isAllowedBrowserTool,
  MCP_PROTOCOL_VERSION,
  MCP_PROTOCOL_VERSIONS,
} from "../bridge/index.js";
import { stateHome } from "../core/index.js";
import { type OwnedProcess, privateDirectory, spawnOwnedProcess } from "../platform/index.js";

const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;
const MAX_TOOLS = 128;
const PLAYWRIGHT_MCP_PACKAGE = "@playwright/mcp@0.0.84";
export const browserArguments = (mode: BrowserMode): string[] => [
  "-y",
  PLAYWRIGHT_MCP_PACKAGE,
  ...(mode === "existing-browser"
    ? ["--extension"]
    : ["--isolated", ...(mode === "headless" ? ["--headless"] : [])]),
  "--no-webmcp",
  "--output-max-size",
  "33554432",
];

const browserObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

interface BrowserTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}
export interface BrowserClient {
  connected?(): boolean;
  listTools(signal: AbortSignal): Promise<BrowserTool[]>;
  call(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown>;
  close(): Promise<void>;
}

/** Small stdio MCP client for the fixed Playwright server. No server-initiated capabilities. */
export async function startBrowserClient(
  mode: BrowserMode,
  directory: string,
  environment: Readonly<Record<string, string | undefined>>,
  signal: AbortSignal,
  spawn = spawnOwnedProcess,
): Promise<BrowserClient> {
  signal.throwIfAborted();
  const env = { ...environment };
  // Ambient Playwright flags must not override the selected mode, inject scripts,
  // attach another endpoint or bypass the extension's user approval.
  for (const key of Object.keys(env))
    if (
      key.startsWith("PLAYWRIGHT_MCP_") ||
      /^npm_config_/i.test(key) ||
      key === "NODE_OPTIONS" ||
      key === "NODE_PATH"
    )
      delete env[key];
  const runtime = await mkdtemp(join(tmpdir(), "code60-browser-runtime-"));
  const config = join(runtime, ".npmrc");
  const globalConfig = join(runtime, "global.npmrc");
  const cache = join(stateHome(environment), "code60", "browser-npm-cache");
  try {
    await privateDirectory(cache);
    await writeFile(
      join(runtime, "package.json"),
      '{"name":"code60-browser-runtime","private":true}\n',
      { mode: 0o600 },
    );
    await writeFile(config, "", { mode: 0o600 });
    await writeFile(globalConfig, "", { mode: 0o600 });
  } catch (error) {
    await rm(runtime, { recursive: true, force: true });
    throw error;
  }
  Object.assign(env, {
    NPM_CONFIG_USERCONFIG: config,
    NPM_CONFIG_GLOBALCONFIG: globalConfig,
    NPM_CONFIG_PREFIX: runtime,
    NPM_CONFIG_CACHE: cache,
    NPM_CONFIG_GLOBAL: "false",
    NPM_CONFIG_REGISTRY: "https://registry.npmjs.org",
    NPM_CONFIG_IGNORE_SCRIPTS: "true",
    NPM_CONFIG_SCRIPT_SHELL: "/bin/sh",
  });
  let child: OwnedProcess;
  try {
    signal.throwIfAborted();
    child = await spawn(
      ["npx", ...browserArguments(mode), "--output-dir", join(runtime, "artifacts")],
      runtime,
      env,
    );
  } catch {
    await rm(runtime, { recursive: true, force: true });
    throw new Error("Could not start Playwright MCP. Install Node.js/npm and a supported browser.");
  }
  let buffer = Buffer.alloc(0);
  let sequence = 0;
  let failure: Error | undefined;
  let closing: Promise<void> | undefined;
  let browserOpen = false;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const fail = (message: string) => {
    failure ??= new Error(message);
    for (const request of pending.values()) request.reject(failure);
    pending.clear();
  };
  const send = (value: unknown) => child.stdin.write(`${JSON.stringify(value)}\n`);
  const onData = (chunk: Buffer) => {
    if (failure) return;
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > MAX_MESSAGE_BYTES) {
      buffer = Buffer.alloc(0);
      fail("Playwright response exceeded the browser message limit.");
      return;
    }
    for (;;) {
      const newline = buffer.indexOf(10);
      if (newline === -1) break;
      const line = buffer.subarray(0, newline).toString("utf8");
      buffer = buffer.subarray(newline + 1);
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        fail("Playwright sent invalid MCP data.");
        return;
      }
      if (!browserObject(message) || message.jsonrpc !== "2.0") {
        fail("Playwright sent invalid MCP data.");
        return;
      }
      if (typeof message.method === "string") {
        if (message.method === "roots/list" && message.id !== undefined) {
          send({
            jsonrpc: "2.0",
            id: message.id,
            result: {
              roots: [{ uri: pathToFileURL(directory).href, name: "Code60 conversation" }],
            },
          });
          continue;
        }
        // No elicitation, sampling or arbitrary host capabilities.
        if (message.id !== undefined)
          send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Unsupported" } });
        continue;
      }
      if (typeof message.id !== "number") continue;
      const request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id);
      if (Object.hasOwn(message, "error"))
        request.reject(new Error("Playwright MCP request failed."));
      else if (Object.hasOwn(message, "result")) request.resolve(message.result);
      else request.reject(new Error("Playwright sent an invalid MCP response."));
    }
  };
  child.stdout.on("data", onData);
  child.stderr.resume(); // Drain without recording potentially sensitive browser output.
  const onError = () => fail("Playwright MCP connection failed.");
  child.stdout.on("error", onError);
  child.stdin.on("error", onError);
  void child.exited.then(() =>
    fail("Playwright MCP stopped. Start a new browser action to reconnect."),
  );

  const request = async (method: string, params: unknown, cancellation: AbortSignal) => {
    cancellation.throwIfAborted();
    if (failure) throw failure;
    const id = ++sequence;
    let abort: () => void = () => {};
    try {
      return await new Promise<unknown>((resolve, reject) => {
        abort = () => {
          pending.delete(id);
          send({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: id } });
          reject(new Error("Browser action cancelled or timed out; inspect before retrying."));
        };
        pending.set(id, { resolve, reject });
        cancellation.addEventListener("abort", abort, { once: true });
        send({ jsonrpc: "2.0", id, method, params });
      });
    } finally {
      cancellation.removeEventListener("abort", abort);
      pending.delete(id);
    }
  };
  const close = () => {
    closing ??= (async () => {
      if (browserOpen) {
        // Chromium has its own POSIX group. Its close acknowledgement, rather
        // than the npm group's exit, establishes that the isolated browser exited.
        const result = await request(
          "tools/call",
          { name: "browser_close", arguments: {} },
          AbortSignal.timeout(5_000),
        );
        if (!browserObject(result) || !Array.isArray(result.content) || result.isError === true)
          throw new Error("Isolated browser shutdown could not be verified. Retry cleanup.");
        browserOpen = false;
      }
      fail("Browser connection closed.");
      child.stdin.end();
      try {
        await child.stop();
        await rm(runtime, { recursive: true, force: true });
      } finally {
        child.stdout.off("data", onData);
        child.stdout.off("error", onError);
        child.stdin.off("error", onError);
      }
    })();
    void closing.catch(() => {
      closing = undefined;
    });
    return closing;
  };
  try {
    const initialized = await request(
      "initialize",
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { roots: { listChanged: false } },
        clientInfo: { name: "Code60 browser", version: "1" },
      },
      signal,
    );
    if (
      !browserObject(initialized) ||
      !browserObject(initialized.capabilities) ||
      !MCP_PROTOCOL_VERSIONS.includes(initialized.protocolVersion as typeof MCP_PROTOCOL_VERSION)
    )
      throw new Error("Playwright MCP initialization failed.");
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    return {
      connected: () => !failure && !child.hasExited(),
      async listTools(signal) {
        const tools: BrowserTool[] = [];
        let catalogSize = 0;
        const cursors = new Set<string>();
        let cursor: string | undefined;
        do {
          const result = await request("tools/list", cursor ? { cursor } : {}, signal);
          if (!browserObject(result) || !Array.isArray(result.tools))
            throw new Error("Invalid Playwright tool catalog.");
          catalogSize += result.tools.length;
          if (catalogSize > MAX_TOOLS) throw new Error("Playwright tool catalog is too large.");
          for (const tool of result.tools) {
            if (!browserObject(tool) || typeof tool.name !== "string")
              throw new Error("Invalid Playwright tool catalog.");
            if (!isAllowedBrowserTool(tool.name)) continue;
            if (!browserObject(tool.inputSchema))
              throw new Error("Invalid Playwright tool schema.");
            tools.push(tool as unknown as BrowserTool);
          }
          if (tools.length > MAX_TOOLS) throw new Error("Playwright tool catalog is too large.");
          if (result.nextCursor !== undefined && typeof result.nextCursor !== "string")
            throw new Error("Invalid Playwright tool cursor.");
          cursor = result.nextCursor as string | undefined;
          if (cursor && cursors.has(cursor)) throw new Error("Repeated Playwright tool cursor.");
          if (cursor) cursors.add(cursor);
        } while (cursor);
        return tools;
      },
      async call(name, args, signal) {
        if (!isAllowedBrowserTool(name)) throw new Error("This browser tool is not allowed.");
        if (mode !== "existing-browser" && name !== "browser_close") browserOpen = true;
        const result = await request("tools/call", { name, arguments: args }, signal);
        if (!browserObject(result) || !Array.isArray(result.content))
          throw new Error("Invalid Playwright tool result.");
        if (name === "browser_close" && result.isError !== true) browserOpen = false;
        return result;
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
