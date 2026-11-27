import type {
  CustomAgentSummary,
  DesktopRun,
  OpenProject,
  OrchestrationChat,
} from "../bridge/index.js";
import { type Conversation, conversationId, conversations } from "./chats.js";
import type { NavigationTarget } from "./navigation-tree.js";
import { projectConversations } from "./navigation-tree.js";
import { pathLabel } from "./path-label.js";

type ChatHistoryTarget = NavigationTarget | { kind: "new-session"; projectId: string };

export interface ChatHistoryItem {
  id: string;
  label: string;
  rawLabel: string;
  kind: "relay" | "custom-agent" | "project-chat" | "worker" | "new-project-session";
  target: ChatHistoryTarget;
  groupLabel: string;
  selected: boolean;
  disabled: boolean;
  canManage: boolean;
  projectId?: string | undefined;
  projectPath?: string | undefined;
  unread: number;
  approvals: number;
}

export interface ChatHistorySection {
  id: string;
  title: string;
  kind: "relay" | "custom-agents" | "project";
  projectId?: string | undefined;
  projectPath?: string | undefined;
  items: ChatHistoryItem[];
}

export interface ChatHistoryModelInput {
  chats: readonly OrchestrationChat[];
  runs: readonly DesktopRun[];
  openProjects: readonly OpenProject[] | undefined;
  customAgents: readonly CustomAgentSummary[];
  selectedId: string | undefined;
  chatOpen: boolean;
  database: string | null;
  pending: boolean;
  unreadById?: Readonly<Record<string, number>> | undefined;
}

function itemLabel(
  rawLabel: string,
  role: "orchestrator" | "worker",
  unread: number,
  approvals: number,
): string {
  const base = role === "worker" ? `↳ ${rawLabel}` : rawLabel;
  const parts: string[] = [];
  if (unread > 0) parts.push(`${unread} unread`);
  if (approvals > 0) parts.push(`${approvals} waiting`);
  return parts.length > 0 ? `${base} (${parts.join(", ")})` : base;
}

export function buildChatHistorySections({
  chats,
  runs,
  openProjects,
  customAgents,
  selectedId,
  chatOpen,
  database,
  pending,
  unreadById = {},
}: ChatHistoryModelInput): ChatHistorySection[] {
  const sections: ChatHistorySection[] = [];
  const chatById = new Map(chats.map((chat) => [conversationId(chat), chat]));
  const runById = new Map(runs.map((run) => [run.record.id, run]));

  const toItem = (
    entry: Conversation,
    kind: ChatHistoryItem["kind"],
    groupLabel: string,
    project?: OpenProject,
  ): ChatHistoryItem => {
    const chat = chatById.get(entry.id);
    const worker = runById.get(entry.id);
    const view = chat?.run ?? worker?.view;
    const approvals = view?.pending.length ?? 0;
    const unread = entry.role === "worker" ? 0 : (unreadById[entry.id] ?? 0);
    const selected = chatOpen && entry.id === selectedId;
    const disabled = pending || (!database && chat?.kind !== "relay" && !worker?.relay);
    const canManage = entry.role === "orchestrator" && chat?.kind !== "relay" && !disabled;
    return {
      id: entry.id,
      rawLabel: entry.label,
      label: itemLabel(entry.label, entry.role, unread, approvals),
      kind: entry.role === "worker" ? "worker" : kind,
      target: { kind: "conversation", id: entry.id },
      groupLabel,
      selected,
      disabled,
      canManage,
      projectId: project?.id ?? chat?.projectId,
      projectPath: project?.path,
      unread,
      approvals,
    };
  };

  // 1. Built-in Relay and its workers
  const relay = chats.find((chat) => chat.kind === "relay" && !chat.customAgentId);
  if (relay) {
    const relayRuns = runs.filter((run) => run.relay?.conversationId === relay.conversationId);
    const entries = conversations([relay], relayRuns, selectedId);
    if (entries.length > 0) {
      sections.push({
        id: "history-relay",
        title: "Relay",
        kind: "relay",
        items: entries.map((entry) => toItem(entry, "relay", "Relay")),
      });
    }
  }

  // 2. Custom Assistants (alphabetically sorted) and their workers
  const activeCustomAgents = customAgents
    .filter((agent) => !agent.archived)
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    );
  if (activeCustomAgents.length > 0) {
    const items: ChatHistoryItem[] = [];
    for (const agent of activeCustomAgents) {
      const chat = chats.find((entry) => entry.customAgentId === agent.id);
      const id = chat && conversationId(chat);
      if (chat && id) {
        const agentRuns = runs.filter((run) => run.relay?.conversationId === chat.conversationId);
        const entries = conversations([chat], agentRuns, selectedId);
        for (const entry of entries) {
          items.push(toItem(entry, "custom-agent", "Custom Assistants"));
        }
      } else {
        items.push({
          id: `custom-agent:${agent.id}`,
          rawLabel: agent.name,
          label: agent.name,
          kind: "custom-agent",
          target: { kind: "custom-agent", id: agent.id },
          groupLabel: "Custom Assistants",
          selected: false,
          disabled: pending,
          canManage: false,
          unread: 0,
          approvals: 0,
        });
      }
    }
    if (items.length > 0) {
      sections.push({
        id: "history-custom-agents",
        title: "Custom Assistants",
        kind: "custom-agents",
        items,
      });
    }
  }

  // 3. Project chats and workers grouped by open project
  if (openProjects) {
    for (const project of openProjects) {
      const title = pathLabel(project.path);
      const entries = projectConversations(project, chats, runs, selectedId);
      const items: ChatHistoryItem[] = entries.map((entry) =>
        toItem(entry, "project-chat", title, project),
      );
      if (items.length === 0) {
        items.push({
          id: `new-session:${project.id}`,
          rawLabel: "New Session",
          label: "New Session",
          kind: "new-project-session",
          target: { kind: "new-session", projectId: project.id },
          groupLabel: title,
          selected: false,
          disabled: pending || !database,
          canManage: false,
          projectId: project.id,
          projectPath: project.path,
          unread: 0,
          approvals: 0,
        });
      }
      sections.push({
        id: `history-project-${project.id}`,
        title,
        kind: "project",
        projectId: project.id,
        projectPath: project.path,
        items,
      });
    }
  } else {
    const projectEntries = conversations(
      chats.filter((chat) => chat.kind !== "relay"),
      runs.filter((run) => !run.relay),
      selectedId,
    );
    if (projectEntries.length > 0) {
      sections.push({
        id: "history-projects",
        title: "Projects",
        kind: "project",
        items: projectEntries.map((entry) => toItem(entry, "project-chat", "Projects")),
      });
    }
  }

  return sections;
}

export function filterChatHistoryItems(
  sections: readonly ChatHistorySection[],
  query: string,
): ChatHistoryItem[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  const matches: ChatHistoryItem[] = [];
  for (const section of sections) {
    for (const item of section.items) {
      if (item.kind === "new-project-session") continue;
      const haystack = [item.rawLabel, item.label, item.groupLabel, item.projectPath ?? ""]
        .join(" ")
        .toLowerCase();
      if (haystack.includes(normalized)) matches.push(item);
    }
  }
  return matches;
}
