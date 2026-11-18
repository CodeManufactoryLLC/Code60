export type Theme = "light" | "dark" | "system";
export function parseTheme(value: string | null): Theme {
  if (value === "paper") return "light";
  return value === "light" || value === "dark" ? value : "system";
}

export interface SidebarAppearance {
  opacity: number;
  blur: number;
}
export const defaultSidebarAppearance: Readonly<SidebarAppearance> = Object.freeze({
  opacity: 100,
  blur: 0,
});

export function parseSidebarAppearance(raw: string | null): SidebarAppearance {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object" || Array.isArray(value))
      return defaultSidebarAppearance;
    const record = value as Record<string, unknown>;
    const bounded = (key: keyof SidebarAppearance, max: number) => {
      const number = record[key];
      return typeof number === "number" && Number.isFinite(number)
        ? Math.round(Math.max(0, Math.min(max, number)))
        : defaultSidebarAppearance[key];
    };
    return { opacity: bounded("opacity", 100), blur: bounded("blur", 100) };
  } catch {
    return defaultSidebarAppearance;
  }
}

export function sidebarAppearanceProperties(appearance: SidebarAppearance): Record<string, string> {
  return {
    "--sidebar-background-opacity": `${appearance.opacity}%`,
  };
}

/** The selected preference and resolved scheme have distinct, single owners. */
export function observeColorScheme(
  theme: Theme,
  root: Pick<HTMLElement, "dataset">,
  system: Pick<MediaQueryList, "matches" | "addEventListener" | "removeEventListener">,
) {
  root.dataset.theme = theme;
  const update = () => {
    const dark = theme === "dark" || (theme === "system" && system.matches);
    root.dataset.colorScheme = dark ? "dark" : "light";
  };
  update();
  if (theme === "system") system.addEventListener("change", update);
  return () => {
    if (theme === "system") system.removeEventListener("change", update);
  };
}
const appearanceKeys = [
  "textStyles",
  "typeface",
  "theme",
  "tableLines",
  "rowDensity",
  "fitColumns",
  "signals",
  "gridCharts",
];
/** Reset every appearance setting once for the current theme, leaving other data intact. */
export function migrateAppearance(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
): void {
  if (storage.getItem("code60.appearanceVersion") === "theme-4") return;
  for (const key of appearanceKeys) storage.removeItem(`code60.${key}`);
  for (const table of ["sessions", "messages", "configurations", "worktrees", "polling"])
    storage.removeItem(`code60.tableView.v1:${table}`);
  storage.setItem("code60.appearanceVersion", "theme-4");
}
