import { createSocket } from "node:dgram";
import { networkInterfaces } from "node:os";
import { forwardContainerLan, privateIPv4 } from "./devcontainer-forward.mjs";

function hostLanAddress() {
  return new Promise((resolve) => {
    const socket = createSocket("udp4");
    let finished = false;
    const finish = (address) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* No open datagram handle. */
      }
      resolve(address);
    };
    const timer = setTimeout(() => finish(null), 1000);
    socket.once("error", () => finish(null));
    socket.connect(9, "192.0.2.1", () => {
      if (finished) return;
      const address = socket.address().address;
      const owned = Object.values(networkInterfaces())
        .flat()
        .some((entry) => entry?.address === address && !entry.internal);
      finish(owned && privateIPv4(address) ? address : null);
    });
  });
}
export function createHostLanController(root, container, port, options = {}) {
  let closeForward;
  let owner;
  let epoch = 0;
  let closed = false;
  let lease = 0;
  const now = options.now ?? (() => performance.now());
  let pending = Promise.resolve();
  const withdraw = async () => {
    if (closeForward) {
      await closeForward();
      closeForward = undefined;
    }
  };
  const serial = (action) => {
    const next = pending.then(action);
    pending = next.catch(() => {});
    return next;
  };
  const timer = setInterval(() => {
    if (closeForward && now() > lease) {
      epoch++;
      void serial(withdraw).catch(() => {});
    }
  }, options.leaseCheckMs ?? 1000);
  timer.unref();
  return {
    async handle(frame) {
      if (
        !frame ||
        typeof frame !== "object" ||
        Array.isArray(frame) ||
        !/^[a-f0-9-]{36}$/.test(frame.client) ||
        !["request", "disconnect"].includes(frame.type)
      )
        throw new Error("Invalid LAN control frame.");
      const allowed =
        frame.type === "request"
          ? ["type", "client", "id", "method", "targetPort"]
          : ["type", "client"];
      if (Object.keys(frame).some((key) => !allowed.includes(key)))
        throw new Error("Invalid LAN control fields.");
      if (frame.type === "disconnect") {
        if (frame.client === owner) {
          owner = undefined;
          epoch++;
          await serial(withdraw);
        }
        return null;
      }
      if (
        !Number.isSafeInteger(frame.id) ||
        frame.id < 0 ||
        !["address", "publish", "withdraw", "heartbeat"].includes(frame.method) ||
        (frame.method === "publish"
          ? !Number.isInteger(frame.targetPort) || frame.targetPort < 1 || frame.targetPort > 65535
          : frame.targetPort !== undefined)
      )
        throw new Error("Invalid LAN control request.");
      if (closed && frame.method === "withdraw") {
        await serial(withdraw);
        return { client: frame.client, id: frame.id };
      }
      if (closed || (owner && owner !== frame.client))
        return { client: frame.client, id: frame.id, error: "LAN controller unavailable." };
      owner ??= frame.client;
      const generation = epoch;
      return serial(async () => {
        try {
          if (closed || generation !== epoch || owner !== frame.client)
            throw new Error("Stale LAN controller.");
          let address;
          if (frame.method === "address" || frame.method === "publish")
            address = await (options.address ?? hostLanAddress)();
          if (frame.method === "publish") {
            if (
              !Number.isInteger(port) ||
              port < 1 ||
              port > 65535 ||
              !address ||
              !privateIPv4(address)
            )
              throw new Error("LAN unavailable.");
            await withdraw();
            const close = await (options.forwardLan ?? forwardContainerLan)(
              root,
              container,
              address,
              port,
              frame.targetPort,
              options,
            );
            closeForward = close;
            if (closed || generation !== epoch || owner !== frame.client) {
              await withdraw();
              throw new Error("Stale LAN publication.");
            }
            lease = now() + (options.leaseMs ?? 15_000);
          } else if (frame.method === "withdraw") await withdraw();
          else if (frame.method === "heartbeat") {
            if (!closeForward) throw new Error("LAN lease expired.");
            lease = now() + (options.leaseMs ?? 15_000);
          }
          return {
            client: frame.client,
            id: frame.id,
            ...(address === undefined ? {} : { address }),
          };
        } catch {
          return { client: frame.client, id: frame.id, error: "LAN forwarding is unavailable." };
        }
      });
    },
    async close() {
      closed = true;
      epoch++;
      clearInterval(timer);
      await serial(withdraw);
    },
  };
}
