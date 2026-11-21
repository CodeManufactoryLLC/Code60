// Adapted from neobrutalism.dev/r/card.json; see README.md and LICENSE.
import { type ComponentProps, createElement } from "react";

const classes = (...values: (string | undefined)[]) => values.filter(Boolean).join(" ");
type PartProps = ComponentProps<"div"> & { as?: "div" | "span" };

export function Card<Element extends "div" | "section" | "aside" = "div">({
  as,
  className,
  size = "default",
  ...props
}: ComponentProps<Element> & { as?: Element; size?: "default" | "sm" }) {
  return createElement(as ?? "div", {
    "data-slot": "card",
    "data-size": size,
    className: classes(
      "nb:group/card nb:box-border nb:rounded-base nb:flex nb:flex-col nb:shadow-shadow nb:border-2 nb:border-solid nb:gap-(--nb-card-spacing) nb:py-(--nb-card-spacing) nb:border-border nb:bg-background nb:text-foreground nb:font-base nb:[--nb-card-spacing:24px] nb:data-[size=sm]:[--nb-card-spacing:16px]",
      className,
    ),
    ...props,
  });
}

export function CardHeader({ as: Element = "div", className, ...props }: PartProps) {
  return (
    <Element
      data-slot="card-header"
      className={classes(
        "nb:@container/card-header nb:grid nb:auto-rows-min nb:grid-rows-[auto_auto] nb:items-start nb:gap-1.5 nb:px-(--nb-card-spacing) nb:has-data-[slot=card-action]:grid-cols-[1fr_auto] nb:[.border-b]:pb-(--nb-card-spacing)",
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ as: Element = "div", className, ...props }: PartProps) {
  return (
    <Element
      data-slot="card-title"
      className={classes("nb:font-heading nb:leading-none", className)}
      {...props}
    />
  );
}

export function CardContent({ as: Element = "div", className, ...props }: PartProps) {
  return (
    <Element
      data-slot="card-content"
      className={classes("nb:px-(--nb-card-spacing)", className)}
      {...props}
    />
  );
}

export function CardAction({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={classes(
        "nb:col-start-2 nb:row-span-2 nb:row-start-1 nb:self-start nb:justify-self-end",
        className,
      )}
      {...props}
    />
  );
}
