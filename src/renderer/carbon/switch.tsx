import { Toggle } from "@carbon/react";
import { type ComponentProps, type ReactNode, useId } from "react";

type SwitchProps = Omit<
  ComponentProps<typeof Toggle>,
  "id" | "labelText" | "onToggle" | "onChange" | "toggled"
> & {
  id?: string;
  labelText: ReactNode;
  checked: boolean;
  onChange?(checked: boolean): void;
};

/** Compound labels retain their accessible descriptions; Carbon owns switch input/state. */
export function Switch({
  id,
  labelText,
  checked,
  onChange,
  "aria-labelledby": labelledBy,
  ...props
}: SwitchProps) {
  const generated = useId();
  const controlId = id ?? generated;
  const labelId = `${controlId}-label`;
  return (
    <div className="code60-switch">
      <label id={labelId} htmlFor={controlId}>
        {labelText}
      </label>
      <Toggle
        id={controlId}
        aria-labelledby={labelledBy ?? labelId}
        toggled={checked}
        onToggle={(checked) => onChange?.(checked)}
        {...props}
      />
    </div>
  );
}
