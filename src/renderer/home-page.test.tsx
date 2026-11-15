import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HomePage } from "./home-page.js";

type Card = { id: string; label: string; available: boolean; action(): void };
type HomeView = {
  page: "home";
  cards: Card[];
  error?: string;
  onOpen(card: Card): void;
};
const forwarded = vi.hoisted(() => ({ view: undefined as HomeView | undefined }));
vi.mock("./navigation-home-page.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./navigation-home-page.js")>();
  return {
    ...actual,
    NavigationHomePage: (props: HomeView) => {
      forwarded.view = props;
      return actual.NavigationHomePage(props);
    },
  };
});

describe("Home destinations", () => {
  it.each([
    [null, false],
    [null, true],
    ["/database.sqlite", false],
    ["/database.sqlite", true],
  ] as const)(
    "shows exactly five ordered cards with independent gating (%s, Relay %s)",
    (database, relayAvailable) => {
      const html = renderToStaticMarkup(
        <HomePage
          database={database}
          relayAvailable={relayAvailable}
          onOpenRelay={async () => {}}
          onOpenPage={() => {}}
        />,
      );
      expect([...html.matchAll(/aria-label="Open ([^"]+)"/g)].map((match) => match[1])).toEqual([
        "Relay",
        "Search",
        "Projects",
        "Apps",
        "Sessions",
      ]);
      expect(html.match(/class="home-card"/g)).toHaveLength(5);
      expect(html).toContain('id="home-title" class="page-title table-title"');
      expect(html).not.toContain("home-card-description");
      for (const [id, icon, available] of [
        ["relay", "app-steering-wheel", relayAvailable],
        ["search", "app-search", Boolean(database)],
        ["projects", "app-backlog", true],
        ["apps", "app-apps", true],
        ["sessions", "app-table", Boolean(database)],
      ] as const) {
        const card = html.match(
          new RegExp(`<button[^>]*data-feature="${id}"[\\s\\S]*?</button>`),
        )?.[0];
        expect(card).toContain(`data-icon="${icon}"`);
        expect(card).toContain('alt="" aria-hidden="true"');
        expect(card?.includes('disabled=""')).toBe(!available);
        if (!available)
          expect(card).toContain(
            id === "relay" ? 'title="Relay is unavailable"' : 'title="Connect to a database first"',
          );
      }
    },
  );

  it("forwards each page destination and prevents overlapping Relay selections", async () => {
    let finish: (() => void) | undefined;
    const onOpenRelay = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const onOpenPage = vi.fn();
    renderToStaticMarkup(
      <HomePage database="/db" relayAvailable onOpenRelay={onOpenRelay} onOpenPage={onOpenPage} />,
    );
    const view = forwarded.view;
    if (!view) throw new Error("Home view was not rendered");
    for (const card of view.cards.slice(1)) view.onOpen(card);
    expect(onOpenPage.mock.calls.map(([id]) => id)).toEqual([
      "search",
      "projects",
      "apps",
      "sessions",
    ]);
    const relay = view.cards[0];
    if (!relay) throw new Error("Relay card is missing");
    view.onOpen(relay);
    view.onOpen(relay);
    expect(onOpenRelay).toHaveBeenCalledOnce();
    finish?.();
    await Promise.resolve();
    view.onOpen(relay);
    expect(onOpenRelay).toHaveBeenCalledTimes(2);
    finish?.();
    await Promise.resolve();
  });
});
