import { describe, expect, it } from "vitest";
import { browserModes, parseBrowserRequest } from "./index.js";

describe("browser requests", () => {
  it("accepts only the fixed modes and action-specific fields", () => {
    for (const mode of browserModes)
      expect(parseBrowserRequest({ action: "set-mode", mode })).toEqual({
        action: "set-mode",
        mode,
      });
    expect(
      parseBrowserRequest({
        action: "call",
        name: "browser_navigate",
        arguments: { url: "https://example.com" },
      }),
    ).toMatchObject({ action: "call" });
    for (const value of [
      null,
      {},
      { action: "set-mode" },
      { action: "set-mode", mode: "desktop" },
      { action: "status", mode: "visible" },
      { action: "close", command: "node" },
      { action: "call", name: "exec", arguments: {} },
      { action: "call", name: "browser_run_code_unsafe", arguments: { code: "process.exit(1)" } },
      { action: "call", name: "browser_navigate", arguments: [] },
      { action: "call", name: "browser_navigate", arguments: {}, env: {} },
    ])
      expect(() => parseBrowserRequest(value)).toThrow("Invalid browser request");
  });
});
