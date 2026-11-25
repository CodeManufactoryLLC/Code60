import { afterEach, expect, it, vi } from "vitest";
import { applicationOperations } from "../src/gateway/operations.js";
import { createBrowserClient } from "../src/renderer/browser-client.js";

// Contract tests replace native preload wiring checks: exercise the actual browser
// adapter against the gateway's fixed operation surface without starting runtimes.
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function transport() {
  vi.useFakeTimers();
  vi.stubGlobal("window", {});
  const writes: { operation: string; id: string }[] = [];
  const requests: RequestInit[] = [];
  let fail = false;
  const fetch = vi.fn(async (path: string, options: RequestInit) => {
    requests.push(options);
    if (path === "/api/events") {
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode('data: {"sequence":1,"event":"resync"}\n\n'),
            );
            options.signal?.addEventListener("abort", () => controller.error(new Error("closed")), {
              once: true,
            });
          },
        }),
      );
    }
    expect(path).toBe("/api/operation");
    writes.push(JSON.parse(String(options.body)));
    if (fail) throw new Error("connection lost after dispatch");
    return new Response("null", { headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetch);
  const client = createBrowserClient(
    { token: "a".repeat(64), generation: 7, version: 1, controlling: true },
    () => {},
    async () => false,
  );
  return {
    client,
    writes,
    requests,
    fail: () => {
      fail = true;
    },
  };
}
it("routes every application method through an authenticated known gateway operation", async () => {
  const { client, writes, requests } = transport();
  try {
    await client.ready;
    const methods = Object.entries(client.api).filter(
      ([name]) => !name.startsWith("on") && name !== "openWebLink",
    );
    for (const [, method] of methods) await (method as () => unknown)();
    const operations = applicationOperations(
      ...([{}, {}, {}, {}, () => {}, {}] as unknown as Parameters<typeof applicationOperations>),
    );
    // Listener policy belongs to the gateway rather than ApplicationHost.
    const networkOperations = new Set([
      "web-server-status",
      "web-server-enabled",
      "web-server-code",
    ]);
    expect(writes.length).toBeGreaterThan(60);
    for (const request of writes) {
      expect(
        operations.has(request.operation) || networkOperations.has(request.operation),
        request.operation,
      ).toBe(true);
      expect(request.id).toMatch(/^[a-f0-9-]{36}$/);
    }
    expect(new Set(writes.map((request) => request.id)).size).toBe(writes.length);
    for (const request of requests) {
      expect(request).toMatchObject({
        mode: "same-origin",
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
      });
      expect(request.headers).toMatchObject({
        "X-Code60-Session": "a".repeat(64),
        "X-Code60-Generation": "7",
      });
      expect((request.headers as Record<string, string>)["X-Code60-Client"]).toMatch(
        /^[a-f0-9-]{36}$/,
      );
    }
  } finally {
    client.stop();
  }
});
it("does not retry a consequential operation when its transport result is uncertain", async () => {
  const fixture = transport();
  try {
    await fixture.client.ready;
    fixture.fail();
    await expect(
      fixture.client.api.start({ agents: ["fixture"], allow: [], allowAll: false }),
    ).rejects.toThrow("connection lost after dispatch");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fixture.writes.filter((request) => request.operation === "start")).toHaveLength(1);
  } finally {
    fixture.client.stop();
  }
});
