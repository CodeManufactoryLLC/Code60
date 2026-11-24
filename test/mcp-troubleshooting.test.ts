import { describe, expect, it } from "vitest";
import { connectMcpUpstream } from "../src/agents/index.js";
import { mcpFailure, mcpFailureGuidance } from "../src/contracts/index.js";
import { guardedFetch } from "../src/platform/index.js";

const definition = {
  label: "private",
  enabled: false,
  type: "http" as const,
  url: "https://private.invalid/mcp",
  headers: {},
  auth: { type: "none" as const },
};
const fallback = { code: "protocol", stage: "initialize" } as const;
describe("safe production MCP transport failures (supporting SDK integration)", () => {
  it.each([
    ["ENOTFOUND", "network"],
    ["ECONNREFUSED", "network"],
    ["CERT_HAS_EXPIRED", "tls"],
    ["ERR_TLS_CERT_ALTNAME_INVALID", "tls"],
    ["ETIMEDOUT", "timeout"],
    ["PRIVATE_UNKNOWN", "protocol"],
  ] as const)(
    "classifies structured %s without parsing or exposing upstream output",
    async (code, expected) => {
      const fetch = async () => {
        throw Object.assign(new TypeError("PRIVATE_PAYLOAD"), {
          cause: Object.assign(new Error("PRIVATE_ENDPOINT"), { code }),
        });
      };
      const error = await connectMcpUpstream({
        definition,
        cwd: "/private",
        environment: {},
        headers: {},
        signal: new AbortController().signal,
        fetch: fetch as typeof globalThis.fetch,
      }).catch((error: unknown) => error);
      expect(mcpFailure(error, fallback)).toEqual({ code: expected, stage: "initialize" });
      expect(mcpFailureGuidance(mcpFailure(error, fallback))).not.toMatch(
        /PRIVATE_|private.invalid|\/private/,
      );
    },
  );
  it.each([
    [401, "authentication"],
    [403, "scope"],
    [500, "protocol"],
  ] as const)("classifies HTTP %s while discarding its sensitive body", async (status, code) => {
    const fetch = async () => new Response("PRIVATE_SERVER_ERROR", { status });
    const error = await connectMcpUpstream({
      definition,
      cwd: "/private",
      environment: {},
      headers: {},
      signal: new AbortController().signal,
      fetch: fetch as typeof globalThis.fetch,
    }).catch((error: unknown) => error);
    expect(mcpFailure(error, fallback)).toEqual({ code, stage: "initialize" });
    expect(String(error)).not.toContain("PRIVATE_SERVER_ERROR");
  });
  it("distinguishes already cancelled setup from an expired deadline without a network request", async () => {
    let requests = 0;
    const fetch = async () => {
      requests++;
      throw new Error("must not call");
    };
    for (const [reason, expected] of [
      [new DOMException("private cancellation", "AbortError"), "cancelled"],
      [new DOMException("private deadline", "TimeoutError"), "timeout"],
    ] as const) {
      const controller = new AbortController();
      controller.abort(reason);
      const error = await connectMcpUpstream({
        definition,
        cwd: "/private",
        environment: {},
        headers: {},
        signal: controller.signal,
        fetch: fetch as typeof globalThis.fetch,
      }).catch((error: unknown) => error);
      expect(mcpFailure(error, fallback).code).toBe(expected);
    }
    expect(requests).toBe(0);
  });
  it.each([
    ["CERT_HAS_EXPIRED", "tls"],
    ["ENOTFOUND", "network"],
    ["PRIVATE_UNKNOWN", "network"],
  ] as const)(
    "preserves only safe native %s metadata through the actual guarded network policy",
    async (code, expected) => {
      const network = guardedFetch({
        lookup: async () => {
          throw Object.assign(new Error("PRIVATE_NETWORK_PAYLOAD"), { code });
        },
      });
      const error = await connectMcpUpstream({
        definition,
        cwd: "/private",
        environment: {},
        headers: {},
        signal: new AbortController().signal,
        fetch: network,
      }).catch((error: unknown) => error);
      expect(mcpFailure(error, fallback)).toEqual({ code: expected, stage: "initialize" });
      expect(String(error)).not.toMatch(/PRIVATE_NETWORK_PAYLOAD|PRIVATE_UNKNOWN|private.invalid/);
    },
  );
});
