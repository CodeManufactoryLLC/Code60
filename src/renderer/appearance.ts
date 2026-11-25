export type Theme = "light" | "dark" | "system";
export function parseTheme(value: string | null): Theme {
  if (value === "paper") return "light";
  return value === "light" || value === "dark" ? value : "system";
}

export const defaultAccentColor = "#43b3ae";

export function parseAccentColor(value: string | null): string {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : defaultAccentColor;
}

/** Keep the chosen hue readable on Carbon's light and dark layers. Mix in linear sRGB. */
export function accentProperties(color: string): Record<string, string> {
  const linear = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(color.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const [red = 0, green = 0, blue = 0] = linear;
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  function shade(target: number, endpoint: number) {
    const fraction = (target - luminance) / (endpoint - luminance);
    return (
      "#" +
      linear
        .map((channel) => {
          const mixed = channel + (endpoint - channel) * fraction;
          const srgb = mixed <= 0.0031308 ? 12.92 * mixed : 1.055 * mixed ** (1 / 2.4) - 0.055;
          return Math.round(srgb * 255)
            .toString(16)
            .padStart(2, "0");
        })
        .join("")
    );
  }
  return {
    "--code60-accent": color,
    "--code60-accent-ink": luminance > 0.13 ? shade(0.13, 0) : color,
    "--code60-accent-bright": luminance < 0.45 ? shade(0.45, 1) : color,
  };
}

export interface SidebarAppearance {
  opacity: number;
  blur: number;
}
const sidebarPercentageLimit = 100;
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
    const bounded = (key: keyof SidebarAppearance) => {
      const number = record[key];
      return typeof number === "number" && Number.isFinite(number)
        ? Math.round(Math.max(0, Math.min(sidebarPercentageLimit, number)))
        : defaultSidebarAppearance[key];
    };
    return { opacity: bounded("opacity"), blur: bounded("blur") };
  } catch {
    return defaultSidebarAppearance;
  }
}

export function sidebarAppearanceProperties(appearance: SidebarAppearance): Record<string, string> {
  return {
    "--window-background-opacity": `${appearance.opacity}%`,
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
