import { createSocket } from "node:dgram";
import { isIP } from "node:net";
import { networkInterfaces } from "node:os";

export function isPrivateIPv4(value: string): boolean {
  const address = value.replace(/^::ffff:/, "");
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split(".").map(Number);
  return (
    a === 10 || (a === 172 && b !== undefined && b >= 16 && b <= 31) || (a === 192 && b === 168)
  );
}

/** Ask the routing table for the default source address; no datagram is sent. */
export async function primaryPrivateIPv4(): Promise<string | null> {
  return new Promise((resolve) => {
    const socket = createSocket("udp4");
    let finished = false;
    const finish = (address: string | null) => {
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
    const timer = setTimeout(() => finish(null), 1_000);
    socket.once("error", () => finish(null));
    socket.connect(9, "192.0.2.1", () => {
      if (finished) return;
      const address = socket.address().address;
      const local = Object.values(networkInterfaces())
        .flat()
        .some((entry) => entry?.address === address && !entry.internal);
      finish(local && isPrivateIPv4(address) ? address : null);
    });
  });
}
