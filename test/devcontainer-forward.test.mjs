import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer as httpServer } from "node:http";
import { createConnection, createServer } from "node:net";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { forwardContainerPorts } from "../scripts/devcontainer-forward.mjs";

const cleanup = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function listen(server) {
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });
  cleanup.push(() => new Promise((done) => server.close(done)));
  return server.address().port;
}
async function freePort() {
  const server = createServer();
  const port = await listen(server);
  await new Promise((done) => server.close(done));
  return port;
}
async function forwarded(target) {
  const pair = { gateway: await freePort(), vite: await freePort() };
  const children = [];
  const launch = vi.fn((_file, args, options) => {
    expect(args.slice(0, 4)).toEqual(["exec", "-i", "owned-container", "node"]);
    const child = spawn(process.execPath, [args[4], String(target)], options);
    children.push(child);
    return child;
  });
  const abort = new AbortController();
  const close = await forwardContainerPorts(resolve("."), "owned-container", pair, {
    spawn: launch,
    signal: abort.signal,
  });
  cleanup.push(close);
  return { pair, children, launch, close, abort };
}

it("preserves HTTP headers and streaming bytes through both loopback forwards", async () => {
  const server = httpServer((request, response) => {
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "X-Received-Origin": request.headers.origin,
      "X-Received-Host": request.headers.host,
    });
    response.write("data: first\n\n");
    request.on("data", (bytes) => response.write(bytes));
    request.on("end", () => response.end("data: last\n\n"));
  });
  const target = await listen(server);
  const { pair } = await forwarded(target);
  for (const port of Object.values(pair)) {
    const response = await fetch(`http://127.0.0.1:${port}`, {
      method: "POST",
      body: "data: middle\n\n",
      headers: { Origin: "http://127.0.0.1:43160" },
      signal: AbortSignal.timeout(5000),
    });
    expect(response.headers.get("X-Received-Origin")).toBe("http://127.0.0.1:43160");
    expect(response.headers.get("X-Received-Host")).toBe(`127.0.0.1:${port}`);
    expect(await response.text()).toBe("data: first\n\ndata: middle\n\ndata: last\n\n");
  }
});

it("carries bidirectional long-lived bytes and abort releases both listeners and children", async () => {
  const sockets = new Set();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.pipe(socket);
  });
  const target = await listen(server);
  const dev = await forwarded(target);
  const socket = createConnection({ host: "127.0.0.1", port: dev.pair.vite });
  socket.on("error", () => {});
  cleanup.push(() => {
    for (const upstream of sockets) upstream.destroy();
    socket.destroy();
  });
  const received = once(socket, "data");
  socket.write(Buffer.from([0, 255, 128, 10]));
  expect((await received)[0]).toEqual(Buffer.from([0, 255, 128, 10]));
  const closed = once(socket, "close");
  dev.abort.abort();
  await dev.close();
  await closed;
  await vi.waitFor(() =>
    expect(
      dev.children.every((child) => child.exitCode !== null || child.signalCode !== null),
    ).toBe(true),
  );
  for (const port of Object.values(dev.pair)) {
    const probe = createServer();
    await new Promise((done, reject) => {
      probe.once("error", reject);
      probe.listen(port, "127.0.0.1", done);
    });
    await new Promise((done) => probe.close(done));
  }
});

it("releases the first port if the second port is occupied", async () => {
  const vite = await listen(createServer());
  const gateway = await freePort();
  await expect(forwardContainerPorts(resolve("."), "unused", { gateway, vite })).rejects.toThrow(
    /EADDRINUSE/,
  );
  const server = createServer();
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(gateway, "127.0.0.1", done);
  });
  await new Promise((done) => server.close(done));
});

it("allows a response after the client half-closes its request", async () => {
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    socket.resume();
    socket.once("end", () => socket.end("response after request"));
  });
  const { pair } = await forwarded(await listen(server));
  const socket = createConnection({ host: "127.0.0.1", port: pair.gateway });
  const data = once(socket, "data");
  socket.end("request");
  expect((await data)[0].toString()).toBe("response after request");
});

it("closes client connections when the tunnel cannot launch or connect", async () => {
  const { pair } = await forwarded(await freePort());
  const socket = createConnection({ host: "127.0.0.1", port: pair.gateway });
  socket.on("error", () => {});
  await once(socket, "close");
});
