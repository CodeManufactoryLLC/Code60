import { lstat } from "node:fs/promises";
import { createConnection, type Socket } from "node:net";
import { dirname } from "node:path";
import { z } from "zod";
import { isPrivateIPv4, verifyPrivatePath } from "../platform/index.js";
import type { LanPublisher } from "./web-server.js";

const response = z.strictObject({
  id: z.number().int().nonnegative(),
  address: z.string().nullable().optional(),
  error: z.string().max(200).optional(),
});
/** Private dev-session socket, injected by the owned launcher, never by a browser. */
export function createLanPublisher(
  path: string,
  options: { requestMs?: number; heartbeatMs?: number } = {},
): LanPublisher {
  let socket: Socket | undefined;
  let connecting: Promise<Socket> | undefined;
  let closed = false;
  let sequence = 0;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const lost = new Set<() => void>();
  const pending = new Map<
    number,
    {
      resolve(value: string | null): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const fail = () => {
    const previous = socket;
    socket = undefined;
    clearInterval(heartbeat);
    for (const call of pending.values()) {
      clearTimeout(call.timer);
      call.reject(new Error("Container LAN control is unavailable."));
    }
    pending.clear();
    previous?.destroy();
    if (previous && !closed) for (const listener of lost) listener();
  };
  const connect = async (): Promise<Socket> => {
    if (closed) throw new Error("LAN control is closed.");
    if (socket && !socket.destroyed) return socket;
    connecting ??= (async () => {
      await verifyPrivatePath(dirname(path), true);
      const entry = await lstat(path);
      if (!entry.isSocket() || entry.uid !== process.getuid?.() || (entry.mode & 0o077) !== 0)
        throw new Error("Unsafe LAN control socket.");
      const channel = createConnection(path);
      channel.on("error", () => {});
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          channel.destroy();
          reject(new Error("LAN control timed out."));
        }, options.requestMs ?? 10_000);
        channel.once("connect", () => {
          clearTimeout(timer);
          resolve();
        });
        channel.once("error", () => {
          clearTimeout(timer);
          reject(new Error("LAN control is unavailable."));
        });
      });
      if (closed) {
        channel.destroy();
        throw new Error("LAN control is closed.");
      }
      socket = channel;
      let buffer = "";
      channel.on("data", (bytes: Buffer) => {
        buffer += bytes.toString("utf8");
        if (Buffer.byteLength(buffer) > 16_384) {
          fail();
          return;
        }
        while (buffer.includes("\n")) {
          const end = buffer.indexOf("\n");
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          try {
            const message = response.parse(JSON.parse(line));
            const call = pending.get(message.id);
            if (!call) continue;
            pending.delete(message.id);
            clearTimeout(call.timer);
            if (message.error || (message.address && !isPrivateIPv4(message.address)))
              call.reject(new Error("Container LAN forwarding failed."));
            else call.resolve(message.address ?? null);
          } catch {
            fail();
            return;
          }
        }
      });
      channel.once("close", () => {
        if (socket === channel) fail();
      });
      return channel;
    })().finally(() => {
      connecting = undefined;
    });
    return connecting;
  };
  const request = async (
    method: "address" | "publish" | "withdraw" | "heartbeat",
    targetPort?: number,
  ): Promise<string | null> => {
    const channel = await connect();
    if (pending.size >= 16) throw new Error("LAN control is busy.");
    const id = sequence++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("LAN control timed out."));
        fail();
      }, options.requestMs ?? 10_000);
      pending.set(id, { resolve, reject, timer });
      channel.write(
        `${JSON.stringify({ id, method, ...(targetPort === undefined ? {} : { targetPort }) })}\n`,
        (error) => {
          if (error) fail();
        },
      );
    });
  };
  return {
    address: () => request("address"),
    async publish(targetPort) {
      const address = await request("publish", targetPort);
      if (!address) throw new Error("LAN address unavailable.");
      clearInterval(heartbeat);
      heartbeat = setInterval(() => {
        void request("heartbeat").catch(fail);
      }, options.heartbeatMs ?? 5_000);
      heartbeat.unref();
      return address;
    },
    async withdraw() {
      clearInterval(heartbeat);
      await request("withdraw");
    },
    onLost(listener) {
      lost.add(listener);
      return () => lost.delete(listener);
    },
    async close() {
      closed = true;
      clearInterval(heartbeat);
      fail();
      await connecting?.catch(() => {});
    },
  };
}
