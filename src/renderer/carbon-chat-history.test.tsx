import { describe, expect, it } from "vitest";
import type {
  CustomAgentSummary,
  DesktopRun,
  OpenProject,
  OrchestrationChat,
} from "../bridge/index.js";
import { buildChatHistorySections, filterChatHistoryItems } from "./chat-history-model.js";

const projectA: OpenProject = {
  id: "proj-a",
  path: "/work/alpha",
  active: true,
  chatIds: ["chat-1"],
  workerIds: ["worker-1", "worker-finished"],
};
const projectB: OpenProject = {
  id: "proj-b",
  path: "/work/beta",
  active: false,
  chatIds: [],
  workerIds: [],
};
const customAgents: CustomAgentSummary[] = [
  { id: "agent-1", name: "Reviewer", revision: 1, archived: false },
  { id: "agent-2", name: "Planner", revision: 1, archived: false },
  { id: "agent-archived", name: "Retired", revision: 1, archived: true },
];
const chats = [
  {
    kind: "relay",
    conversationId: "relay-1",
    workers: ["relay-worker"],
    workerLabels: { "relay-worker": "Triage" },
  },
  {
    kind: "relay",
    customAgentId: "agent-1",
    conversationId: "custom-conv-1",
    title: "Reviewer",
    run: { id: "custom-run-1", agent: "claude", status: "idle", turns: 1, pending: [] },
    workers: [],
  },
  {
    kind: "project",
    projectId: "proj-a",
    title: "API refactor",
    run: {
      id: "chat-1",
      agent: "claude",
      status: "idle",
      turns: 2,
      pending: [{ id: "p1", runId: "chat-1", toolCallId: "t1", kind: "execute", title: "Run" }],
    },
    workers: ["worker-1"],
    workerLabels: { "worker-1": "Backend worker" },
  },
] as unknown as OrchestrationChat[];
const runs = [
  {
    record: { id: "relay-worker", agent: "claude", status: "running" },
    relay: { conversationId: "relay-1" },
  },
  { record: { id: "worker-1", agent: "codex", status: "running" } },
  { record: { id: "worker-finished", agent: "codex", status: "finished" } },
] as unknown as DesktopRun[];

describe("chat history model", () => {
  it("groups Relay, Custom Assistants, Project chats, and workers in order", () => {
    const sections = buildChatHistorySections({
      chats,
      runs,
      openProjects: [projectA, projectB],
      customAgents,
      selectedId: "chat-1",
      chatOpen: true,
      database: "/db.sqlite",
      pending: false,
      unreadById: { "relay-1": 2 },
    });

    expect(sections.map((section) => section.title)).toEqual([
      "Relay",
      "Custom Assistants",
      "alpha",
      "beta",
    ]);

    expect(sections[0]?.items.map((item) => [item.id, item.label, item.kind])).toEqual([
      ["relay-1", "Relay (2 unread)", "relay"],
      ["relay-worker", "↳ Triage", "worker"],
    ]);

    expect(sections[1]?.items.map((item) => [item.id, item.label, item.target])).toEqual([
      ["custom-agent:agent-2", "Planner", { kind: "custom-agent", id: "agent-2" }],
      ["custom-run-1", "Reviewer", { kind: "conversation", id: "custom-run-1" }],
    ]);

    expect(
      sections[2]?.items.map((item) => ({
        id: item.id,
        label: item.label,
        selected: item.selected,
        canManage: item.canManage,
      })),
    ).toEqual([
      { id: "chat-1", label: "API refactor (1 waiting)", selected: true, canManage: true },
      { id: "worker-1", label: "↳ Backend worker", selected: false, canManage: false },
    ]);

    expect(sections[3]?.items).toEqual([
      expect.objectContaining({
        id: "new-session:proj-b",
        label: "New Session",
        kind: "new-project-session",
        target: { kind: "new-session", projectId: "proj-b" },
      }),
    ]);
  });

  it("filters across Relay, Custom Assistants, project chats, project names, and workers", () => {
    const sections = buildChatHistorySections({
      chats,
      runs,
      openProjects: [projectA, projectB],
      customAgents,
      selectedId: "relay-1",
      chatOpen: true,
      database: "/db.sqlite",
      pending: false,
    });

    expect(filterChatHistoryItems(sections, "   ")).toEqual([]);
    expect(filterChatHistoryItems(sections, "alpha").map((item) => item.id)).toEqual([
      "chat-1",
      "worker-1",
    ]);
    expect(filterChatHistoryItems(sections, "planner").map((item) => item.id)).toEqual([
      "custom-agent:agent-2",
    ]);
    expect(filterChatHistoryItems(sections, "triage").map((item) => item.id)).toEqual([
      "relay-worker",
    ]);
    // Placeholder "New Session" rows are excluded from search matches.
    expect(filterChatHistoryItems(sections, "beta")).toEqual([]);
  });

  it("disables database-dependent project rows while keeping Relay and Custom Assistants enabled", () => {
    const sections = buildChatHistorySections({
      chats,
      runs,
      openProjects: [projectA],
      customAgents,
      selectedId: "relay-1",
      chatOpen: true,
      database: null,
      pending: false,
    });

    expect(sections[0]?.items.every((item) => !item.disabled)).toBe(true);
    expect(sections[1]?.items.every((item) => !item.disabled)).toBe(true);
    expect(sections[2]?.items.every((item) => item.disabled && !item.canManage)).toBe(true);
  });
});
