import { type RefObject, useLayoutEffect, useState } from "react";

/** Hidden retained pages keep their title marker, but never publish into the app header. */
export function observeBreadcrumbHeader(
  element: HTMLElement,
  publish: (header: HTMLElement | null) => void,
): () => void {
  const header =
    element.closest(".app-workspace")?.querySelector<HTMLElement>(".workspace-breadcrumbs") ?? null;
  let disposed = false;
  const update = () => {
    if (!disposed)
      publish(header && !element.parentElement?.closest("[hidden], [inert]") ? header : null);
  };
  const observer = new MutationObserver(update);
  for (let parent = element.parentElement; parent; parent = parent.parentElement)
    observer.observe(parent, { attributes: true, attributeFilter: ["hidden", "inert"] });
  update();
  return () => {
    disposed = true;
    observer.disconnect();
  };
}

export function useBreadcrumbHeader(ref: RefObject<HTMLElement | null>, enabled: boolean) {
  const [header, setHeader] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!enabled || !ref.current) {
      setHeader(null);
      return;
    }
    return observeBreadcrumbHeader(ref.current, setHeader);
  }, [ref, enabled]);
  return header;
}
