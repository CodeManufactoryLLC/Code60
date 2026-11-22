import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PanelShell } from "./panel-shell.js";

const render = (open: boolean, disabled = false, active = true, closeButton = true) =>
  renderToStaticMarkup(
    <PanelShell
      disabled={disabled}
      tabs={[{ id: 1, label: "main.ts", title: "main.ts", icon: "document", closeButton }]}
      selectedId={1}
      onAction={() => 1}
      open={open}
      active={active}
      onToggle={() => {}}
      name="Files"
      id="files"
      emptyLabel="No open file"
    >
      {() => <p>Retained preview</p>}
    </PanelShell>,
  );

describe("file panel shell", () => {
  it("retains inactive contents without exposing a second panel toggle", () => {
    for (const open of [true, false]) {
      const html = render(open, false, false);
      expect(html).toContain("Retained preview");
      expect(html).not.toContain('aria-label="Toggle files panel"');
    }
  });
  it("disables file controls without a connected database", () => {
    for (const open of [true, false]) {
      const html = render(open, true);
      const buttons = html.match(/<button[^>]*>/g) ?? [];
      expect(buttons.length).toBeGreaterThan(0);
      expect(buttons.every((button) => button.includes("disabled"))).toBe(true);
      expect(html).not.toContain('draggable="true"');
    }
  });
  it("keeps closed content inert and the reopening action outside the panel", () => {
    const html = render(false);
    expect(html).toContain('aria-hidden="true" inert=""');
    expect(html).toContain('data-minimized="true"');
    expect(html).toMatch(/<\/aside><button[^>]*file-panel-open/);
    expect(html).toContain('aria-controls="files"');
    expect(html).toContain('title="Open files panel"');
    expect(html).toContain("Retained preview");
    expect(html.match(/aria-label="Toggle files panel"/g)).toHaveLength(1);
  });
  it("keeps its closing action outside the expanded panel for the shared card corner", () => {
    const html = render(true);
    expect(html).toContain('aria-hidden="false"');
    expect(html).not.toContain("file-panel-open");
    expect(html).toContain('title="Close files panel"');
    expect(html).toMatch(/<\/aside><button[^>]*file-panel-toggle/);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("Retained preview");
    expect(html.match(/aria-label="Toggle files panel"/g)).toHaveLength(1);
  });
});

it("keeps Close inside the named content region below the dropdown", () => {
  const html = render(true);
  expect(html).toContain('role="combobox"');
  expect(html).toContain('aria-label="Files view"');
  expect(html).not.toContain('aria-label="New file tab"');
  expect(html).toMatch(
    /<section class="file-panel-content"[^>]*><div class="file-panel-view-actions"><button[^>]*aria-label="Close current tab"/,
  );
  expect(html.slice(0, html.indexOf('<section class="file-panel-content"'))).not.toContain(
    'aria-label="Close current tab"',
  );
  expect(html).toContain('<section class="file-panel-content"');
  expect(html).toContain('aria-label="Files: main.ts"');
  expect(html).toContain(">main.ts</span>");
  expect(html).not.toMatch(/role="tab(list|panel)?"|draggable=/);
});

it("keeps the empty selector available without showing Close", () => {
  const html = renderToStaticMarkup(
    <PanelShell
      tabs={[]}
      selectedId={null}
      onAction={() => null}
      open
      active
      onToggle={() => {}}
      name="Files"
      id="files"
      emptyLabel="No open file"
    >
      {() => <p>Empty view</p>}
    </PanelShell>,
  );
  expect(html).toContain(">No open tabs</span>");
  const buttons = html.match(/<button[^>]*>/g) ?? [];
  expect(buttons.find((button) => button.includes('role="combobox"'))).not.toContain("disabled");
  expect(html).not.toContain('aria-label="Close current tab"');
});

it("omits the close symbol for main pages and blank views", () => {
  expect(render(true, false, true, false)).not.toContain('aria-label="Close current tab"');
});
