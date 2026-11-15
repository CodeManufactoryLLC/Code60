import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../src/renderer/styles/tokens.css", import.meta.url), "utf8");
const rules = [...css.matchAll(/:root([^{]*)\{([^}]+)\}/g)];
const backgrounds = [
  "--bg",
  "--surface",
  "--surface-hover",
  "--row-alt",
  "--code",
  "--chat-bg",
  "--field-fill",
  "--group-fill",
  "--surface-band",
  "--accent-bg",
  "--hover-bg",
];

function palette(scheme) {
  const tokens = new Map();
  for (const [, selector, body] of rules) {
    if (selector.trim() !== "" && selector.trim() !== `[data-color-scheme="${scheme}"]`) continue;
    for (const [, name, value] of body.matchAll(/(--[\w-]+):\s*([^;]+);/g))
      tokens.set(name, value.trim());
  }
  const color = (name, seen = []) => {
    if (seen.includes(name)) throw new Error(`Cyclic token ${name}`);
    const value = tokens.get(name);
    const reference = value?.match(/^var\((--[\w-]+)\)$/);
    if (reference) return color(reference[1], [...seen, name]);
    if (!/^#[\da-f]{6}$/i.test(value ?? "")) throw new Error(`Invalid color ${name}: ${value}`);
    return value.toLowerCase();
  };
  return color;
}

function channels(hex) {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
}

function luminance(hex) {
  const [r, g, b] = channels(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (values[1] + 0.05) / (values[0] + 0.05);
}

describe("application palette", () => {
  it("uses dark grays for resting surfaces, groups, selection and neutral details", () => {
    const color = palette("dark");
    expect(color("--bg")).toBe("#252525");
    expect(color("--group-fill")).toBe("#303030");
    expect(color("--accent-bg")).toBe("#3c3c3c");
    for (const token of [
      ...backgrounds.filter((token) => !["--surface-band", "--hover-bg"].includes(token)),
      "--chat-neutral",
      "--control-fill",
      "--disabled-fill",
      "--warning-bg",
      "--muted",
      "--border",
      "--control-border",
    ]) {
      const [r, g, b] = channels(color(token));
      expect(r, token).toBe(g);
      expect(g, token).toBe(b);
    }
    expect(luminance(color("--bg"))).toBeLessThan(0.03);
    expect(luminance(color("--group-fill"))).toBeGreaterThan(luminance(color("--surface")));
    expect(luminance(color("--accent-bg"))).toBeGreaterThan(luminance(color("--surface")));
  });

  it("retains restrained blue headers, hover fills, actions and focus", () => {
    const color = palette("dark");
    for (const token of ["--surface-band", "--hover-bg", "--primary", "--accent", "--focus-line"]) {
      const [r, g, b] = channels(color(token));
      expect(b, token).toBeGreaterThan(g);
      expect(g, token).toBeGreaterThan(r);
    }
    expect(luminance(color("--surface-band"))).toBeLessThan(0.08);
    expect(luminance(color("--hover-bg"))).toBeLessThan(0.08);
    expect(color("--primary")).toBe("#77b7f5");
  });

  it("preserves the Light palette and uses one resolved dark palette for Dark and System", () => {
    const color = palette("light");
    for (const token of backgrounds.filter(
      (token) => !["--accent-bg", "--hover-bg"].includes(token),
    ))
      expect(color(token), token).toBe("#ffffff");
    expect(color("--accent-bg")).toBe("#ededed");
    expect(color("--hover-bg")).toBe("#e5f0fc");
    expect(color("--primary")).toBe("#5b9fe6");
    expect(color("--accent")).toBe("#245f9e");
    expect(color("--text")).toBe("#000000");
    expect(color("--muted")).toBe("#555555");
    expect(color("--border")).toBe("#d0d0d0");
    expect(color("--control-border")).toBe("#777777");
    expect(
      rules.filter(([, selector]) => selector.trim() === '[data-color-scheme="dark"]'),
    ).toHaveLength(1);
    expect(css).not.toContain('[data-theme="dark"]');
  });

  for (const scheme of ["light", "dark"]) {
    it(`keeps text at 4.5:1 and control edges at 3:1 across every ${scheme} surface`, () => {
      const color = palette(scheme);
      const textRatios = [];
      const edgeRatios = [];
      for (const background of backgrounds) {
        for (const foreground of ["--text", "--muted", "--control-border"]) {
          const ratio = contrast(color(foreground), color(background));
          expect(ratio, `${foreground} on ${background}`).toBeGreaterThanOrEqual(
            foreground === "--control-border" ? 3 : 4.5,
          );
          (foreground === "--control-border" ? edgeRatios : textRatios).push(ratio);
        }
      }
      for (const [foreground, background] of [
        ["--primary-text", "--primary"],
        ["--human-text", "--chat-bg"],
      ]) {
        const ratio = contrast(color(foreground), color(background));
        expect(ratio, `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
        textRatios.push(ratio);
      }
      console.info(
        `${scheme}: minimum text ${Math.min(...textRatios).toFixed(2)}:1, control edge ${Math.min(...edgeRatios).toFixed(2)}:1`,
      );
    });
  }

  it("matches the dark native window and title-bar background to the renderer", () => {
    const main = readFileSync(new URL("../src/desktop/main.ts", import.meta.url), "utf8");
    const native = main.match(/color: dark \? "(#[\da-f]+)" : "#ffffff"/i)?.[1];
    const window = main.match(/backgroundColor: transparent \? "#00000000" : "(#[\da-f]+)"/i)?.[1];
    expect(native).toBe(palette("dark")("--bg"));
    expect(window).toBe(palette("dark")("--bg"));
  });
});
