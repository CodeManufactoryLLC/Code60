import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PanelShell } from "./panel-shell.js";

const render = (open: boolean, disabled = false) =>
  renderToStaticMarkup(
    <PanelShell
      disabled={disabled}
      tabs={[{ id: 1, label: "main.ts", title: "main.ts", icon: "document" }]}
      selectedId={1}
      onAction={() => 1}
      open={open}
      active
      onToggle={() => {}}
      name="Files"
      id="files"
      emptyLabel="No open file"
    >
      {() => <p>Retained preview</p>}
    </PanelShell>,
  );

describe("file panel shell", () => {
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
  it("keeps its closing action inside the expanded toolbar", () => {
    const html = render(true);
    expect(html).toContain('aria-hidden="false"');
    expect(html).not.toContain("file-panel-open");
    expect(html).toContain('title="Close files panel"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("Retained preview");
    expect(html.match(/aria-label="Toggle files panel"/g)).toHaveLength(1);
  });
});
