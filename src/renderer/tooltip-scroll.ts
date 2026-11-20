/** Ignore queued scroll notifications whose movement preceded the tooltip interaction. */
export function captureTooltipScroll(
  control: HTMLElement,
): (source: EventTarget | null) => boolean {
  const document = control.ownerDocument;
  const positions = new Map<Element, { left: number; top: number }>();
  for (let element: Element | null = control; element; element = element.parentElement) {
    positions.set(element, { left: element.scrollLeft, top: element.scrollTop });
  }
  return (source) => {
    const element = source === document ? document.scrollingElement : (source as Element | null);
    const previous = element && positions.get(element);
    // Unrelated scrolling retains the existing dismissal behavior.
    if (!element || !previous) return true;
    const next = { left: element.scrollLeft, top: element.scrollTop };
    positions.set(element, next);
    return next.left !== previous.left || next.top !== previous.top;
  };
}
