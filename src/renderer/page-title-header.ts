import { type RefObject, useLayoutEffect, useState } from "react";

/** Follow the visible conversation column, including live file-panel resizing. */
export function observeBreadcrumbRightInset(body: HTMLElement): () => void {
  const workspace = body.closest<HTMLElement>(".app-workspace");
  const conversations = body.querySelector<HTMLElement>(".chat-conversations");
  if (!workspace || !conversations) return () => {};
  const property = "--breadcrumb-right-inset";
  const riseProperty = "--right-panel-rise";
  const heightProperty = "--breadcrumb-card-height";
  const header = workspace.querySelector<HTMLElement>(".workspace-header");
  let disposed = false;
  const update = () => {
    if (disposed) return;
    const bounds = workspace
      .querySelector<HTMLElement>(".workspace-header")
      ?.getBoundingClientRect();
    const inset = bounds
      ? Math.max(
          0,
          Math.min(bounds.width, bounds.right - conversations.getBoundingClientRect().right),
        )
      : 0;
    const value = `${inset}px`;
    if (workspace.style.getPropertyValue(property) !== value)
      workspace.style.setProperty(property, value);
    const card = workspace.querySelector<HTMLElement>(".workspace-breadcrumbs");
    const heightValue = `${card?.getBoundingClientRect().height ?? 58}px`;
    if (workspace.style.getPropertyValue(heightProperty) !== heightValue)
      workspace.style.setProperty(heightProperty, heightValue);
    const rise = card
      ? Math.max(0, body.getBoundingClientRect().top - card.getBoundingClientRect().top)
      : 0;
    const riseValue = `${rise}px`;
    if (workspace.style.getPropertyValue(riseProperty) !== riseValue)
      workspace.style.setProperty(riseProperty, riseValue);
  };
  const observer = new ResizeObserver(update);
  observer.observe(conversations);
  observer.observe(workspace);
  if (header) observer.observe(header);
  update();
  return () => {
    disposed = true;
    observer.disconnect();
    workspace.style.removeProperty(property);
    workspace.style.removeProperty(riseProperty);
    workspace.style.removeProperty(heightProperty);
  };
}

/** Hidden retained pages keep their title marker, but never publish into the app header. */
function visibleBreadcrumbHeader(element: HTMLElement): HTMLElement | null {
  // A pending selection keeps its last visible chat as an inert presentation.
  // Its portalled title remains visible too; all other inert/hidden owners stay out.
  return element.parentElement?.closest('[hidden], [inert]:not([data-navigation-pending="true"])')
    ? null
    : (element.closest(".app-workspace")?.querySelector<HTMLElement>(".workspace-breadcrumbs") ??
        null);
}

export function observeBreadcrumbHeader(
  element: HTMLElement,
  publish: (header: HTMLElement | null) => void,
): () => void {
  let disposed = false;
  const update = () => {
    if (!disposed) publish(visibleBreadcrumbHeader(element));
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
  // React visibility changes must hand off the portal before paint. Observer-driven
  // state alone may commit after a frame with an empty or duplicated header.
  useLayoutEffect(() => {
    setHeader(enabled && ref.current ? visibleBreadcrumbHeader(ref.current) : null);
  });
  return header;
}
