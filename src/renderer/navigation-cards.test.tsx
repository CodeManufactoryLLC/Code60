import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { NavigationCards } from "./navigation-cards.js";

it("shares accessible title-only cards and forwards the selected card", () => {
  const cards = [
    { id: "first", label: "First", available: true },
    { id: "second", label: "Second", available: false },
  ];
  const onOpen = vi.fn();
  const grid = NavigationCards({ cards, onOpen });
  const html = renderToStaticMarkup(grid);
  expect(html).toContain('class="home-content"');
  expect(html).toContain('aria-label="Open First"');
  expect(html).toContain('aria-label="Open Second" disabled=""');
  expect(html).toContain('title="Connect to a database first"');
  expect(html).not.toContain("navigation-icon");
  grid.props.children[0].props.children[0].props.onClick();
  expect(onOpen).toHaveBeenCalledExactlyOnceWith(cards[0]);
});
