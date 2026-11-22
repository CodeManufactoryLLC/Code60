import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { ThemeToggle } from "./theme-toggle.js";

it.each([
  ["system", "System", "dark", "Dark", "eclipse"],
  ["dark", "Dark", "light", "Light", "night"],
  ["light", "Light", "system", "System", "sun"],
] as const)(
  "announces %s and activates the next saved theme",
  (theme, label, next, nextLabel, art) => {
    const onChange = vi.fn();
    const button = ThemeToggle({ theme, onChange });
    const html = renderToStaticMarkup(button);
    expect(html).toContain(`aria-label="Color theme: ${label}. Switch to ${nextLabel} mode"`);
    expect(html).toContain(`theme-${art}.png`);
    expect(html).toContain('alt="" aria-hidden="true"');
    expect(onChange).not.toHaveBeenCalled();
    button.props.onClick();
    expect(onChange).toHaveBeenCalledExactlyOnceWith(next);
  },
);
