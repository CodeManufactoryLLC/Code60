import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";

export async function runContainerDevelopment(root, container, options = {}) {
  options.signal?.throwIfAborted();
  await new Promise((ready, reject) => {
    const child = (options.spawn ?? spawn)(
      "docker",
      ["exec", "-i", container, "node", join(root, "scripts/devcontainer-session.mjs")],
      { stdio: ["pipe", "inherit", "inherit"] },
    );
    let deadline;
    let escalation;
    const stop = () => {
      child.stdin.end();
      deadline ??= setTimeout(() => {
        child.kill("SIGTERM");
        escalation = setTimeout(() => child.kill("SIGKILL"), 5000);
      }, 40_000);
    };
    const clear = () => {
      clearTimeout(deadline);
      clearTimeout(escalation);
      options.signal?.removeEventListener("abort", stop);
    };
    child.stdin.on("error", () => {}); // close/error below reports a lost exec connection.
    child.once("error", (error) => {
      clear();
      reject(error);
    });
    child.once("close", (code) => {
      clear();
      if (code === 0) ready();
      else reject(new Error(`Container development failed (${code}).`));
    });
    options.signal?.addEventListener("abort", stop, { once: true });
    if (options.signal?.aborted) stop();
  });
  options.signal?.throwIfAborted();
}

// Docker exec carries raw TCP over stdio, so HTTP streams and HMR WebSockets
// retain their original Host/Origin without any published container ports.
export async function forwardContainerPorts(root, container, pair, options = {}) {
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
    for (const port of [pair.gateway, pair.vite]) {
      options.signal?.throwIfAborted();
      const server = createServer({ allowHalfOpen: true }, (socket) => {
        if (closing || connections.size >= 64) return socket.destroy();
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
            String(port),
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
          void stop();
        });
        socket.pipe(child.stdin);
        child.stdout.pipe(socket);
      });
      servers.push(server);
      await new Promise((ready, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", ready);
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
