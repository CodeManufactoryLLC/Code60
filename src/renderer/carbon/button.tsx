import { Button as CarbonButton } from "@carbon/react";
import type { ComponentProps } from "react";

/** Preserve native command/submit/ref semantics while Carbon owns the control. */
export function Button({
  variant,
  className = "",
  type = "button",
  ...props
}: ComponentProps<"button"> & { variant?: "primary" | "neutral" | "quiet" }) {
  const names = new Set(className.split(/\s+/));
  const icon = names.has("icon-button");
  const quiet = variant === "quiet" || icon || names.has("ghost") || props.role === "tab";
  const destructive = names.has("destructive") || names.has("danger-text");
  const primary = variant === "primary" || names.has("primary") || names.has("splash-enter");
  return (
    <CarbonButton
      type={type}
      size={icon || names.has("small") ? "sm" : "lg"}
      kind={
        destructive
          ? quiet
            ? "danger--ghost"
            : "danger"
          : primary
            ? "primary"
            : quiet
              ? "ghost"
              : "tertiary"
      }
      className={`${className}${icon ? " carbon-icon-control" : ""}`}
      {...props}
    />
  );
}
