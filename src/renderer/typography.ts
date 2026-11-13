const systemFont = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
export const defaultTypeface = {
  id: "d-din",
  label: "D-DIN",
  family: `"D-DIN", ${systemFont}`,
} as const;
export const typefaces = [
  { id: "system", label: "System", family: systemFont },
  { id: "computer-modern", label: "Computer Modern", family: '"CMU Serif", Georgia, serif' },
  defaultTypeface,
  { id: "georgia", label: "Georgia", family: "Georgia, serif" },
  { id: "ibm-plex-sans", label: "IBM Plex Sans", family: `"IBM Plex Sans", ${systemFont}` },
  { id: "ibm-plex-serif", label: "IBM Plex Serif", family: '"IBM Plex Serif", Georgia, serif' },
  { id: "lexend", label: "Lexend", family: `"Lexend", ${systemFont}` },
  { id: "shantell-sans", label: "Shantell Sans", family: '"Shantell Sans", sans-serif' },
  { id: "ocr-a", label: "OCR-A", family: '"OCR-A", ui-monospace, monospace' },
  { id: "roboto", label: "Roboto", family: `Roboto, ${systemFont}` },
  { id: "space-grotesk", label: "Space Grotesk", family: `"Space Grotesk", ${systemFont}` },
  { id: "tahoma", label: "Tahoma", family: `Tahoma, Verdana, ${systemFont}` },
  { id: "verdana", label: "Verdana", family: `Verdana, ${systemFont}` },
] as const;
export type Typeface = (typeof typefaces)[number]["id"];
export function parseTypeface(value: string | null): Typeface {
  return typefaces.find((typeface) => typeface.id === value)?.id ?? "system";
}
export function fontFamily(typeface: Typeface): string {
  return typefaces.find((entry) => entry.id === typeface)?.family ?? systemFont;
}
export function letterSpacing(typeface: Typeface): string {
  const entry: { family: string; letterSpacing?: string } | undefined = typefaces.find(
    (item) => item.id === typeface,
  );
  return entry?.letterSpacing ?? "normal";
}
export const monospaceFont = "ui-monospace, SFMono-Regular, Menlo, monospace";
/** Text that can be styled on its own. `size` and `weight` are the built-in defaults. */
export const textRoles = [
  { id: "tableHeadings", label: "Table Headings", css: "heading", size: 12, weight: 400 },
  { id: "buttons", label: "Button Text", css: "button", size: 13, weight: 400 },
  { id: "agentMessages", label: "Agent Chat Messages", css: "agent", size: 14, weight: 400 },
  { id: "humanMessages", label: "Human Chat Messages", css: "human", size: 14, weight: 400 },
  { id: "pageTitles", label: "Page Titles", css: "title", size: 18, weight: 400 },
  { id: "normalText", label: "Normal Text", css: "text", size: 13, weight: 400 },
] as const;
export type TextRole = (typeof textRoles)[number]["id"];
export const fontWeights = [
  { value: 400, label: "Regular" },
  { value: 500, label: "Medium" },
  { value: 600, label: "Semibold" },
  { value: 700, label: "Bold" },
] as const;
type FontWeight = (typeof fontWeights)[number]["value"];
export const fontSizes = { min: 8, max: 48 } as const;
/** A role's choices; anything left out keeps the built-in default. */
export type TextStyle = {
  typeface?: Typeface | undefined;
  size?: number | undefined;
  weight?: FontWeight | undefined;
  case?: "upper" | "lower" | "none" | undefined;
};
export type TextStyles = Record<TextRole, TextStyle>;
export const defaultTextStyles: TextStyles = {
  tableHeadings: {},
  buttons: {},
  agentMessages: {},
  humanMessages: {},
  pageTitles: {},
  normalText: {},
};
/** Reads stored text styles, dropping anything invalid. */
export function parseTextStyles(value: string | null): TextStyles {
  const styles: TextStyles = structuredClone(defaultTextStyles);
  let stored: unknown;
  try {
    stored = JSON.parse(value ?? "null");
  } catch {}
  if (!stored || typeof stored !== "object") return styles;
  for (const role of textRoles) {
    const entry = (stored as Record<string, unknown>)[role.id];
    if (!entry || typeof entry !== "object") continue;
    const { typeface, size, weight, case: textCase } = entry as Record<string, unknown>;
    const style = styles[role.id];
    const known = typefaces.find((item) => item.id === typeface)?.id;
    if (known) style.typeface = known;
    if (
      typeof size === "number" &&
      Number.isInteger(size) &&
      size >= fontSizes.min &&
      size <= fontSizes.max
    )
      style.size = size;
    const knownWeight = fontWeights.find((item) => item.value === weight)?.value;
    if (knownWeight) style.weight = knownWeight;
    if (textCase === "upper" || textCase === "lower" || textCase === "none") style.case = textCase;
  }
  return styles;
}
/** Legacy one-time typography reset, preserving sizes, case, theme and later choices. */
export function migrateTypography(storage: Pick<Storage, "getItem" | "setItem">): void {
  if (storage.getItem("code60.typographyVersion") === "d-din-regular-1") return;
  const styles = parseTextStyles(storage.getItem("code60.textStyles"));
  for (const role of textRoles) {
    delete styles[role.id].typeface;
    delete styles[role.id].weight;
  }
  storage.setItem("code60.textStyles", JSON.stringify(styles));
  storage.setItem("code60.typographyVersion", "d-din-regular-1");
}
/** The concrete text style a role draws with, after applying defaults. */
export type ResolvedText = {
  family: string;
  spacing: string;
  size: number;
  weight: FontWeight;
  case: TextStyle["case"];
};
export function resolveText(styles: TextStyles, role: TextRole): ResolvedText {
  const style = styles[role];
  const defaults = textRoles.find((entry) => entry.id === role) ?? textRoles[5];
  const typeface = style.typeface ?? defaultTypeface.id;
  return {
    family: fontFamily(typeface),
    spacing: letterSpacing(typeface),
    size: style.size ?? defaults.size,
    weight: style.weight ?? defaults.weight,
    case: style.case,
  };
}
export function applyCase(text: string, textCase: ResolvedText["case"]): string {
  if (textCase === "upper") return text.toUpperCase();
  if (textCase === "lower") return text.toLowerCase();
  return text;
}
/**
 * CSS custom properties for the text styles. Family, spacing, size, and weight are always set;
 * case only when chosen. Sent prompts use regular weight unless a weight is chosen.
 */
export function textStyleProperties(styles: TextStyles): Record<string, string | undefined> {
  const properties: Record<string, string | undefined> = {};
  for (const role of textRoles) {
    const resolved = resolveText(styles, role.id);
    const prefix = `--${role.css}`;
    properties[`${prefix}-font`] = resolved.family;
    properties[`${prefix}-spacing`] = resolved.spacing;
    properties[`${prefix}-tracking`] = resolved.spacing === "normal" ? undefined : resolved.spacing;
    properties[`${prefix}-size`] = `${resolved.size}px`;
    properties[`${prefix}-weight`] = String(resolved.weight);
    properties[`${prefix}-case`] =
      resolved.case === "upper"
        ? "uppercase"
        : resolved.case === "lower"
          ? "lowercase"
          : resolved.case === "none"
            ? "none"
            : undefined;
  }
  const human = styles.humanMessages.weight;
  properties["--human-prompt-weight"] = human ? String(human) : undefined;
  // Navigation has its own default size, but still honors an explicit Button Text size.
  properties["--nav-font-size"] = `${styles.buttons.size ?? 15}px`;
  return properties;
}
