import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Only bounded LAN control frames use stdout/stdin; development output uses stderr.
const directory = await mkdtemp(join(tmpdir(), "code60-lan-session-"));
const path = join(directory, "control.sock");
const clients = new Map();
const write = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const server = createServer((socket) => {
  if (clients.size) {
    socket.destroy();
    return;
  }
  const client = randomUUID();
  clients.set(client, socket);
  socket.on("error", () => socket.destroy());
  let buffer = "";
  let outstanding = 0;
  socket.on("data", (bytes) => {
    buffer += bytes.toString("utf8");
    if (Buffer.byteLength(buffer) > 16_384) {
      socket.destroy();
      return;
    }
    while (buffer.includes("\n")) {
      const end = buffer.indexOf("\n");
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      try {
        const value = JSON.parse(line);
        if (
          !value ||
          typeof value !== "object" ||
          Array.isArray(value) ||
          Object.keys(value).some((key) => !["id", "method", "targetPort"].includes(key)) ||
          ++outstanding > 16
        )
          throw new Error("Invalid control request");
        write({ ...value, type: "request", client });
      } catch {
        socket.destroy();
        return;
      }
    }
  });
  socket.once("close", () => {
    clients.delete(client);
    write({ type: "disconnect", client });
  });
  socket.on("response", () => {
    outstanding = Math.max(0, outstanding - 1);
  });
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(path, resolve);
});
await chmod(path, 0o600);
const child = spawn(process.execPath, ["scripts/dev.mjs"], {
  detached: true,
  env: { ...process.env, CODE60_DEV_LAN_SOCKET: path },
  stdio: ["ignore", "inherit", "inherit"].map((value, index) =>
    index > 0 ? process.stderr : value,
  ),
});
let deadline;
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  if (!child.pid) return;
  child.kill("SIGTERM");
  deadline = setTimeout(() => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") process.exitCode = 1;
    }
  }, 35_000);
};
let buffer = "";
process.stdin.on("data", (bytes) => {
  buffer += bytes.toString("utf8");
  if (Buffer.byteLength(buffer) > 16_384) {
    stop();
    return;
  }
  while (buffer.includes("\n")) {
    const end = buffer.indexOf("\n");
    const line = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    try {
      const value = JSON.parse(line);
      if (value?.type === "stop" && Object.keys(value).length === 1) {
        stop();
        continue;
      }
      if (
        !value ||
        typeof value !== "object" ||
        Object.keys(value).some((key) => !["client", "id", "address", "error"].includes(key))
      )
        throw new Error("Invalid control response");
      const socket = clients.get(value.client);
      if (!socket) continue;
      delete value.client;
      socket.emit("response");
      socket.write(`${JSON.stringify(value)}\n`);
    } catch {
      stop();
      return;
    }
  }
});
process.stdin.once("end", stop);
process.stdin.once("error", stop);
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.once("error", () => {
  process.stderr.write("Could not launch container development.\n");
  process.exitCode = 1;
  stop();
});
child.once("close", (code) => {
  void (async () => {
    clearTimeout(deadline);
    for (const socket of clients.values()) socket.destroy();
    try {
      await new Promise((resolve) => server.close(resolve));
      await rm(directory, { recursive: true, force: true });
      if (!process.exitCode) process.exitCode = code ?? 1;
    } catch {
      process.stderr.write("Could not clean up container development.\n");
      process.exitCode = 1;
    } finally {
      process.stdin.destroy();
    }
  })();
});
