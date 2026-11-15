/** Ignore queued or unrelated scrolls while a menu's trigger stays in place. */
export function menuAnchorMoved(element: Element, anchor: DOMRect): boolean {
  const next = element.getBoundingClientRect();
  return (
    next.x !== anchor.x ||
    next.y !== anchor.y ||
    next.width !== anchor.width ||
    next.height !== anchor.height
  );
}
