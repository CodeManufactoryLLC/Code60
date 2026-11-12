import { describe, expect, it, vi } from "vitest";
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
    const native = vi.fn(async () => {});
    const off = observeColorScheme("system", root, system, native, vi.fn());
    expect(root.dataset).toEqual({ theme: "system", colorScheme: "dark" });
    system.change(false);
    expect(root.dataset).toEqual({ theme: "system", colorScheme: "light" });
    off();
    system.change(true);
    expect(native.mock.calls).toEqual([[true], [false]]);
  });
  it("uses explicit appearance regardless of system changes and migrates Paper to Light", () => {
    const root = { dataset: {} as DOMStringMap };
    const system = media(true);
    const off = observeColorScheme(
      parseTheme("paper"),
      root,
      system,
      vi.fn(async () => {}),
      vi.fn(),
    );
    system.change(false);
    expect(root.dataset).toEqual({ theme: "light", colorScheme: "light" });
    off();
    observeColorScheme(
      "dark",
      root,
      system,
      vi.fn(async () => {}),
      vi.fn(),
    )();
    expect(root.dataset).toEqual({ theme: "dark", colorScheme: "dark" });
  });
  it("does not surface a native-theme failure from an obsolete choice", async () => {
    let reject!: (error: Error) => void;
    const fail = vi.fn();
    const off = observeColorScheme(
      "system",
      { dataset: {} },
      media(false),
      () =>
        new Promise<void>((_, no) => {
          reject = no;
        }),
      fail,
    );
    off();
    reject(new Error("obsolete"));
    await Promise.resolve();
    expect(fail).not.toHaveBeenCalled();
    observeColorScheme(
      "dark",
      { dataset: {} },
      media(false),
      async () => {
        throw new Error("Try again");
      },
      fail,
    );
    await Promise.resolve();
    expect(fail).toHaveBeenCalledWith("Try again");
  });
});
