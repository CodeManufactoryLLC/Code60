// Adapted from neobrutalism.dev/r/accordion.json; see README.md and LICENSE.
import type { ComponentProps } from "react";
import { Icon } from "../icons.js";

/** Native buttons and hidden panels replace Base UI; callers own expansion. */
export function Accordion({ className = "", ...props }: ComponentProps<"div">) {
  return <div data-slot="accordion" className={`neo-accordion ${className}`} {...props} />;
}

export function AccordionItem({ className = "", ...props }: ComponentProps<"section">) {
  return (
    <section
      className={`neo-accordion-item nb:rounded-base nb:border-2 nb:border-solid nb:border-border nb:shadow-shadow ${className}`}
      {...props}
    />
  );
}

export function AccordionTrigger({ className = "", children, ...props }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      data-slot="accordion-trigger"
      onKeyDown={(event) => {
        const root = event.currentTarget.closest('[data-slot="accordion"]');
        if (!root) return;
        const triggers = Array.from(
          root.querySelectorAll<HTMLButtonElement>('[data-slot="accordion-trigger"]'),
        );
        const index = triggers.indexOf(event.currentTarget);
        const next =
          event.key === "ArrowDown"
            ? (index + 1) % triggers.length
            : event.key === "ArrowUp"
              ? (index + triggers.length - 1) % triggers.length
              : event.key === "Home"
                ? 0
                : event.key === "End"
                  ? triggers.length - 1
                  : undefined;
        if (next === undefined) return;
        event.preventDefault();
        triggers[next]?.focus();
      }}
      className={`neo-accordion-trigger nb:bg-main nb:text-main-foreground ${className}`}
      {...props}
    >
      {children}
      <span className="neo-accordion-indicator">
        <Icon name="chevron--down" />
      </span>
    </button>
  );
}

export function AccordionContent({ className = "", ...props }: ComponentProps<"div">) {
  return <div className={`neo-accordion-content ${className}`} {...props} />;
}
