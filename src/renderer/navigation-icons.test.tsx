import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { pages, settingsSections } from "../bridge/index.js";
import { NavigationIcon } from "./navigation-icons.js";

it("renders static decorative Carbon glyphs for route and settings descriptors", () => {
  for (const { icon } of [...pages, ...settingsSections]) {
    if (!icon) continue;
    const markup = renderToStaticMarkup(<NavigationIcon name={icon} />);
    expect(markup).toContain("<svg");
    expect(markup).toContain(`data-icon="${icon}"`);
    expect(markup).toContain('aria-hidden="true"');
  }
});
