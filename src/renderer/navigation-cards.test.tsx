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
  expect(html).not.toContain("home-card-create");
  grid.props.children[1].props.children[1][0]?.props.children[0].props.onClick();
  expect(onOpen).toHaveBeenCalledExactlyOnceWith(cards[0]);
});

it.each([false, true])("puts the creation card first, including when empty=%s", (empty) => {
  const cards = empty ? [] : [{ id: "first", label: "First", available: true }];
  const create = { label: "New Project", onClick: vi.fn() };
  const onOpen = vi.fn();
  const grid = NavigationCards({ cards, create, onOpen });
  const html = renderToStaticMarkup(grid);
  const first = grid.props.children[1].props.children[0];
  if (!first) throw new Error("Missing creation card");
  expect(first.props.className).toBe("navigation-card");
  expect(html).toContain('aria-label="New Project"');
  expect(html.match(/<button/g)).toHaveLength(empty ? 1 : 2);
  const creation = html.slice(html.indexOf("<button"), html.indexOf("</button>"));
  expect(creation).toContain("New Project");
  expect(creation).toContain("<svg");
  expect(creation).not.toMatch(/home-card-art|home-card-copy|home-card-arrow/);
  if (!empty)
    expect(html.indexOf("home-card-create")).toBeLessThan(html.indexOf('data-feature="first"'));
  first.props.children.props.onClick();
  expect(create.onClick).toHaveBeenCalledExactlyOnceWith();
  expect(onOpen).not.toHaveBeenCalled();
});

it("keeps creation keyboard-native, context-labelled and disabled while pending", () => {
  const html = renderToStaticMarkup(
    <NavigationCards
      cards={[]}
      create={{
        label: "New Session",
        ariaLabel: "New Session in A",
        title: "Create a chat",
        onClick: () => {},
      }}
      pending
      onOpen={() => {}}
    />,
  );
  expect(html).toContain('<button type="button" class="home-card home-card-create"');
  expect(html).toContain('aria-label="New Session in A" disabled=""');
  expect(html).toContain('title="Wait for the current action to finish"');
  expect(html).toContain("New Session");
  expect(html).not.toContain('tabindex="-1"');
});

it("places optional introductory content above the cards and keeps feedback below them", () => {
  const html = renderToStaticMarkup(
    <NavigationCards
      cards={[{ id: "first", label: "First", available: true }]}
      intro={<p>Welcome to Code60</p>}
      onOpen={() => {}}
    >
      <p role="alert">Navigation failed</p>
    </NavigationCards>,
  );
  expect(html.indexOf("Welcome to Code60")).toBeLessThan(html.indexOf('class="home-cards"'));
  expect(html.indexOf("Navigation failed")).toBeGreaterThan(html.indexOf("</button>"));
});

it("places card actions beside the Open button without nesting interactive controls", () => {
  const html = renderToStaticMarkup(
    <NavigationCards
      cards={[{ id: "first", label: "First", available: true }]}
      onOpen={() => {}}
      renderActions={() => <button type="button">More actions</button>}
    />,
  );
  expect(html).toContain('data-slot="card"');
  expect(html).toMatch(
    /<\/button><div[^>]*data-slot="card-action"[^>]*><button type="button">More actions<\/button>/,
  );
  expect(html.match(/<button/g)).toHaveLength(2);
});
