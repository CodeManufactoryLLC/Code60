import type { KeyboardEvent } from "react";
import type { AgentSetupSnapshot } from "../bridge/index.js";
import { AgentLogo } from "./agent-logo.js";
import { Icon } from "./icons.js";
import { NavigationIcon } from "./navigation-icons.js";
import { Card } from "./neobrutalism/card.js";
import { PrimaryProviderMark } from "./neobrutalism/provider-controls.js";
import type { ProviderManagement } from "./provider-management.js";
import { ProviderMenu } from "./provider-menu.js";

export function ProvidersSidebar({
  sidebarOpen = true,
  menuScope = "",
  setup,
  management,
  selectedId,
  active,
  expanded,
  onExpanded,
  onHome,
  onOpen,
  onKeyDown,
  onNext,
  onFirst,
  onLast,
}: {
  sidebarOpen?: boolean;
  menuScope?: string;
  setup: AgentSetupSnapshot | undefined;
  management: ProviderManagement | undefined;
  selectedId: string | undefined;
  active: boolean;
  expanded: boolean;
  onExpanded(open: boolean): void;
  onHome(): void;
  onOpen(id: string): void;
  onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void;
  onNext(): void;
  onFirst(): void;
  onLast(): void;
}) {
  return (
    <Card size="sm" className="sidebar-navigation-card providers-sidebar">
      <div
        className="sidebar-card-header"
        role="tablist"
        aria-label="Providers page"
        aria-orientation="vertical"
      >
        <div
          className="page-tab"
          role="presentation"
          data-nav-active={active && (!selectedId || !expanded)}
        >
          <button
            type="button"
            role="tab"
            id="tab-providers"
            className="page-group-toggle"
            aria-controls="panel-providers"
            aria-selected={active && !selectedId}
            title="Providers"
            onClick={onHome}
            onKeyDown={onKeyDown}
          >
            <NavigationIcon name="app-helmet" />
            <span className="page-tab-label">Providers</span>
          </button>
        </div>
      </div>
      <button
        type="button"
        className="icon-button provider-sidebar-add"
        aria-label="Add Provider"
        title={management?.addReason ?? "Add Provider"}
        aria-haspopup="dialog"
        disabled={!management || Boolean(management.addReason)}
        onClick={management?.add}
      >
        <span className="sidebar-card-add" aria-hidden="true">
          <Icon name="add" />
        </span>
      </button>
      <button
        type="button"
        className="icon-button sidebar-card-toggle"
        aria-label={`${expanded ? "Collapse" : "Expand"} Providers`}
        aria-controls="provider-pages"
        aria-expanded={expanded}
        onClick={() => onExpanded(!expanded)}
        onKeyDown={onKeyDown}
      >
        <span className="sidebar-card-chevron" aria-hidden="true">
          <Icon name="chevron--down" />
        </span>
      </button>
      {management?.error && (
        <p role="alert" className="error-banner">
          {management.error}
        </p>
      )}
      {/* biome-ignore lint/a11y/useSemanticElements: navigation group, not a form fieldset. */}
      <div
        id="provider-pages"
        role="group"
        aria-label="Connected providers"
        className="page-group-pages"
        hidden={!expanded}
        inert={!expanded}
        aria-hidden={!expanded}
        onKeyDown={(event) => {
          const buttons = [
            ...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:enabled"),
          ];
          const index = buttons.indexOf(event.target as HTMLButtonElement);
          if (index < 0) return;
          if (event.key === "ArrowLeft" || (event.key === "ArrowUp" && index === 0)) {
            event.preventDefault();
            if (event.key === "ArrowLeft") onExpanded(false);
            document.getElementById("tab-providers")?.focus();
          } else if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            if (event.key === "Home") return onFirst();
            if (event.key === "End") return onLast();
            const next = index + (event.key === "ArrowDown" ? 1 : -1);
            if (next >= buttons.length) onNext();
            else buttons[next]?.focus();
          }
        }}
      >
        {setup?.enabled.map((id) => {
          const provider = setup.providers.find((provider) => provider.id === id);
          if (!provider) return null;
          return (
            <div
              key={id}
              className="chat-sidebar-row provider-sidebar-row"
              data-nav-active={active && selectedId === id}
            >
              <button
                type="button"
                id={`provider-${id}`}
                className="chat-sidebar-entry"
                aria-current={active && selectedId === id ? "page" : undefined}
                aria-controls="panel-provider"
                onClick={() => onOpen(id)}
              >
                <span className="chat-sidebar-artwork" aria-hidden="true">
                  <AgentLogo id={provider.logo} />
                </span>
                <span className="chat-sidebar-label">{provider.name}</span>
              </button>
              {id === setup.primary && <PrimaryProviderMark compact />}
              {management && (
                <ProviderMenu
                  key={`${id}:${menuScope}`}
                  provider={id}
                  name={provider.name}
                  setup={setup}
                  management={management}
                  active={expanded && sidebarOpen}
                />
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
