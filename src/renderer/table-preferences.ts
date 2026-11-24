export const rowDensities = [
  { id: "high", label: "High", height: 32 },
  { id: "medium", label: "Medium", height: 48 },
  { id: "low", label: "Low", height: 64 },
] as const;
export type RowDensity = (typeof rowDensities)[number]["id"];
export function parseRowDensity(value: string | null): RowDensity {
  return rowDensities.find((density) => density.id === value)?.id ?? "low";
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
