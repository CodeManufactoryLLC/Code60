import { describe, expect, it } from "vitest";
import type { HealthSnapshot, Snapshot, WorkflowSnapshot } from "../bridge/index.js";
import {
  collectApprovalAlerts,
  collectDraftPlanAlerts,
  collectFailedPlanAlerts,
  collectHealthAlerts,
  collectSchedulerExecutionAlerts,
  collectSchedulerLiveAlerts,
  collectWorkflowFailureAlert,
  collectWorkflowLiveAlerts,
  collectWorkspaceAlerts,
} from "./alert-producers.js";

function baseSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    revision: 1,
    database: "/tmp/db.sqlite",
    databaseError: null,
    projects: [],
    configurations: [],
    commands: [],
    directory: null,
    agents: [],
    defaultAgent: "codex",
    maxParallel: 4,
    turnTimeout: "15m",
    runs: [],
    liveIds: [],
    active: false,
    warnings: [],
    events: [],
    worktrees: null,
    files: null,
    polling: { paused: false, sources: [] },
    prompts: [],
    workers: [],
    versions: {
      code60: "0.5.0-beta",
      databaseSchema: 1,
      runRecordFormat: 1,
      acpProtocol: 1,
      mcpProtocol: "2025-03-26",
      electron: null,
      chromium: null,
      node: "24.0.0",
    },
    orchestration: { provider: "codex", allowAll: false, connection: "connected", error: null },
    chat: {
      kind: "relay",
      conversationId: "relay-1",
      run: null,
      directory: null,
      error: null,
      events: [],
      updates: { paused: false, pending: 0 },
    },
    chats: [],
    ...overrides,
  };
}

