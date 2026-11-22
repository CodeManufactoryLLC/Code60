// Adapted from neobrutalism.dev/r/button.json; see README.md and LICENSE.
import type { ComponentProps } from "react";

/** Native buttons retain Code60's event, focus, disabled and form semantics. */
export function Button({
  variant = "neutral",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: "primary" | "neutral" | "quiet" }) {
  return (
    <button
      type="button"
      data-slot="button"
      data-variant={variant}
      className={[
        "neo-button nb:inline-flex nb:items-center nb:justify-center nb:whitespace-nowrap nb:gap-2 nb:font-control",
        variant === "quiet"
          ? "nb:rounded-none nb:border-0 nb:bg-transparent nb:shadow-none"
          : "nb:rounded-base nb:border-2 nb:border-solid nb:border-control-edge nb:shadow-action",
        variant === "primary" ? "nb:bg-main nb:text-main-foreground" : "nb:text-foreground",
        variant === "neutral" ? "nb:bg-control" : "",
        className,
      ].join(" ")}
      {...props}
    />
  );
}
