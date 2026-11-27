import {
  Button,
  Header,
  HeaderMenuButton,
  HeaderName,
  SideNav,
  SideNavItems,
  SideNavMenu,
  SkipToContent,
} from "@carbon/react";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { OrchestrationChat } from "../bridge/index.js";
import type { Theme } from "./appearance.js";
import { Button as AppButton } from "./carbon/button.js";
import { Checkbox } from "./carbon/choices.js";
import { Select as CarbonSelect } from "./carbon/fields.js";
import { Icon } from "./icons.js";
import { Modal } from "./modal.js";
import {
  isSettingsSection,
  pageAvailable,
  pageDefinitions,
  settingsIcons,
  settingsLabels,
} from "./navigation.js";
import type { NavigationActions } from "./navigation-actions.js";
import { NavigationIcon } from "./navigation-icons.js";
import { sidebarPageElementId } from "./navigation-tree.js";
import { RelayPulse } from "./relay-pulse.js";
import type { PageId, PageTabs, SettingsSectionId } from "./tabs.js";

export function PageTabBar({
  relayListening = false,
  showRelayDot,
  onShowRelayDotChange,
  autoApproval = true,
  onAutoApprovalChange,
  commands,
  workspace,
  connected,
  theme,
  onThemeChange,
  tabs,
  settingsSection,
  onSelect,
  onOpenChat,
  onSettingsSectionSelect,
  navigation,
  chats,
  database,
  canGoBack = false,
  canGoForward = false,
  onBack = () => {},
  onForward = () => {},
}: {
  relayListening?: boolean;
  showRelayDot: boolean;
  onShowRelayDotChange(show: boolean): void;
  autoApproval?: boolean;
  onAutoApprovalChange?: ((enabled: boolean) => Promise<void>) | undefined;
  commands?(): void;
  workspace?(close: () => void): import("react").ReactNode;
  connected?: boolean | undefined;
  theme: Theme;
  onThemeChange(theme: Theme): void;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onBack?(): void;
  onForward?(): void;
  tabs: PageTabs;
  settingsSection: SettingsSectionId | null;
  onSelect(id: PageId): void;
  onOpenChat(): void;
  onSettingsSectionSelect(id: SettingsSectionId | null): void;
  navigation: Pick<NavigationActions, "busy">;
  chats: readonly OrchestrationChat[];
  database: string | null;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [utilities, setUtilities] = useState(false);
  const [autoApprovalSaving, setAutoApprovalSaving] = useState(false);
  const [autoApprovalError, setAutoApprovalError] = useState(false);
  const closeNavigation = () => setMobileOpen(false);
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 66rem)");
    const resize = () => {
      if (wide.matches) setMobileOpen(false);
    };
    wide.addEventListener("change", resize);
    return () => wide.removeEventListener("change", resize);
  }, []);
  return (
    <>
      <Header aria-label="Code60" className="product-header">
        <SkipToContent
          href={`#panel-${tabs.active}`}
          onClick={(event) => {
            event.preventDefault();
            document.getElementById(`panel-${tabs.active}`)?.focus();
          }}
        />
        <HeaderMenuButton
          aria-label={mobileOpen ? "Close product navigation" : "Open product navigation"}
          isActive={mobileOpen}
          aria-expanded={mobileOpen}
          aria-controls="navigation-sidebar"
          onClick={() => setMobileOpen(!mobileOpen)}
        />
        <HeaderName
          prefix=""
          href="#panel-home"
          onClick={(event) => {
            event.preventDefault();
            closeNavigation();
            onSelect("home");
          }}
        >
          Code60
        </HeaderName>
        <HistoryControls
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          onBack={onBack}
          onForward={onForward}
        />
        <Checkbox
          className="relay-dot-toggle"
          labelText="relay animation"
          hideLabel
          title="relay animation"
          checked={showRelayDot}
          onChange={(_event, { checked }) => onShowRelayDotChange(checked)}
        />
        <div className="product-header-center">
          <Checkbox
            className="auto-approve-toggle"
            labelText="auto-approve"
            title="Auto-approve permission requests across all orchestration chats and their workers"
            checked={autoApproval}
            disabled={autoApprovalSaving || !onAutoApprovalChange}
            onChange={async (_event, { checked }) => {
              if (!onAutoApprovalChange) return;
              setAutoApprovalSaving(true);
              setAutoApprovalError(false);
              try {
                await onAutoApprovalChange(checked);
              } catch {
                setAutoApprovalError(true);
              } finally {
                setAutoApprovalSaving(false);
              }
            }}
          />
          {autoApprovalError && (
            <span className="header-inline-error" role="alert">
              Could not save auto-approve. Try again.
            </span>
          )}
        </div>
        <div className="product-utilities">
          {connected !== undefined && (
            <span role="status">
              {connected ? "Backend connected" : "Reconnecting to backend…"}
            </span>
          )}
          <Button
            size="md"
            kind="ghost"
            onClick={commands}
            aria-haspopup="dialog"
            aria-keyshortcuts="Control+K Meta+K"
            title={
              typeof navigator !== "undefined" && navigator.platform.startsWith("Mac")
                ? "Commands (⌘K)"
                : "Commands (Ctrl+K)"
            }
            aria-label="Commands"
          >
            <Icon name="terminal" className="commands-icon" />
            <span className="commands-label">Commands</span>
          </Button>
          <Button size="md" kind="ghost" aria-haspopup="dialog" onClick={() => setUtilities(true)}>
            Workspace
          </Button>
        </div>
      </Header>
      <SideNav
        id="navigation-sidebar"
        aria-busy={navigation.busy || undefined}
        className="product-navigation"
        aria-label="Product navigation"
        expanded={mobileOpen}
        onOverlayClick={closeNavigation}
        onSideNavBlur={closeNavigation}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('[role="tab"]')) closeNavigation();
        }}
      >
        <div id="navigation-sidebar-content">
          {showRelayDot && (
            <RelayPulse
              chat={chats.find((chat) => chat.kind === "relay" && !chat.customAgentId)}
              connected={!!connected}
              listening={relayListening}
            />
          )}
          <PageTabList
            tabs={tabs}
            settingsSection={settingsSection}
            onSelect={onSelect}
            onOpenChat={onOpenChat}
            onSettingsSectionSelect={onSettingsSectionSelect}
            database={database}
          />
        </div>
      </SideNav>
      {utilities && (
        <Modal
          passive
          initialFocus=".cds--list-box button, select"
          busy={false}
          title="Workspace"
          onClose={() => setUtilities(false)}
        >
          <div className="product-workspace-actions">
            <CarbonSelect
              labelText="Color theme"
              aria-label="Color theme"
              value={theme}
              onChange={(e) => onThemeChange(e.target.value as Theme)}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </CarbonSelect>
            {workspace?.(() => setUtilities(false))}
          </div>
        </Modal>
      )}
    </>
  );
}

