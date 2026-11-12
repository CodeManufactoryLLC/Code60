export const rowDensities = [
  { id: "high", label: "High", height: 24 },
  { id: "medium", label: "Medium", height: 32 },
  { id: "low", label: "Low", height: 44 },
] as const;
export type RowDensity = (typeof rowDensities)[number]["id"];
export function parseRowDensity(value: string | null): RowDensity {
  return rowDensities.find((density) => density.id === value)?.id ?? "high";
}
export function rowHeight(density: RowDensity): number {
  return rowDensities.find((entry) => entry.id === density)?.height ?? 32;
}
/** `heading` is the pair of lines directly above and below the column headings. */
/**
 * Scales column widths to fill `available` pixels, keeping their proportions. Widths are whole
 * pixels, the last column takes the rounding remainder, and none goes below `min`.
 */
export function fitWidths(widths: readonly number[], available: number, min = 20): number[] {
  const total = widths.reduce((sum, width) => sum + width, 0);
  if (!widths.length || total <= 0) return [...widths];
  if (available <= min * widths.length) return widths.map(() => min);
  const fitted = widths.map((width) => Math.max(min, Math.floor((width / total) * available)));
  const used = fitted.reduce((sum, width) => sum + width, 0);
  fitted[fitted.length - 1] = Math.max(min, (fitted.at(-1) ?? min) + available - used);
  return fitted;
}
export function parseFitColumns(value: string | null): boolean {
  return value === "true";
}
export type TableLines = { horizontal: boolean; vertical: boolean; heading: boolean };
/** Reads stored table line settings, keeping the defaults for anything missing or invalid. */
export function parseTableLines(value: string | null): TableLines {
  const lines: TableLines = { horizontal: false, vertical: false, heading: false };
  try {
    const stored: unknown = JSON.parse(value ?? "{}");
    if (stored && typeof stored === "object") {
      for (const key of ["horizontal", "vertical", "heading"] as const) {
        const setting = (stored as Record<string, unknown>)[key];
        if (typeof setting === "boolean") lines[key] = setting;
      }
    }
  } catch {}
  return lines;
}
