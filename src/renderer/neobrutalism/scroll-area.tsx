// Adapted from neobrutalism.dev/r/scroll-area.json; see README.md and LICENSE.
import type { ComponentProps } from "react";

/** Keep the native viewport/ref and scrolling lifecycle; CSS supplies the thumb. */
export function ScrollArea(props: ComponentProps<"div">) {
  // biome-ignore lint/a11y/noNoninteractiveTabindex: native scrollports need keyboard access for Page Up/Down and Home/End.
  return <div data-slot="scroll-area-viewport" tabIndex={0} {...props} />;
}