type HistoryDirection = "back" | "forward";

function HistoryControls({
  canGoBack,
  canGoForward,
  onBack,
  onForward,
}: {
  canGoBack: boolean;
  canGoForward: boolean;
  onBack(): void;
  onForward(): void;
}) {
  const back = useRef<HTMLButtonElement>(null);
  const forward = useRef<HTMLButtonElement>(null);
  // The browser drops focus as soon as a button becomes disabled, so remember which one the
  // user pressed and hand focus to its sibling, or to Chat, when it runs out of destinations.
  const pressed = useRef<HistoryDirection | undefined>(undefined);
  useEffect(() => {
    const direction = pressed.current;
    pressed.current = undefined;
    if (!direction) return;
    const [button, enabled, sibling, siblingEnabled] =
      direction === "back"
        ? [back.current, canGoBack, forward.current, canGoForward]
        : [forward.current, canGoForward, back.current, canGoBack];
    const focused = document.activeElement;
    if (enabled || (focused !== button && focused !== document.body && focused !== null)) return;
    (siblingEnabled ? sibling : document.getElementById("tab-chat"))?.focus();
  }, [canGoBack, canGoForward]);
  const press = (direction: HistoryDirection, go: () => void) => () => {
    pressed.current = direction;
    go();
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: a toolbar of two buttons, not a form fieldset.
    <div className="sidebar-history" role="group" aria-label="Navigation history">
      <AppButton
        ref={back}
        type="button"
        className="icon-button"
        aria-label="Back"
        title="Back"
        disabled={!canGoBack}
        onClick={press("back", onBack)}
      >
        <Icon name="arrow--left" />
      </AppButton>
      <AppButton
        ref={forward}
        type="button"
        className="icon-button"
        aria-label="Forward"
        title="Forward"
        disabled={!canGoForward}
        onClick={press("forward", onForward)}
      >
        <Icon name="arrow--right" />
      </AppButton>
    </div>
  );
}

