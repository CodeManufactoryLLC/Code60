import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../src/renderer/styles/tokens.css", import.meta.url), "utf8");
const rules = [...css.matchAll(/:root([^{]*)\{([^}]+)\}/g)];
const backgrounds = [
  "--bg",
  "--sidebar-background",
  "--content-background",
  "--composer-bg",
  "--composer-focus-bg",
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
  "--agent-bubble",
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
  it("uses flat pale blue and charcoal canvases with separate ink panel edges", () => {
    for (const [scheme, bg, surface, text, edge, primary] of [
      ["light", "#f4f8fe", "#ffffff", "#111111", "#111111", "#2563eb"],
      ["dark", "#111111", "#202020", "#f7f7f2", "#727272", "#2563eb"],
    ]) {
      const color = palette(scheme);
      expect(color("--bg")).toBe(bg);
      expect(color("--workspace-background")).toBe(bg);
      expect(color("--sidebar-background")).toBe(scheme === "light" ? "#f4f8fe" : bg);
      expect(color("--surface")).toBe(surface);
      expect(color("--content-background")).toBe(scheme === "light" ? "#ffffff" : surface);
      expect(color("--composer-bg")).toBe(scheme === "light" ? "#ffffff" : "#161616");
      expect(color("--composer-focus-bg")).toBe(scheme === "light" ? "#ffffff" : "#202020");
      expect(color("--text")).toBe(text);
      expect(color("--border")).toBe(edge);
      expect(color("--control-border")).toBe(scheme === "dark" ? "#aaaaaa" : edge);
      expect(color("--primary")).toBe(primary);
      if (scheme === "light") {
        expect(color("--card-header-fill")).toBe("#5494fd");
        expect(color("--card-header-text")).toBe("#ffffff");
        expect(color("--card-header-muted")).toBe("#e8eefb");
      }
      for (const token of ["--chat-neutral", "--row-alt"])
        expect(color(token), token).toBe(surface);
    }
    expect(
      rules.filter(([, selector]) => selector.trim() === '[data-color-scheme="dark"]'),
    ).toHaveLength(1);
    expect(css).not.toContain('[data-theme="dark"]');
    expect(css).not.toContain("gradient(");
  });

  it("gives dark mode deep plum header bands, ink frames and near-black reading planes", () => {
    const color = palette("dark");
    expect(color("--card-header-fill")).toBe("#2f1d37");
    expect(color("--card-header-text")).toBe("#f0e9f2");
    expect(color("--panel-border")).toBe("#050505");
    expect(color("--shadow-color")).toBe("#050505");
    expect(color("--field-fill")).toBe("#161616");
    expect(color("--hover-bg")).not.toBe(color("--accent-bg"));
    for (const token of ["--bg", "--surface", "--group-fill", "--code", "--field-fill"]) {
      const [r, g, b] = channels(color(token));
      expect(r, token).toBe(g);
      expect(g, token).toBe(b);
    }
    expect(css).toContain("--danger: #9b3a35");
    expect(css).toContain("--danger: #dfa69b");
  });

  it("keeps the running control contrasting at the dimmest pulse in both themes", () => {
    const jobs = readFileSync(
      new URL("../src/renderer/styles/automations.css", import.meta.url),
      "utf8",
    );
    const opacity = Number(
      jobs.match(/@keyframes automation-stop-pulse\s*\{\s*50%\s*\{\s*opacity:\s*([\d.]+)/)?.[1],
    );
    expect(Number.isFinite(opacity)).toBe(true);
    for (const scheme of ["light", "dark"]) {
      const color = palette(scheme);
      for (const fill of ["--primary", "--primary-hover"]) {
        const background = channels(color(fill));
        const foreground = channels(color("--primary-text"));
        const blended =
          "#" +
          foreground
            .map((value, i) =>
              Math.round(value * opacity + background[i] * (1 - opacity))
                .toString(16)
                .padStart(2, "0"),
            )
            .join("");
        expect(contrast(blended, color(fill)), `${scheme} pulse on ${fill}`).toBeGreaterThanOrEqual(
          3,
        );
      }
    }
  });

  it("keeps human messages distinct and primary labels legible in both schemes", () => {
    expect(palette("light")("--user-bubble")).toBe("#dbeafe");
    expect(palette("dark")("--user-bubble")).toBe("#35263e");
    for (const scheme of ["light", "dark"]) {
      const color = palette(scheme);
      expect(color("--agent-bubble")).not.toBe(color("--user-bubble"));
      expect(color("--agent-bubble")).not.toBe(color("--chat-neutral"));
    }
    expect(palette("light")("--primary-text")).toBe("#ffffff");
    expect(palette("dark")("--primary-text")).toBe("#ffffff");
  });

  for (const scheme of ["light", "dark"]) {
    it(`keeps text at 4.5:1 and control edges at 3:1 across ${scheme} reading surfaces`, () => {
      const color = palette(scheme);
      const textRatios = [];
      const edgeRatios = [];
      for (const background of backgrounds) {
        for (const foreground of ["--text", "--muted", "--control-border", "--group-border"]) {
          const ratio = contrast(color(foreground), color(background));
          expect(ratio, `${foreground} on ${background}`).toBeGreaterThanOrEqual(
            foreground.endsWith("border") ? 3 : 4.5,
          );
          (foreground.endsWith("border") ? edgeRatios : textRatios).push(ratio);
        }
      }
      for (const [foreground, background] of [
        ["--card-header-text", "--card-header-fill"],
        ["--card-header-muted", "--card-header-fill"],
        ["--primary-text", "--primary"],
        ["--human-text", "--chat-bg"],
        ["--on-user-bubble", "--user-bubble"],
        ["--on-agent-bubble", "--agent-bubble"],
        ["--primary-text", "--primary-hover"],
        ["--on-destructive", "--destructive"],
        ["--on-destructive", "--destructive-hover"],
        ["--project-stop-color", "--surface-band"],
        ["--on-destructive", "--project-stop-color"],
      ]) {
        // Light headers explicitly use the requested white-on-blue palette above.
        // Keep the general contrast target for reading surfaces and Dark headers.
        if (scheme === "light" && background === "--card-header-fill") continue;
        const ratio = contrast(color(foreground), color(background));
        expect(ratio, `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
        textRatios.push(ratio);
      }
      for (const background of backgrounds)
        expect(
          contrast(color("--focus-line"), color(background)),
          `focus on ${background}`,
        ).toBeGreaterThanOrEqual(3);
      console.info(
        `${scheme}: minimum text ${Math.min(...textRatios).toFixed(2)}:1, control edge ${Math.min(...edgeRatios).toFixed(2)}:1`,
      );
    });
  }

  it("keeps native alpha available for live sidebar transparency", () => {
    const main = readFileSync(new URL("../src/desktop/main.ts", import.meta.url), "utf8");
    expect(main).toContain("transparent: true");
    expect(main).toContain('backgroundColor: "#00000000"');
  });
});
