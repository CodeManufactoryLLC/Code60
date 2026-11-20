// Adapted from neobrutalism.dev/r/bubble.json; see README.md and LICENSE.
import { type ComponentProps, createElement } from "react";

/** Human prompts stay preformatted; agent content keeps semantic Markdown blocks. */
export function BubbleContent<Element extends "pre" | "div" = "pre">({
  as,
  variant = "human",
  className = "",
  ...props
}: ComponentProps<Element> & { as?: Element; variant?: "human" | "agent" }) {
  return createElement(as ?? "pre", {
    "data-slot": "bubble-content",
    "data-variant": variant,
    className: [
      "nb:box-border nb:min-w-0 nb:max-w-full nb:rounded-base nb:border-2 nb:border-solid nb:border-border",
      variant === "agent" ? "nb:bg-agent nb:text-on-agent" : "nb:bg-human nb:text-on-human",
      className,
    ].join(" "),
    ...props,
  });
}
