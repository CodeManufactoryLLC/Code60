import { createContext, isValidElement, type ReactNode, type RefObject, useContext } from "react";
import { ContentPageHeader, type PageAction } from "./content-page-header.js";
import {
  isSettingsSection,
  type PageId,
  pageDefinitions,
  type SettingsSectionId,
  settingsIcons,
  settingsLabels,
} from "./navigation.js";
import { NavigationIcon } from "./navigation-icons.js";
import type { NavigationTarget } from "./navigation-tree.js";

export type PageTitleId = PageId | SettingsSectionId | "relay" | "orchestrator" | "worker";
export const PageTitleNavigationContext = createContext<{
  header?: boolean;
  selectionPending?: boolean;
} | null>(null);

export function PageTitle({
  page,
  as: Heading = "h1",
  id,
  className,
  children,
  target,
  breadcrumbs = true,
  actions,
  actionsTrigger,
}: {
  page: PageTitleId;
  as?: "h1" | "h2";
  id?: string | undefined;
  className?: string;
  children?: ReactNode;
  target?: NavigationTarget | undefined;
  breadcrumbs?: boolean;
  actions?: readonly PageAction[] | undefined;
  actionsTrigger?: RefObject<HTMLButtonElement | null> | undefined;
}) {
  const navigation = useContext(PageTitleNavigationContext);
  const label =
    page === "relay"
      ? "Relay"
      : page === "orchestrator"
        ? "Agent"
        : page === "worker"
          ? "Subagent"
          : isSettingsSection(page)
            ? settingsLabels[page]
            : pageDefinitions[page].label;
  if (!breadcrumbs)
    return (
      <Heading id={id} className={className ? `page-title ${className}` : "page-title"}>
        <span className="page-title-text">{children ?? label}</span>
      </Heading>
    );
  const currentId = target
    ? `${target.kind}:${target.id}`
    : `${isSettingsSection(page) ? "settings" : "page"}:${page}`;
  const contentLabel =
    typeof children === "string" || typeof children === "number"
      ? String(children)
      : isValidElement<{ children?: ReactNode }>(children) &&
          typeof children.props.children === "string"
        ? children.props.children
        : label;
  return (
    <>
      <ContentPageHeader
        title={contentLabel}
        id={id}
        as={Heading}
        ownerKey={currentId}
        actions={actions}
        triggerRef={actionsTrigger}
        portal={navigation?.header}
        pending={navigation?.selectionPending}
      />
      <span className="page-breadcrumbs page-title-placeholder" aria-hidden="true" inert />
    </>
  );
}
