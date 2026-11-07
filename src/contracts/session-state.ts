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
});
export type SessionState = z.infer<typeof sessionStateSchema>;
export type ModeControl = z.infer<typeof modeControlSchema>;

export function emptySessionState(): SessionState {
  return { model: null, usage: null, modes: null };
}

export function supportsModeChange(state: SessionState, change: ModeChange): boolean {
  return (
    state.modes?.source === change.source &&
    state.modes.controls.some(
      (control) =>
        control.id === change.configId &&
        control.options.some((option) => option.value === change.value),
    )
  );
}
