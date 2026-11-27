import {
  HistoryContent,
  HistoryHeader,
  HistoryPanel,
  HistoryPanelItem,
  HistoryPanelItems,
  HistoryPanelMenu,
  HistorySearchItem,
  HistoryShell,
  HistoryToolbar,
} from "@carbon/ai-chat-components/es/react/history/index.js";
import Archive16 from "@carbon/icons/es/archive/16.js";
import Edit16 from "@carbon/icons/es/edit/16.js";
import { useMemo, useState } from "react";
import type { OpenProject } from "../bridge/index.js";
import { Button as AppButton } from "./carbon/button.js";
import {
  type ChatHistoryItem,
  type ChatHistorySection,
  filterChatHistoryItems,
} from "./chat-history-model.js";
import { Icon } from "./icons.js";
import { Modal } from "./modal.js";
import type { NavigationActions } from "./navigation-actions.js";
import { pathLabel } from "./path-label.js";

export interface CarbonChatHistoryProps {
  sections: readonly ChatHistorySection[];
  collapsedGroups: ReadonlySet<string>;
  openProjects: readonly OpenProject[];
  database: string | null;
  navigation: NavigationActions;
  onClose(): void;
  onOpenProject(): void;
}

export default function CarbonChatHistory({
  sections,
  collapsedGroups,
  openProjects,
  database,
  navigation,
  onClose,
  onOpenProject,
}: CarbonChatHistoryProps) {
  const [query, setQuery] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [newChatOpen, setNewChatOpen] = useState(false);

  const searching = query.trim().length > 0;
  const searchMatches = useMemo(
    () => (searching ? filterChatHistoryItems(sections, query) : []),
    [sections, query, searching],
  );
  const searchAttributes = useMemo(
    () => ({
      "label-text": "Search chats",
      placeholder: "Search chats",
      value: query,
      "close-button-label-text": "Clear search",
    }),
    [query],
  );

  const activateItem = (item: ChatHistoryItem) => {
    if (item.disabled || renamingId === item.id) return;
    if (item.target.kind === "new-session") {
      void navigation.chatAction({ type: "new", projectId: item.target.projectId });
      return;
    }
    void navigation.open(item.target);
  };

  const renderPanelItem = (item: ChatHistoryItem) => {
    const actions = item.canManage
      ? [
          {
            text: "Rename",
            icon: Edit16,
            disabled: navigation.pending,
            onClick: () => {},
          },
          {
            text: "Archive",
            icon: Archive16,
            delete: true,
            disabled: navigation.pending,
            onClick: () => {},
          },
        ]
      : [];
    const elementId =
      item.kind === "custom-agent" && item.id.startsWith("custom-agent:")
        ? item.id
        : item.kind === "new-project-session"
          ? item.id
          : `conversation-${item.id}`;
    return (
      <HistoryPanelItem
        key={item.id}
        id={elementId}
        data-conversation-id={item.id}
        name={renamingId === item.id ? item.rawLabel : item.label}
        selected={item.selected}
        rename={renamingId === item.id}
        actions={actions}
        overflowMenuLabel={`Actions for ${item.rawLabel}`}
        onSelected={() => activateItem(item)}
        onMenuAction={(event: Event) => {
          const detail = (event as CustomEvent<{ action?: string }>).detail;
          if (detail?.action === "Rename") {
            setRenamingId(item.id);
          } else if (detail?.action === "Archive") {
            setRenamingId(null);
            void navigation.chatAction({ type: "archive", id: item.id });
          }
        }}
        onRenameSave={(event: Event) => {
          const newName = (event as CustomEvent<{ newName?: string }>).detail?.newName?.trim();
          setRenamingId(null);
          if (newName && newName !== item.rawLabel) {
            void navigation.chatAction({ type: "rename", id: item.id, title: newName });
          }
        }}
        onRenameCancel={() => setRenamingId(null)}
      >
        {!item.canManage && <span slot="actions" hidden />}
      </HistoryPanelItem>
    );
  };

  return (
    <>
      <HistoryShell className="carbon-chat-history-shell">
        <HistoryHeader
          headerTitle="Chats"
          showCloseAction
          closeButtonLabel="Close chat history"
          onClose={onClose}
        />
        <HistoryToolbar
          newChatLabel="New chat"
          searchAttributes={searchAttributes}
          onSearchInput={(event: Event) => {
            const detail = (event as CustomEvent<{ value?: string }>).detail;
            setQuery(typeof detail?.value === "string" ? detail.value : "");
          }}
          onNewChatClick={() => setNewChatOpen(true)}
        />
        <HistoryContent
          resultsLabel="Results"
          resultsCount={searching ? searchMatches.length : undefined}
        >
          {navigation.error && (
            <p className="error-banner chat-history-error" role="alert">
              {navigation.error}
            </p>
          )}
          <HistoryPanel expanded isNotChildOfHeader>
            <HistoryPanelItems>
              {searching ? (
                searchMatches.length > 0 ? (
                  searchMatches.map((item) => (
                    <HistorySearchItem
                      key={item.id}
                      id={item.id}
                      name={item.label}
                      date={item.groupLabel}
                      onSelected={() => activateItem(item)}
                    />
                  ))
                ) : (
                  <p className="chat-history-empty">No matching chats.</p>
                )
              ) : (
                sections.flatMap((section) =>
                  section.kind === "custom-agents" ||
                  (section.kind === "relay" && section.items.length === 1 && section.items[0])
                    ? section.items.map(renderPanelItem)
                    : [
                        <HistoryPanelMenu
                          key={section.id}
                          title={section.title}
                          data-history-group={section.title}
                          data-history-section-id={section.id}
                          expanded={!collapsedGroups.has(section.id)}
                        >
                          {section.kind === "project" && <Icon name="folder" slot="title-icon" />}
                          {section.items.map(renderPanelItem)}
                        </HistoryPanelMenu>,
                      ],
                )
              )}
            </HistoryPanelItems>
          </HistoryPanel>
        </HistoryContent>
      </HistoryShell>
      {newChatOpen && (
        <Modal
          passive
          title="New chat"
          busy={navigation.pending}
          onClose={() => setNewChatOpen(false)}
        >
          <div className="chat-history-new-modal">
            {openProjects.length > 0 ? (
              <div className="chat-history-project-list">
                <p className="chat-history-modal-heading">Open projects</p>
                <ul className="chat-history-projects" aria-label="Open projects">
                  {openProjects.map((project) => {
                    const name = pathLabel(project.path);
                    return (
                      <li key={project.id} className="chat-history-project-row">
                        <div className="chat-history-project-meta">
                          <span className="chat-history-project-name">{name}</span>
                          <span className="chat-history-project-path" title={project.path}>
                            {project.path}
                          </span>
                        </div>
                        <div className="chat-history-project-actions">
                          <AppButton
                            type="button"
                            disabled={navigation.pending || !database}
                            onClick={() => {
                              setNewChatOpen(false);
                              void navigation.chatAction({
                                type: "new",
                                projectId: project.id,
                              });
                            }}
                          >
                            <Icon name="add" />
                            New Session
                          </AppButton>
                          <AppButton
                            type="button"
                            variant="quiet"
                            className="destructive"
                            disabled={navigation.pending}
                            aria-label={`Close Project ${name}`}
                            onClick={() => {
                              setNewChatOpen(false);
                              void navigation.projectAction({
                                type: "stop-folder",
                                projectId: project.id,
                              });
                            }}
                          >
                            Close Project
                          </AppButton>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : (
              <p className="chat-history-modal-empty">
                {database
                  ? "Open a project folder to start a project session."
                  : "Connect to a database to open a project folder."}
              </p>
            )}
            <div className="chat-history-modal-footer">
              <AppButton
                type="button"
                className="primary"
                disabled={navigation.pending}
                onClick={() => {
                  setNewChatOpen(false);
                  onOpenProject();
                }}
              >
                <Icon name="folder" />
                {database ? "Open Project Folder" : "Connect to database"}
              </AppButton>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
