import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { IconAnimationToggle } from "./icon-animation-toggle.js";

it.each([true, false])(
  "exposes the icon playback state (%s) without changing it on render",
  (enabled) => {
    const onChange = vi.fn();
    const button = IconAnimationToggle({ enabled, saved: true, onChange });
    const html = renderToStaticMarkup(button);
    expect(html).toContain('aria-label="Icon animations"');
    expect(html).toContain(`aria-pressed="${enabled}"`);
    expect(html).toContain("animation-wheel.png");
    expect(html.includes("animation-block.svg")).toBe(!enabled);
    expect(onChange).not.toHaveBeenCalled();
    button.props.onClick();
    expect(onChange).toHaveBeenCalledExactlyOnceWith(!enabled);
  },
);

it("announces a failed preference write without disabling the retry button", () => {
  const html = renderToStaticMarkup(
    <IconAnimationToggle enabled={false} saved={false} onChange={() => {}} />,
  );
  expect(html).toContain('role="alert"');
  expect(html).toContain("could not be saved");
  expect(html).toContain("toggle again to retry");
  expect(html).not.toContain("disabled=");
});
