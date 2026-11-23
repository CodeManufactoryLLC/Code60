import { createServer } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { type LanPublisher, WebServerBeta } from "./web-server.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
function fixture() {
  let address: string | null = "192.168.10.20";
  const publisher: LanPublisher = {
    address: vi.fn(async () => address),
    publish: vi.fn(async () => address ?? ""),
    withdraw: vi.fn(async () => {}),
    onLost: vi.fn(() => () => {}),
    close: vi.fn(async () => {}),
  };
  const save = vi.fn(async (_enabled: boolean) => {});
  const revoke = vi.fn(async () => {});
  const server = new WebServerBeta({
    port: 43160,
    server: () => createServer((_, response) => response.end("owned")),
    save,
    revoke,
    publisher,
    intervalMs: 60_000,
  });
  cleanup.push(() => server.close());
  return {
    server,
    publisher,
    save,
    revoke,
    address: (next: string | null) => {
      address = next;
    },
  };
}
it("defaults off, activates only after publication and saves only the preference", async () => {
  const f = fixture();
  await f.server.start(false);
  expect(f.publisher.publish).not.toHaveBeenCalled();
  expect(f.server.status()).toMatchObject({ enabled: false, state: "disabled", canManage: false });
  await f.server.set(true);
  expect(f.server.status(true)).toEqual({
    enabled: true,
    state: "listening",
    url: "http://192.168.10.20:43160",
    error: null,
    canManage: true,
  });
  expect(f.save).toHaveBeenCalledWith(true);
  await f.server.set(false);
  expect(f.save).toHaveBeenLastCalledWith(false);
  expect(f.server.status().state).toBe("disabled");
  expect(f.revoke).toHaveBeenCalled();
});
it("retains startup preference, replaces changed addresses and withdraws missing networks", async () => {
  const f = fixture();
  await f.server.start(true);
  expect(f.save).not.toHaveBeenCalled();
  f.address("10.0.0.5");
  await f.server.checkNetwork();
  expect(f.server.status().url).toBe("http://10.0.0.5:43160");
  f.address(null);
  await expect(f.server.checkNetwork()).rejects.toThrow("unavailable");
  expect(f.server.status()).toMatchObject({ enabled: true, state: "unavailable", url: null });
  f.address("10.0.0.8");
  await f.server.checkNetwork();
  expect(f.server.status().url).toBe("http://10.0.0.8:43160");
});
it("rolls back failed enable and reports cleanup failure without claiming disabled", async () => {
  const f = fixture();
  await f.server.start(false);
  vi.mocked(f.publisher.publish).mockRejectedValueOnce(new Error("private provider error"));
  await expect(f.server.set(true)).rejects.toThrow("unavailable");
  expect(f.server.status()).toMatchObject({ enabled: false, state: "unavailable", url: null });
  expect(JSON.stringify(f.server.status())).not.toContain("private provider");
  await f.server.set(true);
  vi.mocked(f.publisher.withdraw).mockRejectedValueOnce(new Error("cleanup"));
  await expect(f.server.set(false)).rejects.toThrow("cleanup");
  expect(f.server.status()).toMatchObject({ enabled: false, state: "unavailable", url: null });
  await f.server.set(false);
  expect(f.server.status().state).toBe("disabled");
});
it("rejects public addresses and unsupported container execution", async () => {
  const f = fixture();
  f.address("8.8.8.8");
  await expect(f.server.set(true)).rejects.toThrow("unavailable");
  expect(f.publisher.publish).not.toHaveBeenCalled();
  const server = new WebServerBeta({
    port: 1,
    server: () => createServer(),
    save: async () => {},
    revoke: async () => {},
    unsupported: true,
  });
  cleanup.push(() => server.close());
  await server.start(true);
  expect(server.status().error).toContain("devcontainer -- start");
});
it("does not republish after losing the host controller until an explicit retry", async () => {
  const f = fixture();
  await f.server.start(true);
  vi.mocked(f.publisher.address).mockRejectedValueOnce(new Error("control lost"));
  await f.server.checkNetwork();
  expect(f.server.status()).toMatchObject({ enabled: true, state: "unavailable" });
  await f.server.checkNetwork();
  expect(f.publisher.publish).toHaveBeenCalledOnce();
  await f.server.set(true);
  expect(f.server.status().state).toBe("listening");
});
it("reports an occupied native port without falling back or saving an enabled preference", async () => {
  const ingress = createServer();
  const listen = vi.spyOn(ingress, "listen").mockImplementation(() => {
    queueMicrotask(() =>
      ingress.emit(
        "error",
        Object.assign(new Error("private bind detail"), { code: "EADDRINUSE" }),
      ),
    );
    return ingress;
  });
  const save = vi.fn(async () => {});
  const server = new WebServerBeta({
    port: 43160,
    address: async () => "192.168.10.20",
    server: () => ingress,
    save,
    revoke: async () => {},
  });
  cleanup.push(() => server.close());
  await server.start(false);
  await expect(server.set(true)).rejects.toThrow("unavailable");
  expect(listen).toHaveBeenCalledExactlyOnceWith(43160, "192.168.10.20", expect.any(Function));
  expect(save).not.toHaveBeenCalled();
  expect(server.status()).toMatchObject({ enabled: false, state: "unavailable", url: null });
  expect(JSON.stringify(server.status())).not.toContain("private bind detail");
});
