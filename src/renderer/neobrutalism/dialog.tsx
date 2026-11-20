// Adapted from neobrutalism.dev/r/dialog.json; see README.md and LICENSE.
import type { ComponentProps } from "react";

/** Native modal ownership/focus stays with callers; this adapter supplies the shared surface. */
export function DialogContent({ className, ...props }: ComponentProps<"dialog">) {
  return (
    <dialog
      data-slot="dialog-content"
      className={[
        "neo-dialog nb:box-border nb:rounded-dialog nb:border-2 nb:border-solid nb:border-dialog-edge nb:bg-dialog nb:text-foreground nb:shadow-dialog nb:p-4",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
}
