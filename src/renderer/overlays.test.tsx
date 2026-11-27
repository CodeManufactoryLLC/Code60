import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type Command, CommandPalette } from "./overlays.js";

const sampleCommands: Command[] = [
  {
    id: "home",
    label: "Home",
    group: "Pages",
    icon: "document",
    checked: true,
    run: () => {},
  },
  {
    id: "settings",
    label: "Settings",
    group: "Pages",
    icon: "settings",
    keys: "⌘,",
    run: () => {},
  },
  {
    id: "sessions",
    label: "Sessions",
    group: "Pages",
    icon: "document",
    disabled: true,
    reason: "Connect to a database first",
    run: () => {},
  },
  {
    id: "stop-all",
    label: "Stop all runs",
    group: "Project",
    icon: "stop",
    danger: true,
    run: () => {},
  },
];

describe("CommandPalette", () => {
  it("renders Carbon Search combobox and flat Carbon listbox rows instead of tertiary buttons", () => {
    const html = renderToStaticMarkup(
      <CommandPalette commands={sampleCommands} onClose={() => {}} />,
    );
    expect(html).toContain('aria-label="Command palette"');
    expect(html).toContain("cds--search-input");
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-label="Search commands"');
    expect(html).toContain('role="listbox"');
    expect(html).toContain('class="command-palette-group-label"');
    expect(html).toContain(">Pages</div>");
    expect(html).toContain(">Project</div>");
    expect(html).not.toContain("cds--btn--tertiary");
    expect(html).not.toContain("cds--btn--danger");
  });

  it("renders checked state, shortcut badge, destructive attribute, and disabled reason", () => {
    const html = renderToStaticMarkup(
      <CommandPalette commands={sampleCommands} onClose={() => {}} />,
    );
    expect(html).toContain('aria-label="Current"');
    expect(html).toContain('<kbd class="command-palette-kbd">⌘,</kbd>');
    expect(html).toContain('data-danger="true"');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('aria-description="Connect to a database first"');
    expect(html).toContain(
      '<span class="command-palette-reason">Connect to a database first</span>',
    );
    // Unfiltered resting state keeps the count visually quiet.
    expect(html).toContain('<span class="command-palette-count" aria-live="polite"></span>');
  });

  it("renders a quiet empty state when no commands are available", () => {
    const html = renderToStaticMarkup(<CommandPalette commands={[]} onClose={() => {}} />);
    expect(html).toContain("No matching commands.");
    expect(html).not.toContain('role="option"');
  });
});
