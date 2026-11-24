import { chmod, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createLanPublisher } from "./lan-publisher.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture(mode = "ok") {
  const directory = await mkdtemp(join(tmpdir(), "code60-lan-rpc-"));
  const path = join(directory, "control.sock");
  const sockets = new Set<import("node:net").Socket>();
  const methods: string[] = [];
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    let buffer = "";
    socket.on("data", (bytes) => {
      buffer += bytes.toString();
      while (buffer.includes("\n")) {
        const end = buffer.indexOf("\n");
        const value = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        methods.push(value.method);
        if (mode === "silent") continue;
        if (mode === "oversize") {
          socket.write("x".repeat(16_385));
          continue;
        }
        socket.write(
          `${JSON.stringify({ id: value.id, ...(value.method === "address" || value.method === "publish" ? { address: mode === "public" ? "8.8.8.8" : "192.168.0.16" } : {}) })}\n`,
        );
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, resolve);
  });
  await chmod(path, 0o600);
  const publisher = createLanPublisher(path, { requestMs: 30, heartbeatMs: 10 });
  cleanup.push(async () => {
    await publisher.close();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  return { publisher, methods, sockets, path };
}
it("uses only bounded private control operations, renews its lease and signals lost ownership", async () => {
  const f = await fixture();
  const lost = vi.fn();
  f.publisher.onLost(lost);
  expect(await f.publisher.address()).toBe("192.168.0.16");
  expect(await f.publisher.publish(43160)).toBe("192.168.0.16");
  await vi.waitFor(() => expect(f.methods).toContain("heartbeat"));
  for (const socket of f.sockets) socket.destroy();
  await vi.waitFor(() => expect(lost).toHaveBeenCalledOnce());
  expect(await f.publisher.address()).toBe("192.168.0.16");
  await f.publisher.withdraw();
});
it.each(["silent", "oversize", "public"])(
  "rejects %s responses without returning arbitrary provider data",
  async (mode) => {
    const f = await fixture(mode);
    await expect(f.publisher.address()).rejects.toThrow(/LAN control|LAN forwarding/);
  },
);
it("rejects unsafe socket permissions before connecting", async () => {
  const f = await fixture();
  await chmod(f.path, 0o666);
  await expect(f.publisher.address()).rejects.toThrow("Unsafe");
  expect(f.methods).toEqual([]);
});
