import { useId } from "react";
import type { ModeChange, ModeControl, SessionState } from "../core/index.js";

function ModeOptions({ control }: { control: ModeControl }) {
  const groups: { name?: string; id?: string; options: ModeControl["options"] }[] = [];
  for (const option of control.options) {
    const previous = groups.at(-1);
    if (previous && previous.name === option.group && previous.id === option.groupId)
      previous.options.push(option);
    else
      groups.push({
        ...(option.group === undefined ? {} : { name: option.group }),
        ...(option.groupId === undefined ? {} : { id: option.groupId }),
        options: [option],
      });
  }
  return groups.map((group) =>
    group.name === undefined ? (
      group.options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.name}
        </option>
      ))
    ) : (
      <optgroup key={group.options[0]?.value} label={group.name}>
        {group.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.name}
          </option>
        ))}
      </optgroup>
    ),
  );
}

export function contextUsage(usage: SessionState["usage"]): string {
  if (!usage) return "Not reported";
  const tokens = `${usage.used.toLocaleString()} / ${usage.size.toLocaleString()} tokens`;
  return usage.size > 0 ? `${tokens} (${((usage.used / usage.size) * 100).toFixed(1)}%)` : tokens;
}

/** Shared by orchestrator and worker conversations; no provider names imply a model or mode. */
export function SessionInfo({
  state,
  ended,
  editable,
  changing,
  autoApproval,
  onMode,
}: {
  state: SessionState | undefined;
  ended: boolean;
  editable: boolean;
  changing: boolean;
  autoApproval: boolean;
  onMode(change: ModeChange): void;
}) {
  const id = useId();
  const modes = state?.modes;
  return (
    <section className="session-info" aria-label="Session information">
      {ended && <span className="session-last-reported">Last reported</span>}
      <span>Model: {state?.model?.name ?? "Not reported"}</span>
      <span>Context: {contextUsage(state?.usage ?? null)}</span>
      {modes?.controls.length ? (
        modes.controls.map((control, index) => {
          const label =
            modes.controls.length === 1 ? "Harness mode" : `Harness mode: ${control.name}`;
          const current = control.options.find((option) => option.value === control.currentValue);
          return (
            <label key={control.id} htmlFor={`${id}-${index}`}>
              {label}
              {ended ? (
                <span>
                  {modes.confirmed ? (current?.name ?? control.currentValue) : "Unconfirmed"}
                </span>
              ) : (
                <select
                  id={`${id}-${index}`}
                  aria-label={label}
                  value={modes.confirmed ? control.currentValue : ""}
                  disabled={!editable || changing || control.options.length === 0}
                  onChange={(event) =>
                    onMode({
                      source: modes.source,
                      configId: control.id,
                      value: event.target.value,
                    })
                  }
                >
                  {!modes.confirmed && (
                    <option value="" disabled>
                      Unconfirmed
                    </option>
                  )}
                  {modes.confirmed && !current && (
                    <option value={control.currentValue} disabled>
                      {control.currentValue}
                    </option>
                  )}
                  <ModeOptions control={control} />
                </select>
              )}
            </label>
          );
        })
      ) : (
        <span>Harness mode: Not reported</span>
      )}
      {changing && <span role="status">Changing harness mode…</span>}
      {autoApproval && <span className="session-approval">Code60 auto-approval: On</span>}
    </section>
  );
}
