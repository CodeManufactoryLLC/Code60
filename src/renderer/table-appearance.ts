import { useEffect, useMemo, useState } from "react";

/** Monaco requires concrete color values rather than CSS token references. */
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
