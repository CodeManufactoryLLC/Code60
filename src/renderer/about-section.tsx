import { useId, useState } from "react";
import { CODE60_COPYRIGHT, type Versions } from "../bridge/index.js";
import { SettingsHeader } from "./settings-layout.js";
export function AboutSection({ versions }: { versions: Versions | undefined }) {
  const id = useId();
  const [copyStatus, setCopyStatus] = useState("");
  const rows = versions
    ? ([
        ["Code60", versions.code60],
        ["Database schema", versions.databaseSchema],
        ["Run record format", versions.runRecordFormat],
        ["ACP protocol", versions.acpProtocol],
        ["MCP protocol", versions.mcpProtocol],
        ["Electron", versions.electron ?? "Unavailable"],
        ["Chromium", versions.chromium ?? "Unavailable"],
        ["Node.js", versions.node],
      ] as const)
    : [];
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        [...rows.map(([label, value]) => `${label}: ${value}`), CODE60_COPYRIGHT].join("\n"),
      );
      setCopyStatus("Version info copied.");
    } catch {
      setCopyStatus("Could not copy version info.");
    }
  };
  return (
    <section className="settings-section" aria-labelledby={id}>
      <SettingsHeader id={id} title="About">
        <span className="settings-status" role="status">
          {copyStatus}
        </span>
        <button type="button" disabled={!versions} onClick={() => void copy()}>
          Copy version info
        </button>
      </SettingsHeader>
      <dl className="settings-card version-list">
        {rows.map(([label, value]) => (
          <div className="settings-row" key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="settings-note">
        <p>{CODE60_COPYRIGHT}</p>
        <p>Geometry animated icons created by Magnific - Flaticon</p>
      </div>
    </section>
  );
}
