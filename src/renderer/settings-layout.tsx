import type { ReactNode } from "react";
import { InfoTip } from "./overlays.js";

/** A Settings page header: its title, an optional explanation tooltip, and page-wide actions. */
export function SettingsHeader({
  id,
  title,
  tip,
  children,
}: {
  id?: string;
  title: string;
  tip?: string;
  children?: ReactNode;
}) {
  return (
    <div className="settings-section-header">
      <div className="settings-title">
        <h2 id={id}>{title}</h2>
        {tip && <InfoTip label={title}>{tip}</InfoTip>}
      </div>
      {children && <div className="settings-actions">{children}</div>}
    </div>
  );
}

/** A bordered card of settings rows, grouped under its optional title. */
export function SettingsCard({ title, children }: { title?: string; children: ReactNode }) {
  if (!title) return <div className="settings-card">{children}</div>;
  return (
    <fieldset className="settings-card">
      <legend className="settings-card-title">{title}</legend>
      {children}
    </fieldset>
  );
}
