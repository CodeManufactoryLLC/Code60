import { TextArea } from "@carbon/react";
import { type ComponentProps, type ReactNode, useId } from "react";

/** Composers retain their IME, command, ref and draft ownership. */
export function Textarea({
  id,
  labelText,
  hideLabel = true,
  ...props
}: Omit<ComponentProps<typeof TextArea>, "labelText"> & { labelText?: ReactNode }) {
  const generated = useId();
  return (
    <TextArea
      id={id ?? generated}
      labelText={labelText ?? props["aria-label"] ?? ""}
      hideLabel={hideLabel}
      {...props}
    />
  );
}
