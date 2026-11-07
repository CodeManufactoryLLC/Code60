import { z } from "zod";
import {
  emptySessionState,
  modeControlSchema,
  type SessionState,
  sessionStateSchema,
  sessionValueSchema,
} from "../contracts/index.js";

const label = z.string().min(1).max(1024);
const option = z.object({ value: sessionValueSchema, name: label });
const select = z.object({
  id: sessionValueSchema,
  name: label,
  category: z.enum(["model", "mode"]),
  type: z.literal("select"),
  currentValue: sessionValueSchema,
  options: z.union([
    z.array(option).max(512),
    z
      .array(
        z.object({ group: sessionValueSchema, name: label, options: z.array(option).max(512) }),
      )
      .max(32),
  ]),
});
const legacy = z.object({
  currentModeId: sessionValueSchema,
  availableModes: z
    .array(z.object({ id: sessionValueSchema, name: label }))
    .max(512)
    .refine((modes) => new Set(modes.map((mode) => mode.id)).size === modes.length),
});
const usage = sessionStateSchema.shape.usage.unwrap().omit({ reportedAt: true });

/** Only normalized, bounded protocol fields become display/control state. */
export class SessionStateTracker {
  state: SessionState = emptySessionState();
  private configPreferred = false;

  constructor(private readonly now = () => new Date().toISOString()) {}

  setup(response: { configOptions?: unknown; modes?: unknown }): void {
    // Supplied setup configuration takes precedence over early updates. Optional
    // absent v1 fields do not discard state already advertised by notification.
    if (response.configOptions != null) {
      this.configPreferred = true;
      this.state = { ...this.state, model: null, modes: null };
      this.config(response.configOptions);
    } else if (!this.configPreferred) {
      const result = legacy.safeParse(response.modes);
      if (result.success)
        this.state = {
          ...this.state,
          modes: {
            source: "legacy",
            confirmed: true,
            reportedAt: this.now(),
            controls: [
              {
                id: "mode",
                name: "Mode",
                currentValue: result.data.currentModeId,
                options: result.data.availableModes.map((mode) => ({
                  value: mode.id,
                  name: mode.name,
                })),
              },
            ],
          },
        };
    }
  }

  update(update: { sessionUpdate: string; [key: string]: unknown }): void {
    if (update.sessionUpdate === "config_option_update") this.config(update.configOptions);
    if (update.sessionUpdate === "usage_update") {
      const result = usage.safeParse(update);
      if (
        result.success &&
        (this.state.usage?.used !== result.data.used || this.state.usage?.size !== result.data.size)
      ) {
        this.state = { ...this.state, usage: { ...result.data, reportedAt: this.now() } };
      }
    }
    if (
      update.sessionUpdate === "current_mode_update" &&
      !this.configPreferred &&
      this.state.modes
    ) {
      const result = sessionValueSchema.safeParse(update.currentModeId);
      if (result.success) this.confirmLegacy(result.data);
    }
  }

  confirmLegacy(value: string): void {
    const modes = this.state.modes;
    if (modes?.source !== "legacy") return;
    if (modes.confirmed && modes.controls[0]?.currentValue === value) return;
    this.state = {
      ...this.state,
      modes: {
        ...modes,
        confirmed: true,
        reportedAt: this.now(),
        controls: modes.controls.map((control) => ({ ...control, currentValue: value })),
      },
    };
  }

  unconfirmed(): void {
    if (this.state.modes)
      this.state = {
        ...this.state,
        modes: { ...this.state.modes, confirmed: false },
      };
  }

  config(value: unknown): void {
    if (!Array.isArray(value) || value.length > 128 || JSON.stringify(value).length > 256 * 1024)
      return;
    this.configPreferred = true;
    const controls = value.flatMap((item) => {
      const parsed = select.safeParse(item);
      if (!parsed.success) return [];
      const { options, ...rest } = parsed.data;
      const normalized = modeControlSchema.safeParse({
        ...rest,
        options: options.flatMap((item) =>
          "options" in item
            ? item.options.map((option) => ({ ...option, group: item.name, groupId: item.group }))
            : [item],
        ),
      });
      return normalized.success ? [{ ...normalized.data, category: rest.category }] : [];
    });
    const unique = controls.filter(
      (control) => controls.filter((item) => item.id === control.id).length === 1,
    );
    const model = unique.find((control) => control.category === "model");
    const nextModel = model
      ? {
          id: model.currentValue,
          name:
            model.options.find((option) => option.value === model.currentValue)?.name ??
            model.currentValue,
        }
      : null;
    const modes = unique
      .filter((control) => control.category === "mode")
      .slice(0, 32)
      .map(({ category: _, ...control }) => control);
    const previous = this.state;
    const sameModel =
      previous.model?.id === nextModel?.id && previous.model?.name === nextModel?.name;
    const sameModes =
      previous.modes?.source === "config" &&
      previous.modes.confirmed &&
      JSON.stringify(previous.modes.controls) === JSON.stringify(modes);
    this.state = {
      ...previous,
      model: sameModel
        ? previous.model
        : nextModel
          ? { ...nextModel, reportedAt: this.now() }
          : null,
      modes:
        modes.length === 0
          ? null
          : sameModes
            ? previous.modes
            : {
                source: "config",
                controls: modes,
                confirmed: true,
                reportedAt: this.now(),
              },
    };
  }
}
