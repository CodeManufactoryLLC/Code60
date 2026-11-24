import { useId } from "react";
import { Select } from "./carbon/fields.js";
import { SettingsCard, SettingsHeader } from "./settings-layout.js";
import type { TextStyles } from "./typography.js";

export function TextSettings({
  textStyles,
  onTextStyles,
}: {
  textStyles: TextStyles;
  onTextStyles(styles: TextStyles): void;
}) {
  const id = useId();
  const size = textStyles.normalText.size;
  return (
    <section className="settings-section" aria-labelledby={id}>
      <SettingsHeader page="text" id={id} />
      <SettingsCard title="Reading">
        <Select
          labelText="Interface text size"
          value={size ?? ""}
          onChange={(e) =>
            onTextStyles({
              ...textStyles,
              normalText: {
                ...textStyles.normalText,
                size: e.target.value ? Number(e.target.value) : undefined,
              },
            })
          }
        >
          <option value="">Browser default</option>
          {[...new Set([14, 16, 18, 20, 24, 32, ...(size ? [size] : [])])]
            .sort((a, b) => a - b)
            .map((n) => (
              <option key={n} value={n}>
                {n} px
              </option>
            ))}
        </Select>
      </SettingsCard>
    </section>
  );
}
