import { type ComponentProps, createElement } from "react";

/** Structural retained-view boundaries; surfaces add no card frame or visual chrome. */
export function Surface<Element extends "div" | "section" | "aside" = "div">({
  as,
  className = "",
  size: _size,
  ...props
}: ComponentProps<Element> & { as?: Element; size?: "default" | "sm" }) {
  return createElement(as ?? "div", {
    className: `code60-surface ${className}`,
    ...props,
  });
}