describe("alert producers", () => {
  it("collects pending approvals, draft plans, failed plans, and workspace issues from Snapshot", () => {
    const snapshot = baseSnapshot({
      databaseError: "Database file is locked",
      chats: [
        {
          kind: "relay",
          conversationId: "relay-1",
          historySaving: "unavailable",
          workerLabels: { "worker-1": "Refactor worker" },
          plans: [
            {
              id: "550e8400-e29b-41d4-a716-446655440001",
              chatId: "relay-1",
              project: null,
              revision: 1,
              proposalRevision: 1,
              title: "Add alerts",
              state: "draft",
              completed: 0,
              total: 3,
            },
            {
              id: "550e8400-e29b-41d4-a716-446655440002",
              chatId: "relay-1",
              project: null,
              revision: 2,
              proposalRevision: 1,
              title: "Broken deploy",
              state: "failed",
              completed: 1,
              total: 4,
            },
          ],
          run: {
            id: "relay-run-1",
            agent: "codex",
            status: "running",
            turns: 1,
            branch: null,
            worktree: "/tmp",
            pending: [
              {
                id: "relay-run-1#1",
                runId: "relay-run-1",
                toolCallId: "tc-1",
                title: "Run npm test",
                kind: "execute",
              },
            ],
            stopping: false,
          },
          directory: null,
          error: null,
          events: [],
          updates: { paused: false, pending: 0 },
        },
        {
          kind: "project",
          conversationId: "proj-conv-1",
          title: "Project chat",
          run: {
            id: "proj-run-1",
            agent: "codex",
            status: "running",
            turns: 1,
            branch: null,
            worktree: "/tmp/proj",
            pending: [
              {
                id: "proj-run-1#1",
                runId: "proj-run-1",
                toolCallId: "tc-3",
                title: "Write file",
                kind: "edit",
              },
            ],
            stopping: false,
          },
          directory: "/tmp/proj",
          error: null,
          events: [],
          updates: { paused: false, pending: 0 },
        },
        {
          kind: "relay",
          customAgentId: "custom-agent-1",
          conversationId: "custom-conv-1",
          title: "Reviewer",
          run: {
            id: "custom-run-1",
            agent: "codex",
            status: "running",
            turns: 1,
            branch: null,
            worktree: "/tmp",
            pending: [
              {
                id: "custom-run-1#1",
                runId: "custom-run-1",
                toolCallId: "tc-4",
                title: "Inspect git log",
                kind: "execute",
              },
            ],
            stopping: false,
          },
          directory: null,
          error: null,
          events: [],
          updates: { paused: false, pending: 0 },
        },
      ],
      openProjects: [
        {
          id: "550e8400-e29b-41d4-a716-446655440010",
          path: "/tmp/proj",
          active: false,
          chatIds: [],
          workerIds: ["worker-1"],
          workerSummaries: [
            {
              agentAlive: true,
              record: {
                id: "worker-1",
                agent: "codex",
                status: "running",
                firstPrompt: "work",
                ownerPid: 1234,
                startedAt: "2026-11-27T10:00:00.000Z",
                updatedAt: "2026-11-27T10:00:00.000Z",
                worktree: "/tmp/proj",
                branch: "main",
                base: "main",
                turns: 1,
                format: 1,
              } as unknown as Snapshot["runs"][number]["record"],
              view: {
                id: "worker-1",
                agent: "codex",
                status: "running",
                turns: 1,
                branch: "main",
                worktree: "/tmp/proj",
                pending: [
                  {
                    id: "worker-1#2",
                    runId: "worker-1",
                    toolCallId: "tc-2",
                    title: "Edit file",
                    kind: "edit",
                  },
                ],
                stopping: false,
              },
            },
          ],
        },
      ],
    });

    const approvals = collectApprovalAlerts(snapshot);
    expect(approvals).toHaveLength(4);
    expect(approvals[0]).toMatchObject({
      source: "approval",
      title: "Approval needed: Relay",
      detail: "Run npm test",
      target: { kind: "relay" },
    });
    expect(approvals[1]).toMatchObject({
      source: "approval",
      title: "Approval needed: Project chat",
      detail: "Write file",
      target: { kind: "conversation", id: "proj-run-1" },
    });
    expect(approvals[2]).toMatchObject({
      source: "approval",
      title: "Approval needed: Reviewer",
      detail: "Inspect git log",
      target: { kind: "custom-agent", id: "custom-agent-1" },
    });
    expect(approvals[3]).toMatchObject({
      source: "approval",
      title: "Approval needed: Refactor worker",
      target: { kind: "conversation", id: "worker-1" },
    });

    const drafts = collectDraftPlanAlerts(snapshot);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      source: "plan",
      title: "Plan ready for review: Add alerts",
      target: { kind: "relay" },
    });

    const failedPlans = collectFailedPlanAlerts(snapshot);
    expect(failedPlans).toHaveLength(1);
    expect(failedPlans[0]).toMatchObject({
      source: "plan",
      severity: "error",
      title: "Plan failed: Broken deploy",
    });

    const workspace = collectWorkspaceAlerts(snapshot);
    expect(workspace).toHaveLength(2);
    expect(workspace.map((item) => item.target)).toEqual([
      { kind: "page", id: "health-check" },
      { kind: "relay" },
    ]);
  });

  it("collects workflow, scheduler, and non-duplicate health alerts", () => {
    const wfId = "550e8400-e29b-41d4-a716-446655440020";
    const needsInput: WorkflowSnapshot = {
      runId: "550e8400-e29b-41d4-a716-446655440021",
      status: "needs_input",
      tasks: [{ index: 0, name: "Deploy", state: "needs_input" }],
      activeTaskIndex: 0,
      eventCursor: 5,
      decision: { id: "550e8400-e29b-41d4-a716-446655440022", text: "Approve production deploy?" },
      attempts: [],
      accepted: [],
    };
    expect(collectWorkflowLiveAlerts(wfId, "Release", needsInput)).toEqual([
      expect.objectContaining({
        source: "workflow",
        title: "Workflow needs input: Release",
        detail: "Approve production deploy?",
        target: { kind: "workflow", id: wfId },
      }),
    ]);
    expect(collectWorkflowFailureAlert(wfId, "Release", needsInput)).toBeNull();
    expect(
      collectWorkflowFailureAlert(wfId, "Release", {
        ...needsInput,
        status: "failed",
        reason: "Verifier rejected build",
      }),
    ).toMatchObject({
      source: "workflow",
      severity: "error",
      title: "Workflow failed: Release",
      detail: "Verifier rejected build",
    });

    expect(collectSchedulerLiveAlerts("Storage locked")).toHaveLength(1);
    expect(
      collectSchedulerExecutionAlerts([
        { id: "e1", automationName: "Nightly", status: "completed", reason: null },
        { id: "e2", automationName: "Nightly", status: "failed", reason: "exit 1" },
        { id: "e3", automationName: "Backup", status: "skipped", reason: "low_disk" },
      ]),
    ).toHaveLength(2);

    const health = {
      revision: 1,
      generatedAt: "2026-11-27T10:00:00.000Z",
      runningCount: 0,
      environment: {} as HealthSnapshot["environment"],
      checks: [
        {
          id: "database-health",
          group: "workspace",
          title: "Database",
          question: "OK?",
          mode: "passive",
          status: "error",
          summary: "Broken",
          checkedAt: null,
          running: false,
        },
        {
          id: "disk-space",
          group: "storage",
          title: "Disk space",
          question: "Free space?",
          mode: "passive",
          status: "error",
          summary: "Below 2 GiB",
          checkedAt: null,
          running: false,
          deepLink: { kind: "page", id: "health-check", label: "Health Check" },
        },
      ],
    } satisfies HealthSnapshot;

    const healthAlerts = collectHealthAlerts(health);
    expect(healthAlerts).toHaveLength(1);
    expect(healthAlerts[0]).toMatchObject({
      dedupeKey: "live:health:disk-space",
      source: "health",
      target: { kind: "page", id: "health-check" },
    });
  });
});
