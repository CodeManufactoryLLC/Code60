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

/** Reveal a highlighted option without scrolling the menu's owning page. */
export function scrollMenuOption(list: HTMLElement, option: HTMLElement) {
  const viewport = list.getBoundingClientRect();
  if (list.offsetHeight <= 0 || list.clientHeight <= 0 || viewport.height <= 0) return;
  // Popover entrance transforms scale client rectangles, but not scroll offsets.
  const scale = viewport.height / list.offsetHeight;
  const top = viewport.top + list.clientTop * scale;
  const bottom = top + list.clientHeight * scale;
  const bounds = option.getBoundingClientRect();
  if (bounds.top < top && bounds.bottom > bottom) return;
  if (bounds.top < top) list.scrollTop += (bounds.top - top) / scale;
  else if (bounds.bottom > bottom)
    list.scrollTop += Math.min(bounds.bottom - bottom, bounds.top - top) / scale;
}
