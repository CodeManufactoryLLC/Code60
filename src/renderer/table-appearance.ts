import type { Theme } from "@glideapps/glide-data-grid";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { TableLines } from "./table-preferences.js";
import { resolveText, type TextStyles } from "./typography.js";

/** The grid draws on a canvas, so the app's CSS variables are resolved to concrete colors. */
export function useCssColors(): (name: string) => string {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((value) => value + 1);
    const observer = new MutationObserver(bump);
    // The typeface is a style property on the root element and may finish loading later.
    observer.observe(document.documentElement, {
      attributeFilter: ["data-theme", "data-color-scheme", "data-signals", "style"],
    });
    const media = matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", bump);
    const forced = matchMedia("(forced-colors: active)");
    forced.addEventListener("change", bump);
    document.fonts.addEventListener("loadingdone", bump);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", bump);
      forced.removeEventListener("change", bump);
      document.fonts.removeEventListener("loadingdone", bump);
    };
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: version re-reads colors after a theme change.
  return useMemo(() => {
    const style = getComputedStyle(document.documentElement);
    const colors = new Map<string, string>();
    const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    return (name: string) => {
      const cached = colors.get(name);
      if (cached) return cached;
      let value = style.getPropertyValue(name).trim();
      if (matchMedia("(forced-colors: active)").matches)
        value = /bg|surface|row-alt|fill/.test(name)
          ? "Canvas"
          : /accent|primary|chart/.test(name)
            ? "Highlight"
            : "CanvasText";
      if (context) {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = value;
        context.fillRect(0, 0, 1, 1);
        const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
        value = `rgb(${r}, ${g}, ${b})`;
      }
      colors.set(name, value);
      return value;
    };
  }, [version]);
}

/** Shared canvas colors, text roles and tracking for real tables and settings previews. */
export function useTableAppearance(textStyles: TextStyles, lines: TableLines) {
  const color = useCssColors();
  const heading = useMemo(() => resolveText(textStyles, "tableHeadings"), [textStyles]);
  const normal = useMemo(() => resolveText(textStyles, "normalText"), [textStyles]);
  const cellSize = textStyles.normalText.size ?? 12;
  const cellTheme = useMemo(() => ({ fontFamily: normal.family }), [normal.family]);
  const theme = useMemo<Partial<Theme>>(
    () => ({
      roundingRadius: 0,
      accentColor: color("--accent"),
      accentLight: color("--accent-bg"),
      textDark: color("--text"),
      textMedium: color("--muted"),
      textLight: color("--muted"),
      textHeader: color("--text"),
      textHeaderSelected: color("--text"),
      bgCell: color("--bg"),
      bgCellMedium: color("--surface-hover"),
      bgHeader: color("--surface-band"),
      bgHeaderHasFocus: color("--accent-bg"),
      bgHeaderHovered: color("--hover-bg"),
      borderColor: color("--border"),
      horizontalBorderColor: lines.horizontal ? color("--border") : "transparent",
      headerBottomBorderColor: lines.heading ? color("--border") : "transparent",
      fontFamily: heading.family,
      baseFontStyle: `${normal.weight} ${cellSize}px`,
      headerFontStyle: `${heading.weight} ${heading.size}px`,
    }),
    [color, lines.horizontal, lines.heading, heading, normal.weight, cellSize],
  );

  // Canvas text ignores CSS letter-spacing, so the typeface's tracking is applied while each cell
  // and header draws, converted to pixels for the grid's font sizes.
  const tracking = useMemo(() => {
    const draw =
      (pixels: number, spacing: string) =>
      ({ ctx }: { ctx: CanvasRenderingContext2D }, content: () => void) => {
        const em = spacing.endsWith("em") ? Number.parseFloat(spacing) : 0;
        ctx.letterSpacing = `${em * pixels}px`;
        content();
        ctx.letterSpacing = "0px";
      };
    return { cell: draw(cellSize, "normal"), header: draw(heading.size, heading.spacing) };
  }, [cellSize, heading]);
  // Both row tokens use the same resting fill in Light and Dark; selection is separate.
  const rowTheme = useMemo<Partial<Theme>>(() => ({ bgCell: color("--row-alt") }), [color]);
  const getRowThemeOverride = useCallback(
    (row: number) => (row % 2 === 1 ? rowTheme : undefined),
    [rowTheme],
  );
  return { color, heading, normal, cellSize, cellTheme, theme, tracking, getRowThemeOverride };
}
