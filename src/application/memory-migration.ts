import { z } from "zod";
import { DEFAULT_MEMORY_SETTINGS, type MemorySettings, parseValue } from "../bridge/index.js";

const types = z.strictObject({
  episodic: z.boolean(),
  semantic: z.boolean(),
  lesson: z.boolean(),
  history: z.boolean(),
});
const legacySettings = z.strictObject({
  enabled: z.boolean(),
  relay: z.boolean(),
  project: z.boolean(),
  worker: z.boolean(),
  continuity: z.boolean(),
  capture: z.boolean(),
  recall: z.boolean(),
  generation: z.boolean(),
  rolloverPercent: z.number().int().min(30).max(85),
  capacity: z.number().int().min(1024).max(2_000_000),
  checkpointTokens: z.number().int().min(128).max(8000),
  recallTokens: z.number().int().min(0).max(16000),
  cadenceSeconds: z.number().int().min(0).max(3600),
  dailyCalls: z.number().int().min(1).max(1000),
  types,
  generateTypes: types,
  retentionDays: z.strictObject({
    episodic: z.number().int().min(0).max(3650),
    semantic: z.number().int().min(0).max(3650),
    lesson: z.number().int().min(0).max(3650),
    history: z.number().int().min(0).max(3650),
  }),
});

/** Only the private v1 store accepts legacy settings; IPC never does. */
export function migrateMemorySettings(
  value: unknown,
  excludedConversation: boolean,
): MemorySettings {
  const old = value === undefined ? undefined : parseValue(legacySettings, value);
  const enabled =
    !excludedConversation &&
    (!old ||
      (old.enabled &&
        old.relay &&
        old.project &&
        old.worker &&
        old.continuity &&
        old.capture &&
        old.recall &&
        old.generation &&
        old.recallTokens > 0 &&
        Object.values(old.types).every(Boolean) &&
        Object.values(old.generateTypes).every(Boolean) &&
        Object.values(old.retentionDays).every((days) => days === 0)));
  return { ...DEFAULT_MEMORY_SETTINGS, enabled };
}
