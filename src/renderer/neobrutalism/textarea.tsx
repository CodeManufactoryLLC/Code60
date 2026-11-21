// Adapted from neobrutalism.dev/r/textarea.json; see README.md and LICENSE.
import type { ComponentProps } from "react";

export function Textarea({ className = "", ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={`nb:box-border nb:block nb:w-full nb:rounded-base nb:border-2 nb:border-solid nb:border-control-edge nb:bg-field nb:text-foreground nb:font-base ${className}`}
      {...props}
    />
  );
}
