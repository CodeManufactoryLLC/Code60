import type { ReactNode } from "react";
import type { PageAction } from "./content-page-header.js";
import {
  isSettingsSection,
  type PageId,
  pageDefinitions,
  type SettingsSectionId,
  settingsLabels,
} from "./navigation.js";
import { InfoTip } from "./overlays.js";
import { PageTitle } from "./page-title.js";

/** A Settings page header: its title, an optional explanation tooltip, and page-wide actions. */
export function SettingsHeader({
  id,
  page,
  tip,
  children,
  actions,
}: {
  id?: string;
  page: PageId | SettingsSectionId;
  tip?: string;
  children?: ReactNode;
  actions?: readonly PageAction[] | undefined;
}) {
  const title = isSettingsSection(page) ? settingsLabels[page] : pageDefinitions[page].label;
  return (
    <div className="settings-section-header">
      <div className="settings-title">
        <PageTitle
          page={page}
          as={isSettingsSection(page) ? "h1" : "h2"}
          id={id}
          actions={actions}
        />
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
