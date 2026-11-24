import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, expect, it } from "vitest";
import { guardedFetch, networkAddressClass, registerPrivateListener } from "./network-policy.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
});
async function server(handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const instance = createServer(handler);
  await new Promise<void>((resolve) => instance.listen(0, "127.0.0.1", resolve));
  const address = instance.address();
  if (!address || typeof address === "string") throw new Error();
  const origin = `http://127.0.0.1:${address.port}`;
  cleanups.push(async () => {
    instance.closeAllConnections();
    await new Promise<void>((resolve) => instance.close(() => resolve()));
  });
  return { instance, origin, port: address.port };
}
it.each([
  "169.254.169.254",
  "100.100.100.200",
  "0.0.0.0",
  "224.0.0.1",
  "255.255.255.255",
  "fe80::1",
  "ff02::1",
  "fd00:ec2::254",
  "::ffff:169.254.169.254",
  "::ffff:a9fe:a9fe",
  "64:ff9b::a9fe:a9fe",
])("blocks metadata/link-local/multicast/transition destination %s", (address) =>
  expect(networkAddressClass(address)).toBe("blocked"),
);
it("requires explicit origin approval for loopback and LAN, even with a public DNS name", async () => {
  let calls = 0;
  const endpoint = await server((_request, response) => {
    calls++;
    response.end("safe");
  });
  await expect(guardedFetch()(endpoint.origin)).rejects.toThrow("approval");
  expect(calls).toBe(0);
  expect(
    await (await guardedFetch({ privateOrigins: [endpoint.origin] })(endpoint.origin)).text(),
  ).toBe("safe");
  expect(calls).toBe(1);
  expect(networkAddressClass("10.1.2.3")).toBe("private");
  expect(networkAddressClass("fc00::1")).toBe("private");
  expect(networkAddressClass("8.8.8.8")).toBe("public");
});
it("rejects application listeners even when configured or reached through DNS", async () => {
  let calls = 0;
  const endpoint = await server((_request, response) => {
    calls++;
    response.end();
  });
  const unregister = registerPrivateListener(endpoint.port);
  try {
    await expect(
      guardedFetch({ privateOrigins: [endpoint.origin] })(endpoint.origin),
    ).rejects.toThrow();
    expect(calls).toBe(0);
  } finally {
    unregister();
  }
  expect((await guardedFetch({ privateOrigins: [endpoint.origin] })(endpoint.origin)).status).toBe(
    200,
  );
});
it("pins the vetted DNS result into the socket and preserves the original host", async () => {
  let host = "";
  const endpoint = await server((request, response) => {
    host = request.headers.host ?? "";
    response.end("pinned");
  });
  const origin = `http://synthetic.invalid:${endpoint.port}`;
  const lookup = async () => [{ address: "127.0.0.1", family: 4 }];
  const response = await guardedFetch({ privateOrigins: [origin], lookup })(origin);
  expect(await response.text()).toBe("pinned");
  expect(host).toBe(`synthetic.invalid:${endpoint.port}`);
  await expect(guardedFetch({ lookup })(origin)).rejects.toThrow("approval");
});
it("never follows a credential-bearing redirect or replays an uncertain POST", async () => {
  let redirected = 0,
    posts = 0;
  const target = await server((_request, response) => {
    redirected++;
    response.end();
  });
  const source = await server((request, response) => {
    if (request.method === "POST") {
      posts++;
      request.socket.destroy();
    } else {
      response.writeHead(302, { Location: target.origin });
      response.end();
    }
  });
  const request = guardedFetch({ privateOrigins: [source.origin, target.origin], redirects: 3 });
  await expect(
    request(source.origin, { headers: { Authorization: "Bearer synthetic" } }),
  ).rejects.toThrow("redirect");
  expect(redirected).toBe(0);
  await expect(request(source.origin, { method: "POST", body: "synthetic" })).rejects.toThrow(
    "uncertain",
  );
  expect(posts).toBe(1);
  expect((await request(source.origin)).status).toBe(200);
  expect(redirected).toBe(1);
});
it("bounds response bodies and aborts sockets without reflecting server content", async () => {
  const endpoint = await server((_request, response) =>
    response.end("sensitive-synthetic".repeat(1000)),
  );
  const response = await guardedFetch({ privateOrigins: [endpoint.origin], maximumBytes: 128 })(
    endpoint.origin,
  );
  await expect(response.text()).rejects.toThrow();
  const delayed = await server(() => {});
  await expect(
    guardedFetch({ privateOrigins: [delayed.origin], timeoutMs: 20 })(delayed.origin),
  ).rejects.toThrow("uncertain");
});
it("requires HTTPS for credentials outside loopback and rejects URL user information", async () => {
  const lookup = async () => [{ address: "192.168.1.10", family: 4 }];
  const request = guardedFetch({ privateOrigins: ["http://lan.invalid"], lookup });
  await expect(
    request("http://lan.invalid", { headers: { Authorization: "Bearer synthetic" } }),
  ).rejects.toThrow("HTTPS");
  await expect(request("http://user:synthetic@lan.invalid")).rejects.toThrow("rejected");
});
