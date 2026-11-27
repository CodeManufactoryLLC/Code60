import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HomePage } from "./home-page.js";
import { NavigationHomePage } from "./navigation-home-page.js";

type Card = { id: string; label: string; available: boolean; action(): void };
type HomeView = {
  page: "home" | "assistants";
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
  it.each([false, true])(
    "shows two Assistants cards without a database (Relay %s)",
    (available) => {
      const onOpenPage = vi.fn();
      const onOpenRelay = vi.fn(async () => {});
      const html = renderToStaticMarkup(
        <HomePage
          page="assistants"
          database={null}
          relayAvailable={available}
          onOpenRelay={onOpenRelay}
          onOpenPage={onOpenPage}
        />,
      );
      expect([...html.matchAll(/aria-label="Open ([^"]+)"/g)].map((match) => match[1])).toEqual([
        "Relay",
        "Custom Assistants",
      ]);
      expect(html).not.toContain("Welcome to Code60");
      expect(onOpenRelay).not.toHaveBeenCalled();
      expect(onOpenPage).not.toHaveBeenCalled();
      const view = forwarded.view;
      const relay = view?.cards[0];
      const custom = view?.cards[1];
      if (!view || !relay || !custom) throw new Error("Missing Assistants cards");
      expect(relay.available).toBe(available);
      expect(custom.available).toBe(true);
      view.onOpen(custom);
      expect(onOpenPage).toHaveBeenCalledExactlyOnceWith("custom-agents");
    },
  );
  it.each(["apps", "settings"] as const)(
    "does not add Home's welcome to the %s navigation home",
    (page) => {
      const html = renderToStaticMarkup(
        <NavigationHomePage page={page} cards={[]} onOpen={() => {}} />,
      );
      expect(html).not.toContain("Welcome to Code60");
      expect(html).not.toContain("home-welcome");
    },
  );

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
        "Custom Assistants",
        "Search",
        "Apps",
        "Sessions",
      ]);
      expect(html.match(/class="navigation-list-row"/g)).toHaveLength(5);
      expect(html).not.toContain("Welcome to Code60");
      expect(html).toContain('id="home-title" class="content-page-title"');
      expect(html).not.toContain("home-card-description");
      for (const [id, icon, available] of [
        ["relay", "app-steering-wheel", relayAvailable],
        ["custom-agents", "app-custom-agents", true],
        ["search", "app-search", Boolean(database)],
        ["apps", "app-apps", true],
        ["sessions", "app-table", Boolean(database)],
      ] as const) {
        const card = html.match(
          new RegExp(`<button[^>]*data-feature="${id}"[\\s\\S]*?</button>`),
        )?.[0];
        expect(card).not.toContain(`data-icon="${icon}"`);
        expect(card).not.toContain("<img");
        expect(card?.includes('disabled=""')).toBe(!available);
        if (!available)
          expect(card).toContain(
            id === "relay" ? 'title="Relay is unavailable"' : 'title="Connect to a database first"',
          );
      }
    },
  );

  it("opens Custom Assistants without a database or Relay connection, without selecting a chat", () => {
    const onOpenRelay = vi.fn(async () => {});
    const onOpenPage = vi.fn();
    renderToStaticMarkup(
      <HomePage
        database={null}
        relayAvailable={false}
        onOpenRelay={onOpenRelay}
        onOpenPage={onOpenPage}
      />,
    );
    const view = forwarded.view;
    const card = view?.cards.find((card) => card.id === "custom-agents");
    if (!view || !card) throw new Error("Custom Assistants card is missing");
    expect(card.available).toBe(true);
    view.onOpen(card);
    expect(onOpenPage).toHaveBeenCalledExactlyOnceWith("custom-agents");
    expect(onOpenRelay).not.toHaveBeenCalled();
  });

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
      "custom-agents",
      "search",
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
