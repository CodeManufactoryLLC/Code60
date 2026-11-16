import { describe, expect, it } from "vitest";
import {
  parseAction,
  parseModelDefaultAction,
  parseModelDefaults,
  parseOrchestrationChatAction,
} from "./index.js";

const item = { configId: "model", value: "m1", name: "Model One" };
describe("model default boundary", () => {
  it("accepts bounded provider-role selections and fixed run-only save actions", () => {
    expect(
      parseModelDefaults({ version: 1, providers: { claude: { worker: [item] } } }).providers.claude
        ?.worker,
    ).toEqual([item]);
    const save = { type: "save-model-default", id: "r1" };
    expect(parseAction(save)).toEqual(save);
    expect(parseOrchestrationChatAction(save)).toEqual(save);
    const clear = { type: "clear", provider: "claude", role: "worker" };
    expect(parseModelDefaultAction(clear)).toEqual(clear);
    for (const extra of [{ values: [item] }, { provider: "claude" }, { cwd: "/tmp" }]) {
      expect(() => parseAction({ ...save, ...extra })).toThrow();
      expect(() => parseOrchestrationChatAction({ ...save, ...extra })).toThrow();
    }
  });
  it("rejects unknown providers, roles, versions, oversized and duplicate selections", () => {
    for (const value of [
      { version: 2, providers: {} },
      { version: 1, providers: { other: { worker: [item] } } },
      { version: 1, providers: { claude: { helper: [item] } } },
      { version: 1, providers: { claude: { worker: [] } } },
      { version: 1, providers: { claude: { worker: [item, item] } } },
      {
        version: 1,
        providers: {
          claude: { worker: Array.from({ length: 33 }, (_, i) => ({ ...item, configId: `${i}` })) },
        },
      },
      { version: 1, providers: { claude: { worker: [{ ...item, value: "x".repeat(257) }] } } },
      { version: 1, providers: { claude: { worker: [{ ...item, command: "no" }] } } },
    ])
      expect(() => parseModelDefaults(value)).toThrow();
    expect(() =>
      parseModelDefaultAction({ type: "clear", provider: "other", role: "worker" }),
    ).toThrow();
    expect(() =>
      parseModelDefaultAction({ type: "clear", provider: "claude", role: "helper" }),
    ).toThrow();
  });
});
