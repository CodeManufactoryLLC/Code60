import type { CSSProperties } from "react";

// Track and start line from the Relay style guide; cars enlarged by 50%.
const track =
  "M109 51 H207.846 A58 58 0 0 1 248.858 67.988 L332.012 151.142 A58 58 0 0 1 349 192.154 V251 A58 58 0 0 1 291 309 H109 A58 58 0 0 1 51 251 V109 A58 58 0 0 1 109 51 Z";
const colors = ["#ff0000", "#ff902a", "#ffff00", "#42de5d", "#63a9ff", "#bd79ff"];

export function RelayNavigationIcon({ working }: { working: boolean }) {
  return (
    <svg
      className="navigation-icon relay-navigation-icon"
      data-state={working ? "working" : "ready"}
      viewBox="-3 -3 406 366"
      aria-hidden="true"
      focusable="false"
    >
      <path d={track} className="relay-track-edge" />
      <path d={track} className="relay-track" />
      <line x1="198" y1="10.5" x2="198" y2="91.5" className="relay-start-line" />
      {colors.map((color, index) => (
        <rect
          key={color}
          className="relay-car"
          x="-46.5"
          y="-33"
          width="93"
          height="66"
          rx="33"
          fill={color}
          style={
            {
              offsetPath: `path("${track}")`,
              "--relay-car-parked": `${52 - index * 97.5}px`,
              "--relay-car-lap": `${(index * -100) / colors.length}%`,
            } as CSSProperties
          }
        />
      ))}
    </svg>
  );
}
