import { Select as CarbonSelect, TextInput as CarbonTextInput } from "@carbon/react";
import { type ComponentProps, type ReactNode, useId } from "react";

type Label = { labelText?: ReactNode; id?: string | undefined };

/** Existing external labels and ARIA names remain authoritative when no label is supplied. */
export function TextInput({
  id,
  labelText,
  ...props
}: Omit<ComponentProps<typeof CarbonTextInput>, "id" | "labelText"> & Label) {
  const generated = useId();
  return (
    <CarbonTextInput
      id={id ?? generated}
      labelText={labelText ?? ""}
      hideLabel={!labelText}
      {...props}
    />
  );
}

export function Select({
  id,
  labelText,
  ...props
}: Omit<ComponentProps<typeof CarbonSelect>, "id" | "labelText"> & Label) {
  const generated = useId();
  return (
    <CarbonSelect
      id={id ?? generated}
      labelText={labelText ?? ""}
      noLabel={!labelText}
      {...props}
    />
  );
}
