import { expect, it, vi } from "vitest";
import type { CoreDeps } from "../core/index.js";
import { MemoryService } from "./memory-service.js";

it("sizes advanced IPC requests without rounding bigint target identities", async () => {
  const service = new MemoryService("/unused", "/unused", {} as CoreDeps, () => null);
  const args = [
    "conversation",
    "query",
    [{ cwd: "/target", device: 1n, inode: 9007199254740993n }],
  ];
  const send = vi.fn((_message, callback) => callback(new Error("Test transport failure")));
  Reflect.set(service, "child", { connected: true, send });
  const request = Reflect.get(service, "request").bind(service);
  await expect(request("search", args)).rejects.toThrow("could not be sent");
  expect(send.mock.calls[0]?.[0].args).toEqual(args);
  await expect(request("search", ["x".repeat(256001)])).rejects.toThrow("limit");
  expect(send).toHaveBeenCalledTimes(1);
});
