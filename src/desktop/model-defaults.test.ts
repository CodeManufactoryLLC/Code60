import { describe, expect, it, vi } from "vitest";
import type { ModelDefaultsRecord } from "../bridge/index.js";
import type { RunView } from "../core/index.js";
import { ModelDefaults } from "./model-defaults.js";

const at = "2026-11-16T00:00:00.000Z";
const control = (id: string, category: string) => ({
  id,
  category,
  name: id,
  currentValue: id,
  options: [{ value: id, name: `${id} label` }],
});
const run = {
  id: "r1",
  agent: "claude",
  status: "idle",
  stopping: false,
  modeChanging: false,
  sessionState: {
    model: { id: "m", name: "model label", reportedAt: at },
    modes: null,
    usage: null,
    settings: {
      confirmed: true,
      reportedAt: at,
      controls: [
        control("effort", "thought_level"),
        control("model", "model"),
        control("extra", "model_config"),
        control("permissions", "mode"),
        control("other", "other"),
      ],
    },
  },
} as RunView;

describe("application model defaults", () => {
  it("derives confirmed values from the run, serializes concurrent roles and clears without changing sessions", async () => {
    let stored: ModelDefaultsRecord = { version: 1, providers: {} };
    const changed = vi.fn();
    const defaults = new ModelDefaults(
      {
        read: async () => undefined,
        write: async () => {},
        modelDefaults: async () => stored,
        setModelDefaults: async (record) => {
          stored = structuredClone(record);
        },
      },
      changed,
    );
    await defaults.load();
    await Promise.all([defaults.save(run, "worker"), defaults.save(run, "orchestrator")]);
    expect(defaults.selections("claude", "worker").map((c) => c.configId)).toEqual([
      "model",
      "effort",
      "extra",
    ]);
    expect(stored.providers.claude?.orchestrator).toEqual(stored.providers.claude?.worker);
    const copy = defaults.snapshot();
    delete copy.providers.claude;
    expect(defaults.selections("claude", "worker")).toHaveLength(3);
    expect(defaults.selections("codex", "worker")).toEqual([]);
    await defaults.clear({ type: "clear", provider: "claude", role: "worker" });
    expect(defaults.selections("claude", "worker")).toEqual([]);
    expect(defaults.selections("claude", "orchestrator")).toHaveLength(3);
    await defaults.clear({ type: "clear", provider: "claude", role: "orchestrator" });
    expect(stored.providers).toEqual({});
    expect(run.sessionState?.model?.id).toBe("m");
    expect(changed).toHaveBeenCalledTimes(4);
  });
  it("refuses busy, stopped, unconfirmed and unadvertised models and preserves state after failed writes", async () => {
    const write = vi.fn(async () => {
      throw new Error("disk full");
    });
    const defaults = new ModelDefaults(
      {
        read: async () => undefined,
        write: async () => {},
        setModelDefaults: write,
      },
      () => {},
    );
    for (const patch of [
      { status: "running" as const },
      { stopping: true },
      { modeChanging: true },
      { sessionState: undefined },
    ]) {
      await expect(defaults.save({ ...run, ...patch } as RunView, "worker")).rejects.toThrow();
    }
    const unconfirmed = structuredClone(run);
    if (!unconfirmed.sessionState?.settings) throw new Error("Missing settings");
    unconfirmed.sessionState.settings.confirmed = false;
    await expect(defaults.save(unconfirmed, "worker")).rejects.toThrow(/confirmed/);
    await expect(defaults.save(run, "worker")).rejects.toThrow(/disk full/);
    expect(defaults.snapshot().providers).toEqual({});
    const missing = new ModelDefaults(
      { read: async () => undefined, write: async () => {} },
      () => {},
    );
    await expect(missing.save(run, "worker")).rejects.toThrow(/cannot be saved/);
  });
});