const sidebarGroups = {
  Automate: ["automations", "workflows"],
  Connect: ["mcp-servers", "providers"],
  Customize: ["custom-agents", "prompts", "commands", "customize-mcp-servers"],
  Personalize: ["appearance", "table-defaults", "text"],
  Manage: [
    "about",
    "health-check",
    "heartbeat",
    "polling-settings",
    "system-manager",
    "updates",
    "usage",
  ],
  "Contributor Tools": ["episodic-memory", "rag"],
  Experiments: ["web-server"],
} as const satisfies Record<
  string,
  readonly (PageId | SettingsSectionId | "customize-mcp-servers")[]
>;

type NavigationGroup = keyof typeof sidebarGroups;
type GroupItem = (typeof sidebarGroups)[NavigationGroup][number];
type SidebarItem = "chat" | GroupItem;
const groupNames = Object.keys(sidebarGroups) as NavigationGroup[];

function NavigationSection({
  title,
  destination,
  children,
}: {
  title: NavigationGroup;
  destination: string | undefined;
  children: ReactNode;
}) {
  const button = useRef<HTMLButtonElement>(null);
  // Carbon owns disclosure state. Reveal an externally selected route through
  // its toggle, preserving any other open menus.
  useLayoutEffect(() => {
    if (destination && button.current?.getAttribute("aria-expanded") === "false")
      button.current.click();
  }, [destination]);
  return (
    <SideNavMenu
      id={`nav-group-${title.replaceAll(" ", "-")}`}
      title={title}
      ref={button}
      defaultExpanded={Boolean(destination)}
      isActive={Boolean(destination)}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) button.current?.focus();
      }}
    >
      <li
        className="product-nav-destinations"
        onKeyDown={(event) => {
          // Portal events bubble through React. Let a sidebar dialog handle its
          // own Escape without also closing the menu behind it.
          if (event.key === "Escape" && !event.currentTarget.contains(event.target as Node))
            event.stopPropagation();
        }}
      >
        {children}
      </li>
    </SideNavMenu>
  );
}

