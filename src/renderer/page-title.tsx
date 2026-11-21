import {
  cloneElement,
  createContext,
  isValidElement,
  type ReactNode,
  useContext,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import { isSettingsSection, pageDefinitions, settingsIcons, settingsLabels } from "./navigation.js";
import { NavigationIcon } from "./navigation-icons.js";
import type { NavigationTarget } from "./navigation-tree.js";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList } from "./neobrutalism/breadcrumb.js";
import { Combobox } from "./neobrutalism/combobox.js";
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
      selectionPending?: boolean;
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
        ? "Agent"
        : page === "worker"
          ? "Subagent"
          : isSettingsSection(page)
            ? settingsLabels[page]
            : pageDefinitions[page].label;
  const chatBreadcrumb = breadcrumbs && (page === "orchestrator" || page === "worker");
  const title = chatBreadcrumb
    ? isValidElement<{ children?: ReactNode }>(children)
      ? cloneElement(children, undefined, label)
      : label
    : (children ?? label);
  const heading = (
    <Heading id={id} className={className ? `page-title ${className}` : "page-title"}>
      {icon && <NavigationIcon name={icon} />}
      <span
        className={page === "home" && breadcrumbs ? "page-title-text sr-only" : "page-title-text"}
      >
        {title}
      </span>
    </Heading>
  );
  if (!breadcrumbs) return heading;
  const ancestors = breadcrumbAncestors(
    page,
    navigation ?? { projects: [], chats: [], runs: [] },
    target,
  );
  const currentId = target
    ? `${target.kind}:${target.id}`
    : `${isSettingsSection(page) ? "settings" : "page"}:${page}`;
  const currentLabel = chatBreadcrumb
    ? label
    : typeof children === "string" || typeof children === "number"
      ? String(children)
      : label;
  const options = [
    ...ancestors.map((ancestor) => ({
      id: `${ancestor.target.kind}:${ancestor.target.id}`,
      label: ancestor.label,
      icon: ancestor.icon && <NavigationIcon name={ancestor.icon} />,
      disabled:
        !navigation ||
        (navigation.pending &&
          ancestor.target.kind !== "page" &&
          ancestor.target.kind !== "settings"),
    })),
    { id: currentId, label: currentLabel, icon: icon && <NavigationIcon name={icon} /> },
  ];
  const rename =
    chatBreadcrumb && isValidElement<{ children?: ReactNode; className?: string }>(children)
      ? cloneElement(children, { className: "page-selector-rename" }, "Rename")
      : null;
  const placeholder = (
    <span className={className ? `page-title ${className}` : "page-title"}>
      {icon && <NavigationIcon name={icon} />}
      <span className="page-title-text">{currentLabel}</span>
    </span>
  );
  const selector = (
    <BreadcrumbList>
      <BreadcrumbItem aria-current="page" data-breadcrumb-key={currentId}>
        <Heading
          id={id}
          className={className ? `page-title ${className}` : "page-title"}
          aria-label={currentLabel}
        >
          <Combobox
            label="Current page"
            value={currentId}
            options={options}
            disabled={navigation?.selectionPending === true}
            onSelect={(id) => {
              const ancestor = ancestors.find(({ target }) => `${target.kind}:${target.id}` === id);
              if (ancestor && navigation) void navigation.open(ancestor.target);
            }}
          />
        </Heading>
        {rename}
      </BreadcrumbItem>
    </BreadcrumbList>
  );
  return (
    <>
      <Breadcrumb
        ref={slot}
        className={header ? "page-breadcrumbs page-title-placeholder" : "page-breadcrumbs"}
        aria-label={header ? undefined : "Page navigation"}
        aria-hidden={header ? true : undefined}
        inert={header ? true : undefined}
      >
        {header ? placeholder : selector}
      </Breadcrumb>
      {header &&
        createPortal(
          <Breadcrumb
            className="page-breadcrumbs"
            aria-label="Page navigation"
            inert={navigation?.selectionPending}
            aria-busy={navigation?.selectionPending || undefined}
          >
            {selector}
          </Breadcrumb>,
          header,
        )}
    </>
  );
}
