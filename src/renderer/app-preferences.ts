import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import {
  accentProperties,
  observeColorScheme,
  parseAccentColor,
  parseTheme,
  type Theme,
} from "./appearance.js";
import {
  parseFitColumns,
  parseRowDensity,
  parseTableLines,
  type RowDensity,
  type TableLines,
} from "./table-preferences.js";
import { parseChartTick } from "./ticker.js";
import { defaultTextStyles, parseTextStyles, type TextStyles } from "./typography.js";

const accentKey = "code60.accentColor";

export function useAppPreferences() {
  const [theme, setTheme] = useState<Theme>(() => parseTheme(localStorage.getItem("code60.theme")));
  const [accentColor, setSwatch] = useState(() =>
    parseAccentColor(localStorage.getItem(accentKey)),
  );
  const setAccentColor = (value: string) => {
    const color = parseAccentColor(value);
    localStorage.setItem(accentKey, color);
    setSwatch(color);
  };
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.storageArea === localStorage && (event.key === accentKey || event.key === null)) {
        setSwatch(parseAccentColor(localStorage.getItem(accentKey)));
      }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  useLayoutEffect(() => {
    for (const [name, value] of Object.entries(accentProperties(accentColor))) {
      document.documentElement.style.setProperty(name, value);
    }
  }, [accentColor]);
  const [storedText, setStoredText] = useState<TextStyles>(() =>
    parseTextStyles(localStorage.getItem("code60.textStyles")),
  );
  const textStyles = useMemo(
    () => ({ ...defaultTextStyles, normalText: { size: storedText.normalText.size } }),
    [storedText.normalText.size],
  );
  const setTextStyles = (next: TextStyles) => {
    const saved = {
      ...storedText,
      normalText: { ...storedText.normalText, size: next.normalText.size },
    };
    localStorage.setItem("code60.textStyles", JSON.stringify(saved));
    setStoredText(saved);
  };
  const [focusHighlight, setFocusHighlight] = useState(
    () => localStorage.getItem("code60.focusHighlight") === "on",
  );
  const [signals, setSignals] = useState(() => localStorage.getItem("code60.signals") === "on");
  const [charts, setCharts] = useState(() => localStorage.getItem("code60.gridCharts") !== "off");
  const [lines, setLines] = useState<TableLines>(() =>
    parseTableLines(localStorage.getItem("code60.tableLines")),
  );
  const [fit, setFit] = useState(() => parseFitColumns(localStorage.getItem("code60.fitColumns")));
  const [density, setDensity] = useState<RowDensity>(() =>
    parseRowDensity(localStorage.getItem("code60.rowDensity")),
  );
  const [chartTickMs, setChartTickMs] = useState(() =>
    parseChartTick(localStorage.getItem("code60.chartTickMs")),
  );
  useEffect(() => {
    localStorage.setItem("code60.chartTickMs", String(chartTickMs));
  }, [chartTickMs]);
  useLayoutEffect(() => {
    localStorage.setItem("code60.theme", theme);
    return observeColorScheme(
      theme,
      document.documentElement,
      window.matchMedia("(prefers-color-scheme: dark)"),
    );
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.fontSize = storedText.normalText.size
      ? `${storedText.normalText.size}px`
      : "";
  }, [storedText.normalText.size]);

  useEffect(() => {
    document.documentElement.dataset.focusHighlight = focusHighlight ? "on" : "off";
    localStorage.setItem("code60.focusHighlight", focusHighlight ? "on" : "off");
  }, [focusHighlight]);

  useEffect(() => {
    document.documentElement.dataset.signals = signals ? "on" : "off";
    localStorage.setItem("code60.signals", signals ? "on" : "off");
  }, [signals]);

  useEffect(() => {
    localStorage.setItem("code60.gridCharts", charts ? "on" : "off");
  }, [charts]);

  useEffect(() => {
    localStorage.setItem("code60.tableLines", JSON.stringify(lines));
  }, [lines]);

  useEffect(() => {
    localStorage.setItem("code60.rowDensity", density);
  }, [density]);

  useEffect(() => {
    localStorage.setItem("code60.fitColumns", String(fit));
  }, [fit]);

  return {
    theme,
    setTheme,
    accentColor,
    setAccentColor,
    textStyles,
    setTextStyles,
    focusHighlight,
    setFocusHighlight,
    signals,
    setSignals,
    charts,
    setCharts,
    lines,
    setLines,
    fit,
    setFit,
    density,
    setDensity,
    chartTickMs,
    setChartTickMs,
  };
}