function PageTabList({
  tabs,
  settingsSection,
  onSelect,
  onOpenChat,
  onSettingsSectionSelect,
  database,
}: {
  tabs: PageTabs;
  settingsSection: SettingsSectionId | null;
  onSelect(id: PageId): void;
  onOpenChat(): void;
  onSettingsSectionSelect(id: SettingsSectionId | null): void;
  database: string | null;
}) {
  const [mcpItem, setMcpItem] = useState<"mcp-servers" | "customize-mcp-servers">("mcp-servers");
  function activeSidebarItem() {
    switch (tabs.active) {
      case "mcp-servers":
        return mcpItem;
      case "settings":
        return settingsSection;
      default:
        return tabs.active;
    }
  }
  const activeItem = activeSidebarItem();
  const destinationFor = (group: NavigationGroup) =>
    sidebarGroups[group].some((item) => item === activeItem)
      ? JSON.stringify([activeItem, tabs.active])
      : undefined;
  const visible: SidebarItem[] = [
    "chat",
    ...groupNames
      .flatMap<GroupItem>((group) => [...sidebarGroups[group]])
      .filter(
        (item) =>
          item === "customize-mcp-servers" ||
          isSettingsSection(item) ||
          pageAvailable(item, database),
      ),
  ];
  function moveTo(item: SidebarItem | undefined) {
    if (!item) return;
    const row = document.querySelector(`[data-sidebar-item="${item}"]`);
    const toggle = row?.closest("li[id^=nav-group-]")?.firstElementChild;
    if (toggle instanceof HTMLButtonElement && toggle.getAttribute("aria-expanded") === "false") {
      toggle.focus();
      return;
    }
    const button = row?.querySelector<HTMLButtonElement>('button[role="tab"]');
    if (button?.getAttribute("aria-selected") !== "true") button?.click();
    button?.focus();
  }
  function navigate(event: KeyboardEvent<HTMLButtonElement>, id: SidebarItem) {
    if (event.key === "ArrowLeft" && id !== "chat") {
      event.preventDefault();
      event.currentTarget
        .closest("li[id^=nav-group-]")
        ?.querySelector<HTMLButtonElement>(":scope > button")
        ?.focus();
      return;
    }
    const index = visible.indexOf(id);
    const next =
      event.key === "ArrowDown"
        ? (index + 1) % visible.length
        : event.key === "ArrowUp"
          ? (index - 1 + visible.length) % visible.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? visible.length - 1
              : undefined;
    if (next === undefined) return;
    event.preventDefault();
    moveTo(visible[next]);
  }
  function link(item: GroupItem) {
    const id = item === "customize-mcp-servers" ? "mcp-servers" : item;
    const setting = isSettingsSection(id);
    const label = setting ? settingsLabels[id] : pageDefinitions[id].label;
    const selected = activeItem === item;
    const panel = setting ? `panel-settings-${id}` : `panel-${id}`;
    const icon = setting ? settingsIcons[id] : pageDefinitions[id].icon;
    return (
      <div className="page-tab" data-nav-active={selected}>
        <AppButton
          type="button"
          role="tab"
          id={
            setting
              ? `tab-settings-${id}`
              : id === "mcp-servers" && item !== mcpItem
                ? "tab-mcp-servers-alternate"
                : sidebarPageElementId(id)
          }
          aria-controls={panel}
          aria-selected={selected}
          title={label}
          disabled={!setting && !pageAvailable(id, database)}
          tabIndex={0}
          onClick={() => {
            if (isSettingsSection(id)) {
              onSettingsSectionSelect(id);
              onSelect("settings");
            } else {
              if (item === "mcp-servers" || item === "customize-mcp-servers") setMcpItem(item);
              onSelect(id);
            }
          }}
          onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => navigate(event, item)}
        >
          {icon && <NavigationIcon name={icon} />}
          <span className="page-tab-label">{label}</span>
        </AppButton>
      </div>
    );
  }
  return (
    <SideNavItems className="page-tabs">
      <li className="cds--side-nav__item product-nav-chat" data-sidebar-item="chat">
        <div
          className="page-tab"
          role="tablist"
          aria-label="Chat"
          aria-orientation="vertical"
          data-nav-active={tabs.active === "chat"}
        >
          <AppButton
            type="button"
            role="tab"
            id="tab-chat"
            aria-controls="panel-chat"
            aria-selected={tabs.active === "chat"}
            title="Chat"
            tabIndex={0}
            onClick={onOpenChat}
            onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => navigate(event, "chat")}
          >
            <span className="page-tab-label">Chat</span>
          </AppButton>
        </div>
      </li>
      {groupNames.map((group) => (
        <NavigationSection key={group} title={group} destination={destinationFor(group)}>
          <div role="tablist" aria-label={group} aria-orientation="vertical">
            {sidebarGroups[group].map((item) => (
              <div key={item} data-sidebar-item={item}>
                {link(item)}
              </div>
            ))}
          </div>
        </NavigationSection>
      ))}
    </SideNavItems>
  );
}
