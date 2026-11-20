import { z } from "zod";

// Re-exports are evaluated before index.ts; disable Zod code generation here too.
z.config({ jitless: true });

export const sessionValueSchema = z.string().min(1).max(256);
const label = z.string().min(1).max(1024);
const reportedAt = z.string().datetime();
export const modeChangeSchema = z.strictObject({
  source: z.enum(["config", "legacy"]),
  configId: sessionValueSchema,
  value: sessionValueSchema,
});
export type ModeChange = z.infer<typeof modeChangeSchema>;

export const modeControlSchema = z.object({
  id: sessionValueSchema,
  name: label,
  currentValue: sessionValueSchema,
  options: z
    .array(
      z.object({
        value: sessionValueSchema,
        name: label,
        group: label.optional(),
        groupId: sessionValueSchema.optional(),
      }),
    )
    .max(512)
    .refine(
      (options) => new Set(options.map((option) => option.value)).size === options.length,
      "Duplicate mode value",
    ),
});
/** A non-mode select control, such as model or reasoning. Categories are optional UX hints. */
const settingControlSchema = modeControlSchema.extend({
  category: sessionValueSchema.optional(),
});

/** Categories whose confirmed values may be saved as a role default for new sessions. */
const DEFAULTABLE_CATEGORIES: readonly string[] = ["model", "thought_level", "model_config"];

export const sessionStateSchema = z.object({
  model: z.object({ id: sessionValueSchema, name: label, reportedAt }).nullable(),
  usage: z
    .object({
      used: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      reportedAt,
    })
    .nullable(),
  modes: z
    .object({
      source: z.enum(["config", "legacy"]),
      controls: z
        .array(modeControlSchema)
        .max(32)
        .refine(
          (controls) => new Set(controls.map((control) => control.id)).size === controls.length,
          "Duplicate mode control",
        ),
      confirmed: z.boolean(),
      reportedAt,
    })
    .nullable(),
  /** Absent in records written before session settings were retained. */
  settings: z
    .object({
      controls: z
        .array(settingControlSchema)
        .max(32)
        .refine(
          (controls) => new Set(controls.map((control) => control.id)).size === controls.length,
          "Duplicate session setting",
        ),
      confirmed: z.boolean(),
      reportedAt,
    })
    .nullable()
    .optional(),
});
export type SessionState = z.infer<typeof sessionStateSchema>;

export function emptySessionState(): SessionState {
  return { model: null, usage: null, modes: null };
}

const offers = (
  controls: readonly { id: string; options: readonly { value: string }[] }[],
  change: ModeChange,
) =>
  controls.some(
    (control) =>
      control.id === change.configId &&
      control.options.some((option) => option.value === change.value),
  );

/** True when the change names a currently advertised mode or session-setting choice. */
export function supportsModeChange(state: SessionState, change: ModeChange): boolean {
  if (state.modes?.source === change.source && offers(state.modes.controls, change)) return true;
  return change.source === "config" && !!state.settings && offers(state.settings.controls, change);
}

/** Confirmed defaultable values, model first so dependent reasoning choices apply afterwards. */
export function defaultableSelections(
  state: SessionState | undefined,
): { configId: string; value: string; name: string; category: string }[] {
  const settings = state?.settings;
  if (!settings?.confirmed) return [];
  return settings.controls
    .filter((control) => DEFAULTABLE_CATEGORIES.includes(control.category ?? ""))
    .sort((a, b) => Number(b.category === "model") - Number(a.category === "model"))
    .flatMap((control) => {
      const option = control.options.find((item) => item.value === control.currentValue);
      return option
        ? [
            {
              configId: control.id,
              value: option.value,
              name: option.name,
              category: control.category as string,
            },
          ]
        : [];
    });
}
