import { expect, it } from "vitest";
import { isPrivateIPv4, primaryPrivateIPv4 } from "./lan-address.js";

it("accepts only private IPv4 network addresses", () => {
  for (const address of [
    "192.168.0.16",
    "10.0.0.1",
    "172.16.1.2",
    "172.31.255.254",
    "::ffff:192.168.0.16",
  ])
    expect(isPrivateIPv4(address)).toBe(true);
  for (const address of [
    "127.0.0.1",
    "0.0.0.0",
    "8.8.8.8",
    "172.32.0.1",
    "172.15.1.2",
    "192.168.999.1",
    "192.168.0.016",
    "::1",
    "169.254.0.5",
  ])
    expect(isPrivateIPv4(address)).toBe(false);
});
it("returns an owned private default-route address or unavailable without sending a datagram", async () => {
  const address = await primaryPrivateIPv4();
  expect(address === null || isPrivateIPv4(address)).toBe(true);
});
