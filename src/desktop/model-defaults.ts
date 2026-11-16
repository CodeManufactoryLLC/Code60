import {
  type ModelDefaultRole,
  type ModelDefaultsRecord,
  parseModelDefaultAction,
  parseModelDefaults,
} from "../bridge/index.js";
import { defaultableSelections, type RunView } from "../core/index.js";
import type { DesktopPreferences } from "./preferences.js";

/** Application-owned role defaults. No renderer-supplied selection values are accepted. */
export class ModelDefaults {
  private record: ModelDefaultsRecord = { version: 1, providers: {} };
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly preferences: DesktopPreferences,
    private readonly changed: () => void,
  ) {}
  async load(): Promise<void> {
    this.record = parseModelDefaults((await this.preferences.modelDefaults?.()) ?? this.record);
  }
  snapshot(): ModelDefaultsRecord {
    return structuredClone(this.record);
  }
  selections(provider: string, role: ModelDefaultRole) {
    return structuredClone(
      this.record.providers[provider as keyof typeof this.record.providers]?.[role] ?? [],
    );
  }
  save(run: RunView, role: ModelDefaultRole): Promise<void> {
    if (run.status !== "idle" || run.stopping || run.modeChanging)
      return Promise.reject(
        new Error("Wait for the connected session to be idle before saving a default."),
      );
    const selections = defaultableSelections(run.sessionState);
    if (!selections.some((item) => item.category === "model"))
      return Promise.reject(
        new Error("A confirmed model selection is not advertised by this connector."),
      );
    const values = selections.map(({ configId, value, name }) => ({ configId, value, name }));
    return this.update((record) => {
      const provider = run.agent as keyof typeof record.providers;
      record.providers[provider] = { ...record.providers[provider], [role]: values };
    });
  }
  clear(value: unknown): Promise<void> {
    const action = parseModelDefaultAction(value);
    return this.update((record) => {
      const entry = record.providers[action.provider];
      if (!entry) return;
      delete entry[action.role];
      if (!Object.keys(entry).length) delete record.providers[action.provider];
    });
  }
  private update(change: (record: ModelDefaultsRecord) => void): Promise<void> {
    const result = this.tail.then(async () => {
      if (!this.preferences.setModelDefaults) throw new Error("Model defaults cannot be saved.");
      const record = this.snapshot();
      change(record);
      const parsed = parseModelDefaults(record);
      await this.preferences.setModelDefaults(parsed);
      this.record = parsed;
      this.changed();
    });
    this.tail = result.catch(() => {});
    return result;
  }
}
