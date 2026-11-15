import { describe, expect, it } from "vitest";
import {
  defaultTextStyles,
  fontFamily,
  parseTextStyles,
  resolveText,
  textStyleProperties,
} from "./typography.js";

describe("independent card titles", () => {
  it("does not inherit saved or live page-title choices", () => {
    const styles = parseTextStyles(
      JSON.stringify({ pageTitles: { typeface: "georgia", size: 48, weight: 700, case: "upper" } }),
    );
    expect(resolveText(styles, "cardTitles")).toEqual(resolveText(defaultTextStyles, "cardTitles"));
    const page = resolveText(styles, "pageTitles");
    styles.cardTitles = { typeface: "ibm-plex-sans", size: 32, weight: 300, case: "lower" };
    const restored = parseTextStyles(JSON.stringify(styles));
    expect(restored).toEqual(styles);
    expect(resolveText(restored, "pageTitles")).toEqual(page);
    expect(textStyleProperties(restored)).toMatchObject({
      "--card-font": fontFamily("ibm-plex-sans"),
      "--card-size": "32px",
      "--card-weight": "300",
      "--card-case": "lowercase",
      "--title-size": "48px",
      "--title-weight": "700",
      "--title-case": "uppercase",
    });
    restored.cardTitles = {};
    expect(resolveText(restored, "cardTitles")).toEqual(
      resolveText(defaultTextStyles, "cardTitles"),
    );
    expect(resolveText(restored, "pageTitles")).toEqual(page);
  });
});

describe("IBM Plex Light", () => {
  it.each(["ibm-plex-sans", "ibm-plex-serif"] as const)(
    "restores Light for %s, including the 48pt page-title size",
    (typeface) => {
      const styles = parseTextStyles(
        JSON.stringify({
          pageTitles: { typeface, size: 64, weight: 300 },
          normalText: { typeface, weight: 300 },
        }),
      );
      expect(resolveText(styles, "pageTitles")).toMatchObject({
        family: fontFamily(typeface),
        size: 64,
        weight: 300,
      });
      expect(textStyleProperties(styles)).toMatchObject({
        "--title-size": "64px",
        "--title-weight": "300",
        "--text-weight": "300",
      });
      expect(parseTextStyles(JSON.stringify(styles))).toEqual(styles);
    },
  );
});
