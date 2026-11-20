import { describe, expect, it } from "vitest";
import {
  defaultSidebarAppearance,
  observeColorScheme,
  parseSidebarAppearance,
  parseTheme,
  sidebarAppearanceProperties,
} from "./appearance.js";

describe("saved sidebar appearance", () => {
  it.each([null, "broken", "null", "[]", "42", '"opacity"'])(
    "uses readable defaults for invalid stored data: %s",
    (raw) => expect(parseSidebarAppearance(raw)).toEqual(defaultSidebarAppearance),
  );
  it("restores valid values, bounds both limits and rejects nonnumeric fields", () => {
    expect(parseSidebarAppearance('{"opacity":35,"blur":12}')).toEqual({ opacity: 35, blur: 12 });
    expect(parseSidebarAppearance('{"opacity":-20,"blur":180}')).toEqual({ opacity: 0, blur: 100 });
    expect(parseSidebarAppearance('{"opacity":200,"blur":-1}')).toEqual({ opacity: 100, blur: 0 });
    expect(parseSidebarAppearance('{"opacity":"0","blur":null}')).toEqual(defaultSidebarAppearance);
    expect(parseSidebarAppearance('{"opacity":51.5,"blur":1e999}')).toEqual({
      opacity: 52,
      blur: 0,
    });
    expect(sidebarAppearanceProperties({ opacity: 35, blur: 12 })).toEqual({
      "--sidebar-background-opacity": "35%",
    });
  });
});

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
