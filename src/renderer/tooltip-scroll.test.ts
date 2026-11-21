import { expect, it } from "vitest";
import { captureTooltipScroll } from "./tooltip-scroll.js";

function fixture() {
  const root = { scrollLeft: 0, scrollTop: 0, parentElement: null };
  const panel = { scrollLeft: 0, scrollTop: 120, parentElement: root };
  const document = { scrollingElement: root };
  const control = { scrollLeft: 0, scrollTop: 0, parentElement: panel, ownerDocument: document };
  return {
    root,
    panel,
    document,
    moved: captureTooltipScroll(control as unknown as HTMLElement),
  };
}

it("ignores delayed notifications at the positions captured when hover or focus begins", () => {
  const { panel, root, document, moved } = fixture();
  expect(moved(panel as unknown as Element)).toBe(false);
  expect(moved(document as unknown as Document)).toBe(false);
  expect(moved(root as unknown as Element)).toBe(false);
});

it("detects later vertical, horizontal and document movement and updates its baseline", () => {
  const { panel, root, document, moved } = fixture();
  panel.scrollTop += 1;
  expect(moved(panel as unknown as Element)).toBe(true);
  expect(moved(panel as unknown as Element)).toBe(false);
  panel.scrollLeft = 1;
  expect(moved(panel as unknown as Element)).toBe(true);
  root.scrollTop = 1;
  expect(moved(document as unknown as Document)).toBe(true);
  expect(moved(document as unknown as Document)).toBe(false);
});

it("keeps dismissing on unrelated or unknown scroll sources", () => {
  const { moved } = fixture();
  expect(moved(new EventTarget())).toBe(true);
  expect(moved(null)).toBe(true);
});
