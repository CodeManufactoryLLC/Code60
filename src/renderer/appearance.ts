export type Theme = "light" | "dark" | "system";
export function parseTheme(value: string | null): Theme {
  if (value === "paper") return "light";
  return value === "light" || value === "dark" ? value : "system";
}

/** The selected preference and resolved scheme have distinct, single owners. */
export function observeColorScheme(
  theme: Theme,
  root: Pick<HTMLElement, "dataset">,
  system: Pick<MediaQueryList, "matches" | "addEventListener" | "removeEventListener">,
  nativeTheme: (dark: boolean) => Promise<void>,
  fail: (message: string) => void,
) {
  let alive = true;
  let revision = 0;
  root.dataset.theme = theme;
  const update = () => {
    const request = ++revision;
    const dark = theme === "dark" || (theme === "system" && system.matches);
    root.dataset.colorScheme = dark ? "dark" : "light";
    void nativeTheme(dark).catch((cause: unknown) => {
      if (alive && revision === request)
        fail(cause instanceof Error ? cause.message : String(cause));
    });
  };
  update();
  if (theme === "system") system.addEventListener("change", update);
  return () => {
    alive = false;
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
