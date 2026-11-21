export interface IconAppearance {
  monochrome: boolean;
  color: string;
  contrast: number;
}

export const defaultIconAppearance: Readonly<IconAppearance> = Object.freeze({
  monochrome: false,
  color: "#808080",
  contrast: 100,
});

export function parseIconAppearance(raw: string | null): IconAppearance {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object" || Array.isArray(value)) return defaultIconAppearance;
    const record = value as Record<string, unknown>;
    return {
      monochrome: record.monochrome === true,
      contrast:
        typeof record.contrast === "number" && Number.isFinite(record.contrast)
          ? Math.round(Math.max(0, Math.min(200, record.contrast)))
          : defaultIconAppearance.contrast,
      color:
        typeof record.color === "string" && /^#[\da-f]{6}$/i.test(record.color)
          ? record.color.toLowerCase()
          : defaultIconAppearance.color,
    };
  } catch {
    return defaultIconAppearance;
  }
}

/** Remap luminance into dark, middle and light shades, retaining source alpha/motion. */
export function IconColorFilter({ color, contrast }: { color: string; contrast: number }) {
  // Preserve the original 65% spread at 100%, with useful adjustment on both sides.
  const spread = contrast <= 100 ? (contrast / 100) * 0.65 : 0.65 + ((contrast - 100) / 100) * 0.35;
  const channel = (offset: number) => {
    const value = Number.parseInt(color.slice(offset, offset + 2), 16) / 255;
    return `${value * (1 - spread)} ${value} ${value + (1 - value) * spread}`;
  };
  return (
    <svg className="icon-color-filter" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        <filter id="code60-icon-monochrome" colorInterpolationFilters="sRGB">
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncR type="table" tableValues={channel(1)} />
            <feFuncG type="table" tableValues={channel(3)} />
            <feFuncB type="table" tableValues={channel(5)} />
          </feComponentTransfer>
        </filter>
      </defs>
    </svg>
  );
}
