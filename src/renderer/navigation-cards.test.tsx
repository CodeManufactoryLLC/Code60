import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { NavigationCards } from "./navigation-cards.js";

function control(tree: ReactNode, label: string): ReactElement<{ onClick(): void }> {
  if (Array.isArray(tree)) {
    for (const child of tree) {
      try {
        return control(child, label);
      } catch {
        /* Search the remaining siblings. */
      }
    }
  }
  if (isValidElement<{ "aria-label"?: string; children?: ReactNode; onClick(): void }>(tree)) {
    if (tree.props["aria-label"] === label) return tree;
    return control(tree.props.children, label);
  }
  throw new Error(`Missing control: ${label}`);
}
const button = (html: string, label: string) =>
  html.match(new RegExp(`<button[^>]*aria-label="${label}"[\\s\\S]*?</button>`))?.[0];

it("opens the selected destination through Carbon controls with independent availability", () => {
  const cards = [
    { id: "first", label: "First", available: true },
    { id: "second", label: "Second", available: false },
  ];
  const onOpen = vi.fn();
  const tree = NavigationCards({ cards, onOpen });
  const html = renderToStaticMarkup(tree);
  expect(html).toContain('class="navigation-list"');
  expect(html).toContain("cds--btn--ghost");
  expect(button(html, "Open First")).not.toContain('disabled=""');
  expect(button(html, "Open Second")).toContain('disabled=""');
  expect(button(html, "Open Second")).toContain('title="Connect to a database first"');
  control(tree, "Open First").props.onClick();
  expect(onOpen).toHaveBeenCalledExactlyOnceWith(cards[0]);
  expect(html).not.toContain('data-slot="card"');
});

it.each([false, true])("keeps creation before destinations, including empty=%s", (empty) => {
  const cards = empty ? [] : [{ id: "first", label: "First", available: true }];
  const create = { label: "New Project", onClick: vi.fn() };
  const onOpen = vi.fn();
  const tree = NavigationCards({ cards, create, onOpen });
  const html = renderToStaticMarkup(tree);
  expect(button(html, "New Project")).toContain('type="button"');
  expect(button(html, "New Project")).toContain("cds--btn--primary");
  expect(html.match(/<button/g)).toHaveLength(empty ? 1 : 2);
  if (!empty)
    expect(html.indexOf('aria-label="New Project"')).toBeLessThan(
      html.indexOf('data-feature="first"'),
    );
  control(tree, "New Project").props.onClick();
  expect(create.onClick).toHaveBeenCalledExactlyOnceWith();
  expect(onOpen).not.toHaveBeenCalled();
});

it("keeps creation context-labelled and disabled while navigation is pending", () => {
  const html = renderToStaticMarkup(
    <NavigationCards
      cards={[]}
      create={{ label: "New Session", ariaLabel: "New Session in A", onClick: () => {} }}
      pending
      onOpen={() => {}}
    />,
  );
  expect(button(html, "New Session in A")).toContain('disabled=""');
  expect(button(html, "New Session in A")).toContain(
    'title="Wait for the current action to finish"',
  );
  expect(html).not.toContain('tabindex="-1"');
});

it("keeps caller-provided content before destinations and feedback after them", () => {
  const html = renderToStaticMarkup(
    <NavigationCards
      cards={[{ id: "first", label: "First", available: true }]}
      intro={<p>Recent work</p>}
      onOpen={() => {}}
    >
      <p role="alert">Navigation failed</p>
    </NavigationCards>,
  );
  expect(html.indexOf("Recent work")).toBeLessThan(html.indexOf('class="navigation-list"'));
  expect(html.indexOf("Navigation failed")).toBeGreaterThan(html.indexOf("</ul>"));
});

it("keeps independent destination actions outside the Open button", () => {
  const html = renderToStaticMarkup(
    <NavigationCards
      cards={[{ id: "first", label: "First", available: true }]}
      onOpen={() => {}}
      renderActions={() => <button type="button">More actions</button>}
    />,
  );
  expect(html).toMatch(
    /<\/button><div class="navigation-row-actions"><button type="button">More actions<\/button>/,
  );
  expect(html.match(/<button/g)).toHaveLength(2);
});
