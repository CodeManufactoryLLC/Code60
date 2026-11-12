import { useEffect, useLayoutEffect, useState } from "react";
import type { DesktopApi } from "../bridge/index.js";
import { observeColorScheme, parseTheme, type Theme } from "./appearance.js";
import {
  parseFitColumns,
  parseRowDensity,
  parseTableLines,
  type RowDensity,
  type TableLines,
} from "./table-preferences.js";
import { parseChartTick } from "./ticker.js";
import { transitionTimeProperties, useTransitionTimes } from "./transition-times.js";
import { parseTextStyles, type TextStyles, textStyleProperties } from "./typography.js";

export function useAppPreferences(api: DesktopApi, setError: (message: string) => void) {
  const [theme, setTheme] = useState<Theme>(() => parseTheme(localStorage.getItem("code60.theme")));
  const transitionTimes = useTransitionTimes();
  useLayoutEffect(() => {
    for (const [property, value] of Object.entries(transitionTimeProperties(transitionTimes)))
      document.documentElement.style.setProperty(property, value);
  }, [transitionTimes]);
  const [textStyles, setTextStyles] = useState<TextStyles>(() =>
    parseTextStyles(localStorage.getItem("code60.textStyles")),
  );
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
      api.setWindowTheme,
      setError,
    );
  }, [theme, api, setError]);

  useEffect(() => {
    for (const [key, value] of Object.entries(textStyleProperties(textStyles))) {
      if (value === undefined) document.documentElement.style.removeProperty(key);
      else document.documentElement.style.setProperty(key, value);
    }
    localStorage.setItem("code60.textStyles", JSON.stringify(textStyles));
  }, [textStyles]);

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
