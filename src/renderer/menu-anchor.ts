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

/** Keep menu and listbox surfaces inside the same eight-pixel viewport inset. */
export function clampMenuPosition(x: number, y: number, size: { width: number; height: number }) {
  return {
    left: Math.max(8, Math.min(x, innerWidth - size.width - 8)),
    top: Math.max(8, Math.min(y, innerHeight - size.height - 8)),
  };
}
