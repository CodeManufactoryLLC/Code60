import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AUTOMATION_STATE_FORMAT,
  automationDraftSchema,
  automationEnvelopeSchema,
  automationScheduleSchema,
  branchNameSchema,
  parseAutomationState,
  rendererAutomationDraftSchema,
} from "../src/contracts/index.js";

const schedule = { type: "interval" as const, everyMinutes: 1, anchor: "2026-01-01T00:00:00Z" };

const promptDraft = {
  name: "Check",
  enabled: false,
  trigger: { type: "schedule" as const, schedule },
  action: {
    type: "prompt" as const,
    prompt: "Run checks",
    agent: "droid",
    repository: "/repo",
    baseBranch: "main",
    allow: ["read" as const],
    turnTimeout: "30m",
  },
};

const workflowDraft = {
  name: "Nightly workflow",
  enabled: true,
  trigger: { type: "schedule" as const, schedule },
  action: {
    type: "workflow" as const,
    provider: "claude",
    repository: "/repo",
    baseBranch: "main",
    tasks: [
      {
        name: "Run tests",
        instructions: "Run npm test and fix failures",
        verify: "Tests pass",
        checks: ["npm test"],
      },
    ],
    repairs: 2,
    retries: 1,
    autoApprove: true,
  },
};

describe("automation contracts", () => {
  it("validates prompt and workflow drafts without transforming saved timeouts", () => {
    const parsed = automationDraftSchema.parse(promptDraft);
    expect(parsed.action.type === "prompt" && parsed.action.turnTimeout).toBe("30m");
    expect(automationDraftSchema.parse(workflowDraft).action.type).toBe("workflow");
    for (const turnTimeout of ["", "0m", "oops", "9007199254740992h"]) {
      expect(
        automationDraftSchema.safeParse({
          ...promptDraft,
          action: { ...promptDraft.action, turnTimeout },
        }).success,
      ).toBe(false);
    }
  });

  it("rejects unknown fields and renderer filesystem capabilities", () => {
    expect(automationDraftSchema.safeParse({ ...promptDraft, shell: "bad" }).success).toBe(false);
    expect(rendererAutomationDraftSchema.safeParse(promptDraft).success).toBe(false);
    expect(rendererAutomationDraftSchema.safeParse(workflowDraft).success).toBe(false);
    const { repository: _promptRepo, ...rendererPromptAction } = promptDraft.action;
    expect(
      rendererAutomationDraftSchema.safeParse({ ...promptDraft, action: rendererPromptAction })
        .success,
    ).toBe(true);
    const { repository: _wfRepo, ...rendererWorkflowAction } = workflowDraft.action;
    expect(
      rendererAutomationDraftSchema.safeParse({ ...workflowDraft, action: rendererWorkflowAction })
        .success,
    ).toBe(true);
  });

  it("rejects unsafe branch names, permissions, oversized workflows and invalid schedules", () => {
    for (const branch of ["--help", "../main", "a.lock", "a/.hidden", "a..b", "a//b"])
      expect(branchNameSchema.safeParse(branch).success).toBe(false);
    expect(branchNameSchema.safeParse("feature/checks").success).toBe(true);
    for (const badSchedule of [
      { type: "daily", time: "25:00", timeZone: "UTC" },
      { type: "daily", time: "12:00", timeZone: "Not/AZone" },
      { type: "weekly", days: [1, 1], time: "12:00", timeZone: "UTC" },
      { type: "interval", everyMinutes: 0, anchor: "2026-01-01T00:00:00Z" },
      { type: "interval", everyMinutes: 10081, anchor: "2026-01-01T00:00:00Z" },
      { type: "interval", everyMinutes: 1, anchor: "tomorrow" },
    ])
      expect(automationScheduleSchema.safeParse(badSchedule).success).toBe(false);
    expect(
      automationDraftSchema.safeParse({
        ...promptDraft,
        action: { ...promptDraft.action, allow: ["execute", "execute"] },
      }).success,
    ).toBe(false);
    expect(
      automationDraftSchema.safeParse({
        ...workflowDraft,
        action: {
          ...workflowDraft.action,
          tasks: Array.from({ length: 10 }, (_, i) => ({
            name: `Task ${i}`,
            instructions: "x".repeat(30_000),
            verify: "ok",
            checks: [],
          })),
        },
      }).success,
    ).toBe(false);
  });

  it("upgrades legacy format 1 prompt state losslessly to format 2", () => {
    const automationId = randomUUID();
    const executionId = randomUUID();
    const legacy = {
      format: 1,
      revision: 3,
      sequence: 1,
      pausedAll: false,
      block: null,
      automations: [
        {
          id: automationId,
          revision: 2,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          name: "Legacy job",
          prompt: "Check repo",
          agent: "droid",
          providerHash: "a".repeat(64),
          repository: { path: "/repo", dev: "1", ino: "2" },
          baseBranch: "main",
          allow: ["read"],
          turnTimeout: "30m",
          schedule,
          enabled: true,
          nextRunAt: "2026-01-01T00:01:00.000Z",
        },
      ],
      executions: [
        {
          id: executionId,
          sequence: 1,
          automationId,
          automationName: "Legacy job",
          repository: { path: "/repo", dev: "1", ino: "2" },
          evidence: null,
          revision: 2,
          trigger: "schedule",
          scheduledFor: "2026-01-01T00:01:00.000Z",
          claimedAt: "2026-01-01T00:01:00.000Z",
          startedAt: "2026-01-01T00:01:00.000Z",
          endedAt: "2026-01-01T00:01:10.000Z",
          status: "finished",
          reason: null,
          runId: `auto-${randomUUID()}`,
          denials: 1,
          changedFiles: 3,
        },
      ],
    };
    const upgraded = parseAutomationState(legacy);
    expect(upgraded.format).toBe(AUTOMATION_STATE_FORMAT);
    expect(upgraded.automations[0]?.trigger).toEqual({ type: "schedule", schedule });
    expect(upgraded.automations[0]?.action).toMatchObject({
      type: "prompt",
      prompt: "Check repo",
      agent: "droid",
    });
    expect(upgraded.executions[0]?.actionType).toBe("prompt");
    expect(upgraded.executions[0]?.artifact).toMatchObject({
      type: "prompt",
      denials: 1,
      changedFiles: 3,
    });
  });

  it("requires protocol version, token and strict fixed actions", () => {
    const envelope = {
      v: 1,
      id: "00000000-0000-4000-8000-000000000001",
      token: "a".repeat(64),
      request: { action: "status" },
    };
    expect(automationEnvelopeSchema.safeParse(envelope).success).toBe(true);
    for (const change of [{ v: 2 }, { token: "" }, { request: { action: "exec", command: "bad" } }])
      expect(automationEnvelopeSchema.safeParse({ ...envelope, ...change }).success).toBe(false);
  });
});
