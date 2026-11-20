import { PassThrough, Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { MCP_PROTOCOL_VERSION } from "../bridge/index.js";
import type { OwnedProcess } from "../platform/index.js";
import { browserArguments, startBrowserClient } from "./browser-client.js";

type Message = { id: number; method: string; params?: Record<string, unknown> };
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
        if (message.id !== undefined) {
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
  const spawn = vi.fn(async () => child);
  const start = (signal = new AbortController().signal) =>
    startBrowserClient(
      "headless",
      "/private/chat",
      {
        PATH: "/bin",
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
  it("uses fixed launch arguments and strips ambient Playwright overrides", async () => {
    expect(browserArguments("headless")).toEqual([
      "-y",
      "@playwright/mcp@0.0.84",
      "--isolated",
      "--headless",
    ]);
    expect(browserArguments("visible")).toEqual(["-y", "@playwright/mcp@0.0.84", "--isolated"]);
    expect(browserArguments("existing-browser")).toEqual([
      "-y",
      "@playwright/mcp@0.0.84",
      "--extension",
    ]);
    const f = fixture();
    const client = await f.start();
    expect(f.spawn).toHaveBeenCalledWith(
      ["npx", ...browserArguments("headless")],
      "/private/chat",
      { PATH: "/bin" },
    );
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
      startBrowserClient("visible", "/private/chat", {}, new AbortController().signal, async () => {
        throw new Error("private secret");
      }),
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
    { tools: [{ name: "exec", inputSchema: {} }] },
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
