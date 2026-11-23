import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MCP_PROTOCOL_VERSION } from "../bridge/index.js";
import type { OwnedProcess, spawnOwnedProcess } from "../platform/index.js";
import { browserArguments, startBrowserClient } from "./browser-client.js";

type Message = { id: number; method: string; params?: Record<string, unknown> };
let state: string;
const runtimes: string[] = [];
beforeEach(async () => {
  state = await mkdtemp(join(tmpdir(), "code60-browser-test-"));
});
afterEach(async () => {
  await Promise.all(
    [...runtimes.splice(0), state].map((path) => rm(path, { recursive: true, force: true })),
  );
});
function fixture(reply?: (message: Message) => unknown) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const requests: Message[] = [];
  let exited = () => {};
  const child: OwnedProcess = {
    pid: 123,
    stdin: new Writable({
      write(chunk, _encoding, done) {
        const message = JSON.parse(String(chunk)) as Message;
        requests.push(message);
        if (message.id !== undefined && typeof message.method === "string") {
          const result = reply
            ? reply(message)
            : message.method === "initialize"
              ? { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: { tools: {} } }
              : message.method === "tools/list"
                ? { tools: [{ name: "browser_navigate", inputSchema: { type: "object" } }] }
                : { content: [{ type: "text", text: "done" }] };
          if (result !== undefined)
            queueMicrotask(() =>
              stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n`),
            );
        }
        done();
      },
    }),
    stdout,
    stderr,
    exited: new Promise((resolve) => {
      exited = () => resolve({ code: 0, signal: null });
    }),
    hasExited: () => false,
    stop: vi.fn(async () => {
      exited();
    }),
  };
  const spawn = vi.fn<typeof spawnOwnedProcess>(async (_command, directory) => {
    runtimes.push(directory);
    return child;
  });
  const start = (signal = new AbortController().signal) =>
    startBrowserClient(
      "headless",
      "/private/chat",
      {
        PATH: "/bin",
        XDG_STATE_HOME: state,
        NPM_CONFIG_SCRIPT_SHELL: "/untrusted-shell",
        NODE_OPTIONS: "--require /untrusted-preload.js",
        NODE_PATH: "/untrusted-modules",
        PLAYWRIGHT_MCP_HEADLESS: "0",
        PLAYWRIGHT_MCP_EXTENSION_TOKEN: "synthetic",
        PLAYWRIGHT_MCP_INIT_SCRIPT: "/untrusted.js",
      },
      signal,
      spawn,
    );
  return { start, spawn, child, stdout, requests, exited };
}

describe("owned Playwright MCP connection", () => {
  it("advertises only its conversation root while launching npm outside it", async () => {
    const f = fixture();
    const client = await f.start();
    f.stdout.write('{"jsonrpc":"2.0","id":501,"method":"roots/list"}\n');
    await vi.waitFor(() =>
      expect(f.requests.find((request) => request.id === 501)).toMatchObject({
        result: { roots: [{ uri: "file:///private/chat", name: "Code60 conversation" }] },
      }),
    );
    expect(f.spawn.mock.calls[0]?.[1]).not.toBe("/private/chat");
    await client.close();
  });
  it("filters unsafe and page-registered tools without trusting the upstream catalog", async () => {
    const f = fixture((message) =>
      message.method === "initialize"
        ? { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {} }
        : {
            tools: [
              "browser_navigate",
              "browser_run_code_unsafe",
              "webmcp_delete",
              "browser_install",
              "browser_file_upload",
            ].map((name) => ({ name, inputSchema: {} })),
          },
    );
    const client = await f.start();
    expect((await client.listTools(new AbortController().signal)).map((tool) => tool.name)).toEqual(
      ["browser_navigate"],
    );
    await expect(
      client.call("browser_run_code_unsafe", {}, new AbortController().signal),
    ).rejects.toThrow("not allowed");
    expect(f.requests.some((request) => request.method === "tools/call")).toBe(false);
    await client.close();
  });
  it("waits for browser-close acknowledgement before stopping its separate watchdog group", async () => {
    const f = fixture((message) =>
      message.method === "initialize"
        ? { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {} }
        : message.params?.name === "browser_close"
          ? undefined
          : { content: [] },
    );
    const client = await f.start();
    await client.call("browser_navigate", {}, new AbortController().signal);
    const closing = client.close();
    await vi.waitFor(() => expect(f.requests.at(-1)?.params?.name).toBe("browser_close"));
    expect(f.child.stop).not.toHaveBeenCalled();
    f.stdout.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: f.requests.at(-1)?.id, result: { content: [] } })}\n`,
    );
    await closing;
    expect(f.child.stop).toHaveBeenCalledOnce();
  });
  it("reverifies a failed cleanup and reports process exit as disconnected", async () => {
    const f = fixture();
    const client = await f.start();
    f.exited();
    await vi.waitFor(() => expect(client.connected?.()).toBe(false));
    vi.mocked(f.child.stop).mockRejectedValueOnce(new Error("Transient verification"));
    await expect(client.close()).rejects.toThrow("Transient");
    await client.close();
    expect(f.child.stop).toHaveBeenCalledTimes(2);
  });
  it("uses fixed launch arguments and strips ambient Playwright overrides", async () => {
    expect(browserArguments("headless")).toEqual([
      "-y",
      "@playwright/mcp@0.0.84",
      "--isolated",
      "--headless",
      "--no-webmcp",
      "--output-max-size",
      "33554432",
    ]);
    expect(browserArguments("visible")).toEqual([
      "-y",
      "@playwright/mcp@0.0.84",
      "--isolated",
      "--no-webmcp",
      "--output-max-size",
      "33554432",
    ]);
    expect(browserArguments("existing-browser")).toEqual([
      "-y",
      "@playwright/mcp@0.0.84",
      "--extension",
      "--no-webmcp",
      "--output-max-size",
      "33554432",
    ]);
    const f = fixture();
    const client = await f.start();
    expect(f.spawn).toHaveBeenCalledWith(
      ["npx", ...browserArguments("headless"), "--output-dir", expect.any(String)],
      expect.stringContaining("code60-browser-runtime-"),
      expect.objectContaining({
        PATH: "/bin",
        NPM_CONFIG_SCRIPT_SHELL: "/bin/sh",
        NPM_CONFIG_REGISTRY: "https://registry.npmjs.org",
      }),
    );
    const [, runtime, env] = f.spawn.mock.calls[0]!;
    expect(runtime).not.toBe("/private/chat");
    expect(await readFile(join(runtime, "package.json"), "utf8")).toContain('"private":true');
    expect(await readFile(env?.NPM_CONFIG_USERCONFIG as string, "utf8")).toBe("");
    expect(Object.keys(env ?? {}).some((key) => key.startsWith("PLAYWRIGHT_MCP_"))).toBe(false);
    expect(env?.NODE_OPTIONS).toBeUndefined();
    expect(env?.NODE_PATH).toBeUndefined();
    const signal = new AbortController().signal;
    expect(await client.listTools(signal)).toMatchObject([{ name: "browser_navigate" }]);
    expect(
      await client.call("browser_navigate", { url: "https://example.com" }, signal),
    ).toMatchObject({ content: [{ text: "done" }] });
    expect(f.requests.map((r) => r.method)).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/list",
      "tools/call",
    ]);
    await client.close();
    await client.close();
    expect(f.child.stop).toHaveBeenCalledOnce();
  });

  it("cleans up failed initialization and reports missing executables without raw values", async () => {
    const f = fixture(() => ({}));
    await expect(f.start()).rejects.toThrow("initialization");
    expect(f.child.stop).toHaveBeenCalledOnce();
    await expect(
      startBrowserClient(
        "visible",
        "/private/chat",
        { XDG_STATE_HOME: state },
        new AbortController().signal,
        async () => {
          throw new Error("private secret");
        },
      ),
    ).rejects.toThrow("Install Node.js/npm");
  });

  it.each([
    "invalid-json",
    "invalid-envelope",
    "oversize",
    "rpc-error",
    "missing-result",
    "exit",
    "stream-error",
  ])("fails bounded requests on %s", async (kind) => {
    const f = fixture((message) =>
      message.method === "initialize"
        ? { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {} }
        : undefined,
    );
    const client = await f.start();
    const pending = expect(client.listTools(new AbortController().signal)).rejects.toThrow();
    const id = f.requests.at(-1)?.id;
    if (kind === "invalid-json") f.stdout.write("not-json\n");
    else if (kind === "invalid-envelope") f.stdout.write("[]\n");
    else if (kind === "oversize") f.stdout.write("x".repeat(8 * 1024 * 1024 + 1));
    else if (kind === "rpc-error")
      f.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { message: "private" } })}\n`);
    else if (kind === "missing-result")
      f.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id })}\n`);
    else if (kind === "exit") f.exited();
    else f.stdout.emit("error", new Error("private"));
    await pending;
    await client.close();
    expect(f.child.stop).toHaveBeenCalledOnce();
  });

  it("cancels requests, refuses host requests, and ignores notifications/unmatched responses", async () => {
    const f = fixture((message) =>
      message.method === "initialize"
        ? { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {} }
        : undefined,
    );
    const client = await f.start();
    const abort = new AbortController();
    const pending = expect(client.listTools(abort.signal)).rejects.toThrow(
      "cancelled or timed out",
    );
    f.stdout.write('{"jsonrpc":"2.0","method":"notifications/message","params":{}}\n');
    f.stdout.write('{"jsonrpc":"2.0","id":99,"method":"sampling/createMessage"}\n');
    f.stdout.write('{"jsonrpc":"2.0","id":999,"result":{}}\n');
    f.stdout.write('{"jsonrpc":"2.0","id":"unknown","result":{}}\n');
    abort.abort();
    await pending;
    expect(f.requests).toContainEqual(
      expect.objectContaining({ method: "notifications/cancelled" }),
    );
    await client.close();
    await expect(client.listTools(new AbortController().signal)).rejects.toThrow("closed");
  });

  it.each([
    { tools: "invalid" },
    { tools: [null] },
    { tools: [], nextCursor: 2 },
    { tools: [], nextCursor: "repeated" },
    { tools: Array.from({ length: 129 }, () => ({ name: "browser_navigate", inputSchema: {} })) },
  ])("rejects malformed or unbounded catalogs", async (catalog) => {
    const f = fixture((message) =>
      message.method === "initialize"
        ? { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {} }
        : catalog,
    );
    const client = await f.start();
    await expect(client.listTools(new AbortController().signal)).rejects.toThrow();
    await client.close();
  });

  it("reads paginated catalogs and rejects malformed call results", async () => {
    const f = fixture((message) =>
      message.method === "initialize"
        ? { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {} }
        : message.method === "tools/list"
          ? { tools: [], ...(message.params?.cursor ? {} : { nextCursor: "page2" }) }
          : message.params?.name === "browser_close"
            ? { content: [] }
            : {},
    );
    const client = await f.start();
    expect(await client.listTools(new AbortController().signal)).toEqual([]);
    await expect(client.call("browser_snapshot", {}, new AbortController().signal)).rejects.toThrow(
      "Invalid Playwright tool result",
    );
    await client.close();
  });
});
