import { expect, it, vi } from "vitest";
import { createHostLanController } from "../scripts/devcontainer-lan.mjs";

const client = "00000000-0000-4000-8000-000000000001";
const request = (id, method, targetPort) => ({
  type: "request",
  client,
  id,
  method,
  ...(targetPort === undefined ? {} : { targetPort }),
});
it("allows only fixed control messages and pins the host address/port and target to the owned client", async () => {
  const close = vi.fn(async () => {});
  const forwardLan = vi.fn(async () => close);
  const controller = createHostLanController("/root", "container", 43160, {
    address: async () => "192.168.0.16",
    forwardLan,
  });
  try {
    expect(await controller.handle(request(0, "address"))).toMatchObject({
      address: "192.168.0.16",
    });
    expect(await controller.handle(request(1, "publish", 40000))).toMatchObject({
      address: "192.168.0.16",
    });
    expect(forwardLan.mock.calls[0].slice(0, 5)).toEqual([
      "/root",
      "container",
      "192.168.0.16",
      43160,
      40000,
    ]);
    await expect(controller.handle({ ...request(2, "address"), command: "sh" })).rejects.toThrow(
      "fields",
    );
    await expect(controller.handle(request(2, "shell"))).rejects.toThrow("request");
    await expect(controller.handle(request(2, "publish", 0))).rejects.toThrow("request");
    expect(
      await controller.handle({
        ...request(3, "publish", 40001),
        client: "00000000-0000-4000-8000-000000000002",
      }),
    ).toHaveProperty("error");
    await controller.handle({ type: "disconnect", client });
    expect(close).toHaveBeenCalledOnce();
  } finally {
    await controller.close();
  }
});
it("expires an unrenewed lease", async () => {
  const close = vi.fn(async () => {});
  const controller = createHostLanController("/root", "container", 43160, {
    address: async () => "192.168.0.16",
    forwardLan: async () => close,
    leaseMs: 10,
    leaseCheckMs: 5,
  });
  try {
    await controller.handle(request(0, "publish", 40000));
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(await controller.handle(request(1, "heartbeat"))).toHaveProperty("error");
  } finally {
    await controller.close();
  }
});
it("withdraws a publication that finishes after its backend disconnects", async () => {
  let finish;
  const close = vi.fn(async () => {});
  const forwardLan = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const controller = createHostLanController("/root", "container", 43160, {
    address: async () => "192.168.0.16",
    forwardLan,
  });
  try {
    const publication = controller.handle(request(0, "publish", 40000));
    await vi.waitFor(() => expect(forwardLan).toHaveBeenCalledOnce());
    const disconnected = controller.handle({ type: "disconnect", client });
    finish(close);
    expect(await publication).toHaveProperty("error");
    await disconnected;
    expect(close).toHaveBeenCalledOnce();
  } finally {
    await controller.close();
  }
});
it("never publishes a public address", async () => {
  const forwardLan = vi.fn();
  const controller = createHostLanController("/root", "container", 43160, {
    address: async () => "8.8.8.8",
    forwardLan,
  });
  try {
    expect(await controller.handle(request(0, "publish", 40000))).toHaveProperty("error");
    expect(forwardLan).not.toHaveBeenCalled();
  } finally {
    await controller.close();
  }
});
