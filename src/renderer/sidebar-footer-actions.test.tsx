import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SidebarFooterActions } from "./sidebar-footer-actions.js";

function render(returnDisabled = false, databaseDisabled = false) {
  return renderToStaticMarkup(
    <SidebarFooterActions
      returnDisabled={returnDisabled}
      databaseDisabled={databaseDisabled}
      onReturn={() => {}}
      onDatabase={() => {}}
    />,
  );
}

describe("sidebar footer navigation", () => {
  it("places a labelled back arrow immediately before the database icon", () => {
    const html = render();
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(html.match(/<svg/g)).toHaveLength(2);
    expect(html).toContain('aria-label="return to splash page" title="return to splash page"');
    expect(html.indexOf("footer-splash")).toBeLessThan(html.indexOf("footer-database"));
    expect(html).toContain("M6.7 12.3 2.9 8.5 15 8.5");
    expect(html).not.toContain("disabled");
  });

  it("keeps return navigation available when switching databases is blocked by active runs", () => {
    const html = render(false, true);
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons[0]).not.toContain("disabled");
    expect(buttons[1]).toContain("disabled");
  });

  it("disables both controls while a conflicting action is pending", () => {
    for (const button of render(true, true).match(/<button[^>]*>/g) ?? [])
      expect(button).toContain("disabled");
  });
});
