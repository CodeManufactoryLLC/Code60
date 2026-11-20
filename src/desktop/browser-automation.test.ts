import { describe, expect, it, vi } from "vitest";
import { BrowserAutomation } from "./browser-automation.js";
import type { BrowserClient, startBrowserClient } from "./browser-client.js";

function fixture() {
  const client = {
    listTools: vi.fn<BrowserClient["listTools"]>(async () => [
      { name: "browser_navigate", inputSchema: { type: "object" } },
    ]),
    call: vi.fn<BrowserClient["call"]>(async () => ({
      content: [{ type: "image", data: "cG5n", mimeType: "image/png" }],
    })),
    close: vi.fn(async () => {}),
  } satisfies BrowserClient;
  const connect = vi.fn<typeof startBrowserClient>(async () => client);
  const browser = new BrowserAutomation("/private/chat", {}, connect);
  return { browser, client, connect };
}
const navigation = {
  action: "call",
  name: "browser_navigate",
  arguments: { url: "https://example.com" },
};
function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}

describe("conversation browser ownership", () => {
  it("rejects browser output outside its own workspace without dispatching the call", async () => {
    const { browser, client } = fixture();
    client.listTools.mockResolvedValueOnce([{ name: "browser_take_screenshot", inputSchema: {} }]);
    await expect(
      browser.call({
        action: "call",
        name: "browser_take_screenshot",
        arguments: { filename: "/tmp/another-owner.png" },
      }),
    ).rejects.toThrow("conversation's workspace");
    expect(client.call).not.toHaveBeenCalled();
    expect(client.close).toHaveBeenCalledOnce();
  });
  it("reports dead upstream connections and reconnects only on a fresh explicit action", async () => {
    const { browser, client, connect } = fixture();
    let connected = true;
    Object.assign(client, { connected: () => connected });
    await browser.call(navigation);
    connected = false;
    expect(await browser.call({ action: "status" })).toEqual({
      mode: "headless",
      connected: false,
    });
    expect(connect).toHaveBeenCalledOnce();
    connect.mockImplementationOnce(async () => {
      connected = true;
      return client;
    });
    await browser.call(navigation);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(client.call).toHaveBeenCalledTimes(2);
    await browser.shutdown();
  });
  it("starts lazily, defaults to headless, discovers tools and preserves rich results", async () => {
    const { browser, client, connect } = fixture();
    expect(await browser.call({ action: "status" })).toEqual({
      mode: "headless",
      connected: false,
    });
    expect(connect).not.toHaveBeenCalled();
    expect(await browser.call(navigation)).toMatchObject({
      mode: "headless",
      result: { content: [{ type: "image", data: "cG5n" }] },
    });
    expect(connect).toHaveBeenCalledWith("headless", "/private/chat", {}, expect.any(AbortSignal));
    expect(await browser.call({ action: "list-tools" })).toMatchObject({
      mode: "headless",
      tools: [{ name: "browser_navigate" }],
    });
    expect(connect).toHaveBeenCalledOnce();
    await browser.shutdown();
    expect(client.close).toHaveBeenCalledOnce();
    await expect(browser.call({ action: "status" })).rejects.toThrow("ended");
  });

  it("keeps modes independent, switches after closing and never launches on selection", async () => {
    const { browser, client, connect } = fixture();
    const other = fixture();
    await browser.call({ action: "set-mode", mode: "visible" });
    expect(connect).not.toHaveBeenCalled();
    await browser.call(navigation);
    await browser.call({ action: "set-mode", mode: "visible" });
    expect(client.close).not.toHaveBeenCalled();
    await browser.call({ action: "set-mode", mode: "existing-browser" });
    expect(client.close).toHaveBeenCalledOnce();
    await browser.call(navigation);
    expect(connect.mock.calls.map((args) => args[0])).toEqual(["visible", "existing-browser"]);
    expect(await other.browser.call({ action: "status" })).toMatchObject({ mode: "headless" });
    await browser.call({ action: "close" });
    expect(await browser.call({ action: "status" })).toEqual({
      mode: "existing-browser",
      connected: false,
    });
  });

  it("does not change mode or fall back after connection/tool errors", async () => {
    const { browser, client, connect } = fixture();
    await browser.call({ action: "set-mode", mode: "existing-browser" });
    connect.mockRejectedValueOnce(new Error("Extension unavailable"));
    await expect(browser.call(navigation)).rejects.toThrow("Extension unavailable");
    expect(await browser.call({ action: "status" })).toMatchObject({
      mode: "existing-browser",
      connected: false,
    });
    await expect(browser.call({ ...navigation, name: "browser_snapshot" })).rejects.toThrow(
      "Unknown Playwright tool",
    );
    expect(client.call).not.toHaveBeenCalled();
    expect(client.close).toHaveBeenCalledOnce();
    client.call.mockRejectedValueOnce(new Error("Lost connection"));
    await expect(browser.call(navigation)).rejects.toThrow("Lost connection");
    expect(connect.mock.calls.every((args) => args[0] === "existing-browser")).toBe(true);
    expect(await browser.call({ action: "status" })).toMatchObject({ connected: false });
  });

  it("retains the previous mode and ownership if closing fails, then permits cleanup retry", async () => {
    const { browser, client } = fixture();
    await browser.call(navigation);
    client.close.mockRejectedValueOnce(new Error("Could not stop"));
    await expect(browser.call({ action: "set-mode", mode: "visible" })).rejects.toThrow(
      "Could not stop",
    );
    expect(await browser.call({ action: "status" })).toEqual({ mode: "headless", connected: true });
    await browser.shutdown();
    expect(client.close).toHaveBeenCalledTimes(2);
  });

  it("rejects overlapping work and cancels pending calls before releasing the process", async () => {
    const { browser, client } = fixture();
    const started = deferred();
    client.call.mockImplementationOnce(async (_name, _args, signal) => {
      started.resolve();
      await new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(new Error("Cancelled")), { once: true }),
      );
      return { content: [] };
    });
    const pending = browser.call(navigation);
    const rejected = expect(pending).rejects.toThrow("Cancelled");
    await started.promise;
    await expect(browser.call({ action: "set-mode", mode: "visible" })).rejects.toThrow("finish");
    const cancel = browser.cancel();
    await expect(browser.call({ action: "status" })).rejects.toThrow("closing");
    await Promise.all([cancel, browser.cancel(), rejected]);
    expect(client.close).toHaveBeenCalledOnce();
    expect(await browser.call({ action: "status" })).toMatchObject({ connected: false });
  });

  it("cancels startup without leaking the client that resolves afterwards", async () => {
    const { client } = fixture();
    const started = deferred();
    const connect = vi.fn<typeof startBrowserClient>(async (_mode, _dir, _env, signal) => {
      started.resolve();
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );
      return client;
    });
    const browser = new BrowserAutomation("/private/chat", {}, connect);
    const pending = expect(browser.call(navigation)).rejects.toThrow();
    await started.promise;
    await browser.shutdown();
    await pending;
    expect(client.close).toHaveBeenCalledOnce();
    expect(client.call).not.toHaveBeenCalled();
  });
});
