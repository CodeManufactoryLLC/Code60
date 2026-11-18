import { describe, expect, it } from "vitest";
import { observeColorScheme, parseTheme } from "./appearance.js";

function media(matches: boolean) {
  const events = new EventTarget();
  return {
    matches,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    change(dark: boolean) {
      this.matches = dark;
      events.dispatchEvent(new Event("change"));
    },
  };
}
describe("resolved appearance lifecycle", () => {
  it("retains System while following live changes, and detaches on disposal", () => {
    const system = media(true);
    const root = { dataset: {} as DOMStringMap };
    const off = observeColorScheme("system", root, system);
    expect(root.dataset).toEqual({ theme: "system", colorScheme: "dark" });
    system.change(false);
    expect(root.dataset).toEqual({ theme: "system", colorScheme: "light" });
    off();
    system.change(true);
    expect(root.dataset.colorScheme).toBe("light");
  });
  it("uses explicit appearance regardless of system changes and migrates Paper to Light", () => {
    const root = { dataset: {} as DOMStringMap };
    const system = media(true);
    const off = observeColorScheme(parseTheme("paper"), root, system);
    system.change(false);
    expect(root.dataset).toEqual({ theme: "light", colorScheme: "light" });
    off();
    observeColorScheme("dark", root, system)();
    expect(root.dataset).toEqual({ theme: "dark", colorScheme: "dark" });
  });
});
