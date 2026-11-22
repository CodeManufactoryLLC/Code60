import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { LocalTransmission } from "./transmission.js";

const roots: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(reply: (op: string) => { status?: number; body: string }) {
  const root = await mkdtemp(join(tmpdir(), "transmission-http-"));
  roots.push(root);
  const state = join(root, "private");
  await mkdir(state, { mode: 0o700 });
  const token = "a".repeat(64);
  const calls: string[] = [];
  const server = createServer((request, response) => {
    expect(request.headers.authorization).toBe(`Bearer ${token}`);
    expect(request.method).toBe("POST");
    calls.push(request.url ?? "");
    const result = reply(request.url ?? "");
    response.writeHead(result.status ?? 200);
    response.end(result.body);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing address");
  await writeFile(join(state, "endpoint.json"), JSON.stringify({ port: address.port, token }), {
    mode: 0o600,
  });
  return { client: new LocalTransmission(state, {}), calls, state };
}
it("uses private authenticated endpoint data and fixed allowed routes", async () => {
  const f = await fixture(() => ({ body: '{"ready":true}' }));
  expect(await f.client.call("health")).toEqual({ ready: true });
  await expect(f.client.call("arbitrary-route")).rejects.toThrow("Unknown");
  expect(f.calls).toEqual(["/health"]);
});
it.each(["remote-error", "malformed", "oversized"])(
  "rejects %s responses without leaking remote errors",
  async (mode) => {
    const f = await fixture(() => ({
      status: mode === "remote-error" ? 400 : 200,
      body:
        mode === "oversized"
          ? "x".repeat(8 * 1024 * 1024 + 1)
          : mode === "malformed"
            ? "not-json"
            : '{"error":"private remote failure"}',
    }));
    await expect(f.client.call("get_workflow", {})).rejects.toThrow(
      mode === "remote-error"
        ? "Transmission rejected"
        : mode === "oversized"
          ? "limit"
          : undefined,
    );
  },
);
it("rejects unsafe endpoint capabilities before networking", async () => {
  const f = await fixture(() => ({ body: "{}" }));
  await writeFile(
    join(f.state, "endpoint.json"),
    JSON.stringify({ port: 12, token: "wrong", url: "https://untrusted" }),
    { mode: 0o600 },
  );
  await expect(f.client.call("health")).rejects.toThrow();
  expect(f.calls).toEqual([]);
});
