import type { ComponentProps } from "react";
import { Button } from "./button.js";

export function Toggle(props: ComponentProps<"button"> & { "aria-pressed": boolean }) {
  return <Button variant="quiet" {...props} />;
}
