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
    className: ["transcript-content", className].filter(Boolean).join(" "),
    ...props,
  });
}
