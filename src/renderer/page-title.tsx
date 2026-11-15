import { createContext, type ReactNode, useContext } from "react";
import { Icon } from "./icons.js";
import { isSettingsSection, pageDefinitions, settingsIcons, settingsLabels } from "./navigation.js";
import { NavigationIcon } from "./navigation-icons.js";
import type { NavigationTarget } from "./navigation-tree.js";
import {
  type BreadcrumbSource,
  breadcrumbAncestors,
  type PageTitleId,
} from "./page-breadcrumbs.js";

export type { PageTitleId } from "./page-breadcrumbs.js";

export const PageTitleNavigationContext = createContext<
  (BreadcrumbSource & { open(target: NavigationTarget): Promise<boolean>; pending: boolean }) | null
>(null);

export function PageTitle({
  page,
  as: Heading = "h1",
  id,
  className,
  children,
  target,
  breadcrumbs = true,
}: {
  page: PageTitleId;
  as?: "h1" | "h2";
  id?: string | undefined;
  className?: string;
  children?: ReactNode;
  target?: NavigationTarget | undefined;
  breadcrumbs?: boolean;
}) {
  const navigation = useContext(PageTitleNavigationContext);
  const icon =
    page === "relay"
      ? "app-steering-wheel"
      : page === "orchestrator"
        ? "app-communication"
        : page === "worker"
          ? "app-down-right"
          : isSettingsSection(page)
            ? settingsIcons[page]
            : pageDefinitions[page].icon;
  const label =
    page === "relay"
      ? "Relay"
      : page === "orchestrator"
        ? "Chat"
        : page === "worker"
          ? "Subagent"
          : isSettingsSection(page)
            ? settingsLabels[page]
            : pageDefinitions[page].label;
  const heading = (
    <Heading id={id} className={className ? `page-title ${className}` : "page-title"}>
      {icon && <NavigationIcon name={icon} />}
      <span
        className={page === "home" && breadcrumbs ? "page-title-text sr-only" : "page-title-text"}
      >
        {children ?? label}
      </span>
    </Heading>
  );
  if (!breadcrumbs) return heading;
  const ancestors = breadcrumbAncestors(
    page,
    navigation ?? { projects: [], chats: [], runs: [] },
    target,
  );
  return (
    <nav className="page-breadcrumbs" aria-label="Breadcrumb">
      <ol>
        {ancestors.map(({ label, icon, target }, index) => {
          const home = target.kind === "page" && target.id === "home";
          return (
            <li key={`${target.kind}:${target.id}`}>
              {index > 0 && (
                <Icon name="chevron--right" className="carbon-icon breadcrumb-separator" />
              )}
              {navigation ? (
                <button
                  type="button"
                  className={home ? "breadcrumb-link breadcrumb-home" : "breadcrumb-link"}
                  title={home ? label : undefined}
                  disabled={
                    navigation.pending && target.kind !== "page" && target.kind !== "settings"
                  }
                  onClick={() => void navigation.open(target)}
                >
                  {icon && <NavigationIcon name={icon} />}
                  <span className={home ? "sr-only" : "breadcrumb-text"}>{label}</span>
                </button>
              ) : (
                <span className={home ? "breadcrumb-label breadcrumb-home" : "breadcrumb-label"}>
                  {icon && <NavigationIcon name={icon} />}
                  <span className={home ? "sr-only" : "breadcrumb-text"}>{label}</span>
                </span>
              )}
            </li>
          );
        })}
        <li aria-current="page">
          {ancestors.length > 0 && (
            <Icon name="chevron--right" className="carbon-icon breadcrumb-separator" />
          )}
          {heading}
        </li>
      </ol>
    </nav>
  );
}
