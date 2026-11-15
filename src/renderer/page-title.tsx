import { createContext, type ReactNode, useContext, useRef } from "react";
import { createPortal } from "react-dom";
import { conversationId, conversationTitle } from "./chats.js";
import { Icon } from "./icons.js";
import { isSettingsSection, pageDefinitions, settingsIcons, settingsLabels } from "./navigation.js";
import { NavigationIcon } from "./navigation-icons.js";
import type { NavigationTarget } from "./navigation-tree.js";
import {
  type BreadcrumbSource,
  breadcrumbAncestors,
  type PageTitleId,
} from "./page-breadcrumbs.js";
import { useBreadcrumbHeader } from "./page-title-header.js";

export type { PageTitleId } from "./page-breadcrumbs.js";

export const PageTitleNavigationContext = createContext<
  | (BreadcrumbSource & {
      open(target: NavigationTarget): Promise<boolean>;
      pending: boolean;
      header?: boolean;
    })
  | null
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
  const slot = useRef<HTMLElement>(null);
  const header = useBreadcrumbHeader(slot, breadcrumbs && navigation?.header === true);
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
  const trail = (leaf: ReactNode, interactive: boolean) => (
    <ol>
      {ancestors.map(({ label, icon, target }, index) => {
        const home = target.kind === "page" && target.id === "home";
        return (
          <li key={`${target.kind}:${target.id}`}>
            {index > 0 && (
              <Icon name="chevron--right" className="carbon-icon breadcrumb-separator" />
            )}
            {navigation && interactive ? (
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
        {leaf}
      </li>
    </ol>
  );
  const chat = target
    ? navigation?.chats.find((chat) => conversationId(chat) === target.id)
    : undefined;
  const placeholderLabel =
    typeof children === "string" || typeof children === "number"
      ? children
      : chat && navigation
        ? conversationTitle(navigation.chats, chat)
        : label;
  const placeholder = (
    <span className={className ? `page-title ${className}` : "page-title"}>
      {icon && <NavigationIcon name={icon} />}
      <span className={page === "home" ? "page-title-text sr-only" : "page-title-text"}>
        {placeholderLabel}
      </span>
    </span>
  );
  return (
    <>
      <nav
        ref={slot}
        className={header ? "page-breadcrumbs page-title-placeholder" : "page-breadcrumbs"}
        aria-label={header ? undefined : "Breadcrumb"}
        aria-hidden={header ? true : undefined}
        inert={header ? true : undefined}
      >
        {header ? trail(placeholder, false) : trail(heading, true)}
      </nav>
      {header &&
        createPortal(
          <nav className="page-breadcrumbs" aria-label="Breadcrumb">
            {trail(heading, true)}
          </nav>,
          header,
        )}
    </>
  );
}
