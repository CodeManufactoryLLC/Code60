import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { TransitionSettings } from "./transition-settings.js";

it("offers four labelled sliders, exact 0–30000 ms fields, help and reset in Appearance", () => {
  const html = renderToStaticMarkup(<TransitionSettings />);
  expect(html).toContain("Transitions");
  expect(html).toContain("Reset transitions");
  expect(html.match(/type="range"/g)).toHaveLength(4);
  expect(html.match(/type="number" min="0" max="30000" step="1"/g)).toHaveLength(4);
  for (const label of ["Reply entrance", "Scroll response", "Activity fade", "Activity dropdown"]) {
    expect(html).toContain(label);
    expect(html).toContain(`aria-label="${label} in milliseconds"`);
  }
  expect(html.match(/aria-valuetext="175 ms"/g)).toHaveLength(4);
  expect(html).toContain("30 s");
  expect(html).toContain("System reduced motion");
});
