import { Checkbox as CarbonCheckbox, RadioButton as CarbonRadioButton } from "@carbon/react";
import { type ChangeEventHandler, type ComponentProps, type ReactNode, useId } from "react";

type CheckboxProps = Omit<ComponentProps<typeof CarbonCheckbox>, "id" | "labelText"> & {
  id?: string;
  labelText?: ReactNode;
};
export function Checkbox({ id, labelText, ...props }: CheckboxProps) {
  const generated = useId();
  return (
    <CarbonCheckbox
      id={id ?? generated}
      labelText={labelText ?? ""}
      hideLabel={!labelText}
      {...props}
    />
  );
}

type RadioProps = Omit<
  ComponentProps<typeof CarbonRadioButton>,
  "id" | "labelText" | "onChange"
> & { id?: string; labelText?: ReactNode; onChange?: ChangeEventHandler<HTMLInputElement> };
export function RadioButton({ id, labelText, onChange, ...props }: RadioProps) {
  const generated = useId();
  return (
    <CarbonRadioButton
      id={id ?? generated}
      labelText={labelText ?? ""}
      hideLabel={!labelText}
      onChange={(_value, _name, event) => onChange?.(event)}
      {...props}
    />
  );
}
