// Adapted from neobrutalism.dev/r/breadcrumb.json; see README.md and LICENSE.
import type { ComponentProps } from "react";

export function Breadcrumb(props: ComponentProps<"nav">) {
  return <nav data-slot="breadcrumb" {...props} />;
}

export function BreadcrumbList({ className = "", ...props }: ComponentProps<"ol">) {
  return (
    <ol
      data-slot="breadcrumb-list"
      className={`nb:flex nb:flex-wrap nb:items-center ${className}`}
      {...props}
    />
  );
}

export function BreadcrumbItem({ className = "", ...props }: ComponentProps<"li">) {
  return (
    <li
      data-slot="breadcrumb-item"
      className={`nb:inline-flex nb:items-center ${className}`}
      {...props}
    />
  );
}
