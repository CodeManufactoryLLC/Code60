import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { defaultIconAppearance, IconColorFilter, parseIconAppearance } from "./icon-appearance.js";

describe("saved icon appearance", () => {
  it.each([null, "broken", "null", "[]", '"gray"', "42"])(
    "keeps colored icons and a gray picker for invalid storage: %s",
    (raw) => expect(parseIconAppearance(raw)).toEqual(defaultIconAppearance),
  );
  it("restores a strict boolean and six-digit color without accepting CSS or URLs", () => {
    expect(parseIconAppearance('{"monochrome":true,"color":"#3FA281"}')).toEqual({
      monochrome: true,
      color: "#3fa281",
      contrast: 100,
    });
    for (const color of ["gray", "#fff", "#12345678", "url(https://example.com)", 42, null])
      expect(parseIconAppearance(JSON.stringify({ monochrome: "on", color }))).toEqual(
        defaultIconAppearance,
      );
    expect(parseIconAppearance('{"monochrome":true}')).toEqual({
      ...defaultIconAppearance,
      monochrome: true,
    });
  });
  it("restores and bounds contrast without changing an older saved color or switch", () => {
    for (const [contrast, expected] of [
      [-20, 0],
      [250, 200],
      [132.5, 133],
      ["150", 100],
      [null, 100],
    ] as const) {
      expect(
        parseIconAppearance(JSON.stringify({ monochrome: true, color: "#335577", contrast })),
      ).toEqual({
        monochrome: true,
        color: "#335577",
        contrast: expected,
      });
    }
    expect(
      parseIconAppearance('{"monochrome":true,"color":"#335577","contrast":1e999}').contrast,
    ).toBe(100);
  });
  it("expands the same chosen midpoint from a flat color to the full shade range", () => {
    const stops = (contrast: number) => {
      const html = renderToStaticMarkup(<IconColorFilter color="#808080" contrast={contrast} />);
      return html
        .match(/<feFuncR[^>]*tableValues="([^"]+)"/)?.[1]
        ?.split(" ")
        .map(Number);
    };
    const midpoint = 128 / 255;
    expect(stops(0)).toEqual([midpoint, midpoint, midpoint]);
    expect(stops(200)).toEqual([0, midpoint, 1]);
    const normal = stops(100);
    expect(normal?.[0]).toBeCloseTo(midpoint * 0.35);
    expect(normal?.[1]).toBe(midpoint);
    expect(normal?.[2]).toBeCloseTo(midpoint + (1 - midpoint) * 0.65);
  });
  it("maps each channel through shaded color stops while retaining source alpha", () => {
    const html = renderToStaticMarkup(<IconColorFilter color="#ff0000" contrast={100} />);
    expect(html).toContain('aria-hidden="true" focusable="false"');
    expect(html).toContain('<feColorMatrix type="saturate" values="0"');
    expect(html).toContain('<feFuncR type="table" tableValues="0.35 1 1"');
    expect(html).toContain('<feFuncG type="table" tableValues="0 0 0.65"');
    expect(html).not.toContain("feFuncA");
  });
});
