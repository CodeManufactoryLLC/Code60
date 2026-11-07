import { describe, expect, it } from "vitest";
import { supportsModeChange } from "../contracts/index.js";
import { SessionStateTracker } from "./session-state.js";

const at = "2026-11-07T12:00:00.000Z";
const mode = {
  id: "permissions",
  name: "Permissions",
  category: "mode",
  type: "select",
  currentValue: "ask",
  options: [
    { value: "ask", name: "Ask for approval" },
    { value: "full", name: "Full Access" },
  ],
};
const model = {
  ...mode,
  id: "model",
  category: "model",
  currentValue: "m1",
  options: [
    { group: "recommended", name: "Recommended", options: [{ value: "m1", name: "Model One" }] },
  ],
};
const modes = { currentModeId: "legacy", availableModes: [{ id: "legacy", name: "Legacy" }] };

describe("ACP session state", () => {
  it("prefers categorized config, preserves groups, and never infers unrelated controls", () => {
    const tracker = new SessionStateTracker(() => at);
    tracker.setup({
      configOptions: [model, mode, { ...mode, id: "other", category: undefined }],
      modes,
    });
    expect(tracker.state.model).toEqual({ id: "m1", name: "Model One", reportedAt: at });
    expect(tracker.state.modes?.controls).toHaveLength(1);
    expect(
      supportsModeChange(tracker.state, {
        source: "config",
        configId: "permissions",
        value: "full",
      }),
    ).toBe(true);
    expect(
      supportsModeChange(tracker.state, {
        source: "legacy",
        configId: "permissions",
        value: "full",
      }),
    ).toBe(false);
    tracker.update({ sessionUpdate: "current_mode_update", currentModeId: "legacy" });
    expect(tracker.state.modes?.controls[0]?.currentValue).toBe("ask");
    tracker.update({
      sessionUpdate: "config_option_update",
      configOptions: [{ ...mode, options: model.options, currentValue: "m1" }],
    });
    expect(tracker.state.modes?.controls[0]?.options[0]).toEqual({
      value: "m1",
      name: "Model One",
      group: "Recommended",
      groupId: "recommended",
    });
    expect(tracker.state.model).toBeNull();
  });

  it("uses legacy modes only when config is absent, and clears removed options", () => {
    const tracker = new SessionStateTracker(() => at);
    tracker.setup({ modes });
    expect(tracker.state.modes?.source).toBe("legacy");
    tracker.unconfirmed();
    expect(tracker.state.modes?.confirmed).toBe(false);
    tracker.update({ sessionUpdate: "current_mode_update", currentModeId: "legacy" });
    expect(tracker.state.modes?.confirmed).toBe(true);
    tracker.setup({ configOptions: [], modes });
    expect(tracker.state.modes).toBeNull();
    tracker.setup({ configOptions: [mode] });
    tracker.update({ sessionUpdate: "config_option_update", configOptions: [] });
    expect(tracker.state.modes).toBeNull();
  });

  it("deduplicates reports, permits compaction/zero capacity, and ignores invalid usage", () => {
    const tracker = new SessionStateTracker(() => at);
    tracker.update({ sessionUpdate: "usage_update", used: 150, size: 200, cost: { amount: 999 } });
    const first = tracker.state;
    tracker.update({ sessionUpdate: "usage_update", used: 150, size: 200 });
    expect(tracker.state).toBe(first);
    for (const used of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, "20"]) {
      tracker.update({ sessionUpdate: "usage_update", used, size: 200 });
      expect(tracker.state).toBe(first);
    }
    tracker.update({ sessionUpdate: "usage_update", used: 20, size: 200 });
    expect(tracker.state.usage).toEqual({ used: 20, size: 200, reportedAt: at });
    tracker.update({ sessionUpdate: "usage_update", used: 0, size: 0 });
    expect(tracker.state.usage?.size).toBe(0);
    tracker.setup({});
    expect(tracker.state.usage?.used).toBe(0);
  });

  it("falls back to the model ID and ignores malformed/unsupported config", () => {
    const tracker = new SessionStateTracker(() => at);
    tracker.setup({
      configOptions: [
        { ...model, currentValue: "unknown" },
        { ...mode, type: "boolean" },
        { ...mode, id: "x".repeat(257) },
      ],
    });
    expect(tracker.state.model?.name).toBe("unknown");
    expect(tracker.state.modes).toBeNull();
    tracker.setup({ configOptions: [mode] });
    const previous = tracker.state;
    tracker.update({ sessionUpdate: "config_option_update", configOptions: [mode] });
    expect(tracker.state).toEqual(previous);
  });
});
