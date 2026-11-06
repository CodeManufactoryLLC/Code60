import { afterEach, describe, expect, it, vi } from "vitest";
import { createMcpGateway, type McpGateway } from "./mcp-gateway.js";

let gateway: McpGateway | undefined;
afterEach(async () => {
  await gateway?.close();
  gateway = undefined;
});

describe("Code60 private MCP gateway", () => {
  it("authenticates loopback requests and forwards only validated envelopes", async () => {
    const handler = vi.fn(async () => ({ rows: [] }));
    gateway = await createMcpGateway(handler);
    expect(new URL(gateway.url).hostname).toBe("127.0.0.1");
    const call = (token: string, body: unknown) =>
      fetch(gateway?.url as string, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const unauthorized = await call("wrong", { name: "code60_read_sessions", arguments: {} });
    expect(unauthorized.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
    const invalid = await call(gateway.token, { name: "code60_read_sessions", sql: "no" });
    expect(invalid.status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
    const valid = await call(gateway.token, { name: "code60_read_sessions", arguments: {} });
    expect(await valid.json()).toEqual({ result: { rows: [] } });
    expect(handler).toHaveBeenCalledWith("code60_read_sessions", {});
    expect(valid.headers.get("cache-control")).toBe("no-store");
    await gateway.close();
    await expect(call(gateway.token, {})).rejects.toThrow();
  });

  it("returns bounded errors and stops accepting requests after close", async () => {
    gateway = await createMcpGateway(async () => {
      throw new Error("Read failed");
    });
    const response = await fetch(gateway.url, {
      method: "POST",
      headers: { authorization: `Bearer ${gateway.token}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "code60_read_messages", arguments: {} }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Read failed" });
    const missing = await fetch(gateway.url);
    expect(missing.status).toBe(404);
  });
});
