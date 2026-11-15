import type { ReactNode } from "react";
import { isSettingsSection } from "./navigation.js";
import { InfoTip } from "./overlays.js";
import { PageTitle, type PageTitleId } from "./page-title.js";

/** A Settings page header: its title, an optional explanation tooltip, and page-wide actions. */
export function SettingsHeader({
  id,
  title,
  page,
  tip,
  children,
  breadcrumbs,
}: {
  id?: string;
  title: string;
  page: PageTitleId;
  tip?: string;
  children?: ReactNode;
  breadcrumbs?: boolean;
}) {
  return (
    <div className="settings-section-header">
      <div className="settings-title">
        <PageTitle
          page={page}
          as={isSettingsSection(page) ? "h1" : "h2"}
          id={id}
          breadcrumbs={breadcrumbs ?? true}
        >
          {title}
        </PageTitle>
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
