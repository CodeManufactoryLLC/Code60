import { useId } from "react";
import { SettingsHeader } from "./settings-layout.js";
import {
  defaultTextStyles,
  defaultTypeface,
  fontSizes,
  fontWeights,
  parseTypeface,
  resolveText,
  type TextRole,
  type TextStyle,
  type TextStyles,
  textRoles,
  typefaces,
} from "./typography.js";

const textSamples: Record<TextRole, string> = {
  tableHeadings: "Session|Status|Created",
  buttons: "Send message",
  agentMessages: "I updated the parser and added two regression tests.",
  humanMessages: "Can you add tests for the parser?",
  pageTitles: "Sessions",
  normalText: "Code60 runs coding agents in parallel on one repository.",
};

const textCases = [
  { value: "none", label: "As written", glyph: "Aa" },
  { value: "upper", label: "Uppercase", glyph: "AA" },
  { value: "lower", label: "Lowercase", glyph: "aa" },
] as const;

const isCustomized = (style: TextStyle) =>
  Object.entries(style).some(
    ([key, value]) => value !== undefined && !(key === "case" && value === "none"),
  );

export function TextSettings({
  textStyles,
  onTextStyles,
}: {
  textStyles: TextStyles;
  onTextStyles(styles: TextStyles): void;
}) {
  const id = useId();
  return (
    <section className="settings-section text-settings" aria-labelledby={`${id}-text`}>
      <SettingsHeader id={`${id}-text`} title="Text">
        <button type="button" onClick={() => onTextStyles(structuredClone(defaultTextStyles))}>
          Reset text
        </button>
      </SettingsHeader>
      <div className="text-styles">
        {textRoles.map((role) => {
          const style = textStyles[role.id];
          const resolved = resolveText(textStyles, role.id);
          const update = (patch: TextStyle) =>
            onTextStyles({ ...textStyles, [role.id]: { ...style, ...patch } });
          const caseName = `${id}-${role.id}-case`;
          return (
            <fieldset className="settings-group text-style" key={role.id}>
              <legend className="settings-group-title">{role.label}</legend>
              {isCustomized(style) && (
                <button
                  type="button"
                  className="settings-group-reset"
                  aria-label={`Reset ${role.label}`}
                  onClick={() => onTextStyles({ ...textStyles, [role.id]: {} })}
                >
                  Reset
                </button>
              )}
              <div
                className="text-style-preview"
                data-role={role.css}
                aria-hidden="true"
                style={{
                  fontFamily: resolved.family,
                  fontSize: `${resolved.size}px`,
                  fontWeight: resolved.weight,
                  letterSpacing: resolved.spacing,
                  textTransform:
                    resolved.case === "upper"
                      ? "uppercase"
                      : resolved.case === "lower"
                        ? "lowercase"
                        : "none",
                }}
              >
                {textSamples[role.id].split("|").map((part) => (
                  <span key={part}>{part}</span>
                ))}
              </div>
              <div className="settings-controls">
                <label className="settings-field text-style-typeface">
                  Typeface
                  <select
                    value={style.typeface ?? ""}
                    onChange={(event) =>
                      update({
                        typeface: event.target.value
                          ? parseTypeface(event.target.value)
                          : undefined,
                      })
                    }
                  >
                    <option value="">Default ({defaultTypeface.label})</option>
                    {typefaces.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="settings-field text-style-size">
                  Font size
                  <span className="settings-unit">
                    <input
                      type="number"
                      min={fontSizes.min}
                      max={fontSizes.max}
                      step="1"
                      value={style.size ?? ""}
                      placeholder={String(resolved.size)}
                      onChange={(event) => {
                        const value = event.target.valueAsNumber;
                        if (!event.target.value) update({ size: undefined });
                        else if (
                          Number.isInteger(value) &&
                          value >= fontSizes.min &&
                          value <= fontSizes.max
                        )
                          update({ size: value });
                      }}
                    />
                    <span aria-hidden="true">px</span>
                  </span>
                </label>
                <label className="settings-field text-style-weight">
                  Font weight
                  <select
                    value={style.weight ?? ""}
                    onChange={(event) =>
                      update({
                        weight: fontWeights.find(
                          (entry) => String(entry.value) === event.target.value,
                        )?.value,
                      })
                    }
                  >
                    <option value="">Default (Regular)</option>
                    {fontWeights.map((entry) => (
                      <option key={entry.value} value={entry.value}>
                        {entry.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="settings-field">
                  <span id={caseName}>Case</span>
                  <div className="segmented" role="radiogroup" aria-labelledby={caseName}>
                    {textCases.map((entry) => (
                      <label key={entry.value} className="segmented-option" title={entry.label}>
                        <input
                          type="radio"
                          name={caseName}
                          value={entry.value}
                          aria-label={entry.label}
                          checked={(resolved.case ?? "none") === entry.value}
                          onChange={() => update({ case: entry.value })}
                        />
                        <span aria-hidden="true">{entry.glyph}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </fieldset>
          );
        })}
      </div>
    </section>
  );
}
