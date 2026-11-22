import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import {
  ContentHeaderSlot,
  ContentPageHeader,
  observeContentHeader,
} from "./content-page-header.js";

const callbacks: (() => void)[] = [];
const disconnect = vi.fn();
afterEach(() => {
  vi.unstubAllGlobals();
  callbacks.length = 0;
  disconnect.mockClear();
});

function fixture() {
  vi.stubGlobal(
    "MutationObserver",
    class {
      constructor(callback: () => void) {
        callbacks.push(callback);
      }
      observe = vi.fn();
      disconnect = disconnect;
    },
  );
  let hidden = false,
    inert = false,
    pending = false,
    disabled = false;
  const slot = {} as HTMLElement;
  const card = { querySelector: vi.fn(() => slot) };
  const parent = {
    parentElement: null,
    closest: () => (hidden || (inert && !pending) ? parent : null),
  };
  const source = {
    parentElement: parent,
    closest: (selector: string) =>
      selector === "fieldset:disabled" ? (disabled ? parent : null) : card,
  } as unknown as HTMLElement;
  return {
    source,
    slot,
    hide: () => {
      hidden = true;
    },
    inert: () => {
      inert = true;
    },
    pending: () => {
      pending = true;
    },
    disable: () => {
      disabled = true;
    },
  };
}

it("releases hidden/inert owners and preserves the disabled fieldset across a portal", () => {
  const view = fixture(),
    publish = vi.fn();
  const stop = observeContentHeader(view.source, publish);
  expect(publish).toHaveBeenLastCalledWith({ target: view.slot, disabled: false });
  view.disable();
  callbacks[0]?.();
  expect(publish).toHaveBeenLastCalledWith({ target: view.slot, disabled: true });
  view.inert();
  callbacks[0]?.();
  expect(publish).toHaveBeenLastCalledWith({ target: null, disabled: false });
  view.pending();
  callbacks[0]?.();
  expect(publish).toHaveBeenLastCalledWith({ target: view.slot, disabled: true });
  view.hide();
  callbacks[0]?.();
  expect(publish).toHaveBeenLastCalledWith({ target: null, disabled: false });
  stop();
  expect(disconnect).toHaveBeenCalledOnce();
  publish.mockClear();
  callbacks[0]?.();
  expect(publish).not.toHaveBeenCalled();
});

it("keeps separate retained owners in their own card slots", () => {
  const a = fixture(),
    b = fixture(),
    first = vi.fn(),
    second = vi.fn();
  observeContentHeader(a.source, first);
  observeContentHeader(b.source, second);
  expect(first).toHaveBeenLastCalledWith({ target: a.slot, disabled: false });
  expect(second).toHaveBeenLastCalledWith({ target: b.slot, disabled: false });
  a.hide();
  callbacks[0]?.();
  expect(first).toHaveBeenLastCalledWith({ target: null, disabled: false });
  expect(second).toHaveBeenLastCalledWith({ target: b.slot, disabled: false });
});

it("shows a safe title, no empty menu, and an accessible chevron for commands", () => {
  const title = "<project>";
  const empty = renderToStaticMarkup(
    <ContentPageHeader title={title} ownerKey="a" portal={undefined} />,
  );
  expect(empty).toContain("&lt;project&gt;</span></h2>");
  expect(empty).not.toContain("<button");
  const run = vi.fn();
  const commands = renderToStaticMarkup(
    <ContentPageHeader
      title={title}
      ownerKey="a"
      portal={undefined}
      actions={[{ id: "refresh", label: "Refresh", disabled: true, reason: "Busy", run }]}
    />,
  );
  expect(commands).toContain('aria-label="&lt;project&gt; actions"');
  expect(commands).toContain('aria-haspopup="menu"');
  expect(commands).not.toContain(">Refresh</button>");
  expect(run).not.toHaveBeenCalled();
  expect(
    renderToStaticMarkup(<ContentHeaderSlot fallback="Sessions" icon="app-table" />),
  ).toContain("content-page-header-fallback");
});

it("includes navigation artwork even when an unavailable page uses its fallback header", () => {
  const html = renderToStaticMarkup(<ContentHeaderSlot fallback="Logs" icon="app-table" />);
  expect(html).toContain('data-icon="app-table"');
  expect(html).toContain('<span class="page-title-text">Logs</span>');
});
