// Adapted from neobrutalism.dev/r/toggle.json. See README.md and LICENSE.
import type { ComponentProps } from "react";

export function Toggle(props: ComponentProps<"button"> & { "aria-pressed": boolean }) {
  return (
    <button
      type="button"
      data-slot="toggle"
      className="neo-toggle nb:inline-flex nb:items-center nb:justify-center nb:gap-1 nb:rounded-base nb:border-2 nb:border-solid nb:border-control-edge nb:bg-control nb:text-foreground nb:font-control nb:aria-pressed:bg-main nb:aria-pressed:text-main-foreground"
      {...props}
    />
  );
}
