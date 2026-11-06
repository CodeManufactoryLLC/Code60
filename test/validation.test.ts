import { expect, it, vi } from "vitest";

it("constructs and uses IPC schemas without probing or generating JavaScript", async () => {
  vi.resetModules();
  const codeGeneration = vi.spyOn(globalThis, "Function").mockImplementation(() => {
    throw new EvalError("Code generation is disabled by CSP");
  });
  try {
    const { parseAction, parseRunSettings } = await import("../src/bridge/index.js");
    expect(parseAction({ type: "finish", id: "r1" })).toEqual({ type: "finish", id: "r1" });
    expect(
      parseRunSettings({ agents: ["claude"], allow: [], allowAll: false, turnTimeout: "1h30m" })
        .turnTimeout,
    ).toBe("1h30m");
    expect(codeGeneration).not.toHaveBeenCalled();
  } finally {
    codeGeneration.mockRestore();
  }
});

it("uses the same duration rules for CLI config and saved desktop settings", async () => {
  const { parseConfig, parseDuration } = await import("../src/core/config.js");
  const { parseRunSettings } = await import("../src/bridge/index.js");
  const settings = { agents: ["claude"], allow: [], allowAll: false };
  for (const duration of ["1h30m", " 500ms ", "1s0ms", "9007199254740991ms"]) {
    expect(parseConfig({ turnTimeout: duration }).turnTimeout).toBe(duration);
    expect(parseRunSettings({ ...settings, turnTimeout: duration }).turnTimeout).toBe(duration);
    expect(parseDuration(duration)).toBeGreaterThan(0);
  }
  for (const duration of ["0s", "-1h", "1.5h", "30", "9007199254740992ms", `${"9".repeat(200)}h`]) {
    expect(() => parseConfig({ turnTimeout: duration })).toThrow();
    expect(() => parseRunSettings({ ...settings, turnTimeout: duration })).toThrow();
    expect(() => parseDuration(duration)).toThrow();
  }
});

it("validates multi-chat actions without accepting paths or unrecognized fields", async () => {
  const { parseOrchestrationChatAction } = await import("../src/bridge/index.js");
  expect(parseOrchestrationChatAction({ type: "new" })).toEqual({ type: "new" });
  expect(parseOrchestrationChatAction({ type: "select", id: "chat-1" })).toEqual({
    type: "select",
    id: "chat-1",
  });
  for (const action of [
    { type: "new", directory: "/tmp/chat" },
    { type: "new", id: "chat-1" },
    { type: "select", id: null },
    { type: "select", id: "../outside" },
    { type: "select", id: "chat-1", command: ["bad"] },
  ])
    expect(() => parseOrchestrationChatAction(action)).toThrow();
});
