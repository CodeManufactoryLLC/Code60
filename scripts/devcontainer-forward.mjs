import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";

export async function runContainerDevelopment(root, container, options = {}) {
  options.signal?.throwIfAborted();
  const { createHostLanController } = await import("./devcontainer-lan.mjs");
  const lan = createHostLanController(root, container, options.gatewayPort, options);
  try {
    await new Promise((ready, reject) => {
      const child = (options.spawn ?? spawn)(
        "docker",
        ["exec", "-i", container, "node", join(root, "scripts/devcontainer-session.mjs")],
        { stdio: ["pipe", "pipe", "inherit"] },
      );
      let deadline;
      let escalation;
      let protocolError = false;
      const stop = () => {
        void lan.close().then(
          () => {
            if (!child.stdin.destroyed && !child.stdin.writableEnded)
              child.stdin.write(`${JSON.stringify({ type: "stop" })}\n`);
          },
          () => child.stdin.end(),
        );
        deadline ??= setTimeout(() => {
          child.kill("SIGTERM");
          escalation = setTimeout(() => child.kill("SIGKILL"), 5000);
        }, 40_000);
      };
      let buffer = "";
      child.stdout?.on("data", (bytes) => {
        buffer += bytes.toString("utf8");
        if (Buffer.byteLength(buffer) > 16_384) {
          protocolError = true;
          stop();
          return;
        }
        while (buffer.includes("\n")) {
          const end = buffer.indexOf("\n");
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          try {
            const value = JSON.parse(line);
            void lan.handle(value).then(
              (result) => {
                if (result && !child.stdin.destroyed && !child.stdin.writableEnded)
                  child.stdin.write(`${JSON.stringify(result)}\n`);
              },
              () => {
                protocolError = true;
                stop();
              },
            );
          } catch {
            protocolError = true;
            stop();
            return;
          }
        }
      });
      const clear = () => {
        clearTimeout(deadline);
        clearTimeout(escalation);
        options.signal?.removeEventListener("abort", stop);
      };
      child.stdin.on("error", () => {});
      child.once("error", (error) => {
        clear();
        reject(error);
      });
      child.once("close", (code) => {
        clear();
        if (
          !protocolError &&
          (code === 0 || (options.signal?.aborted && [130, 143].includes(code)))
        )
          ready();
        else reject(new Error(`Container development failed (${code}).`));
      });
      options.signal?.addEventListener("abort", stop, { once: true });
      if (options.signal?.aborted) stop();
    });
  } finally {
    await lan.close();
  }
  options.signal?.throwIfAborted();
}

// Docker exec carries raw TCP over stdio, so HTTP streams and HMR WebSockets
// retain their original Host/Origin without any published container ports.
async function forwardEntries(root, container, entries, options = {}) {
  const servers = [];
  const connections = new Set();
  const children = new Set();
  let closing;
  const close = () => {
    closing ??= (async () => {
      const closed = servers.map((server) => new Promise((done) => server.close(done)));
      for (const socket of connections) socket.destroy();
      await Promise.all([...children].map((stop) => stop()));
      await Promise.all(closed);
      options.signal?.removeEventListener("abort", close);
    })();
    return closing;
  };
  try {
    for (const { host, port, target, privateOnly } of entries) {
      options.signal?.throwIfAborted();
      const server = createServer({ allowHalfOpen: true }, (socket) => {
        if (
          closing ||
          (options.budget?.active ?? connections.size) >= 64 ||
          (privateOnly && !privateIPv4(socket.remoteAddress ?? ""))
        )
          return socket.destroy();
        if (options.budget) options.budget.active++;
        connections.add(socket);
        socket.on("error", () => socket.destroy());
        const child = (options.spawn ?? spawn)(
          "docker",
          [
            "exec",
            "-i",
            container,
            "node",
            join(root, "scripts/devcontainer-tunnel.mjs"),
            String(target),
          ],
          { stdio: ["pipe", "pipe", "ignore"] },
        );
        let exited = false;
        let stopping;
        let finish;
        const done = new Promise((resolve) => {
          finish = resolve;
        });
        const stop = () => {
          stopping ??= (async () => {
            child.stdin.destroy();
            if (!exited) {
              child.kill("SIGTERM");
              const force = setTimeout(() => child.kill("SIGKILL"), 5000);
              try {
                await done;
              } finally {
                clearTimeout(force);
              }
            }
          })();
          return stopping;
        };
        children.add(stop);
        const ended = () => {
          exited = true;
          finish();
          socket.destroy();
          children.delete(stop);
        };
        child.once("error", ended);
        child.once("close", ended);
        child.stdin.on("error", () => socket.destroy());
        child.stdout.on("error", () => socket.destroy());
        socket.once("close", () => {
          connections.delete(socket);
          if (options.budget) options.budget.active--;
          void stop();
        });
        socket.pipe(child.stdin);
        child.stdout.pipe(socket);
      });
      servers.push(server);
      await new Promise((ready, reject) => {
        server.once("error", reject);
        server.listen(port, host, ready);
      });
    }
    options.signal?.addEventListener("abort", close, { once: true });
    options.signal?.throwIfAborted();
    return close;
  } catch (error) {
    await close();
    throw error;
  }
}

export function privateIPv4(value) {
  const address = value.replace(/^::ffff:/, "");
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(address)) return false;
  const parts = address.split(".").map(Number);
  if (parts.some((part) => part < 0 || part > 255) || parts.join(".") !== address) return false;
  return (
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}
export function forwardContainerPorts(root, container, pair, options = {}) {
  return forwardEntries(
    root,
    container,
    [pair.gateway, pair.vite].map((port) => ({
      host: "127.0.0.1",
      port,
      target: port,
      privateOnly: false,
    })),
    options,
  );
}
export function forwardContainerLan(root, container, address, port, target, options = {}) {
  if (!privateIPv4(address)) throw new Error("Expected a private LAN address.");
  return forwardEntries(
    root,
    container,
    [{ host: address, port, target, privateOnly: true }],
    options,
  );
}
