import type {
  AlertTarget,
  DesktopRun,
  HealthDeepLink,
  HealthSnapshot,
  OrchestrationChat,
  Snapshot,
  WorkflowSnapshot,
} from "../bridge/index.js";
import { pages, settingsSections } from "../bridge/index.js";
import type { AlertInput } from "./alerts.js";

const PAGE_ID_SET = new Set<string>(pages.map((page) => page.id));
const SETTINGS_ID_SET = new Set<string>(settingsSections.map((section) => section.id));

export const ALERT_PREFIXES = {
  approval: "live:approval:",
  planDraft: "live:plan-draft:",
  workspace: "live:workspace:",
  mcp: "live:mcp:",
  automation: "live:automation:",
  health: "live:health:",
  workflowPrefix: (recordId: string) => `live:workflow:${recordId}:`,
} as const;

function chatIdentifier(chat: OrchestrationChat): string | undefined {
  return chat.run?.id ?? (chat.kind === "relay" ? chat.conversationId : undefined);
}

function chatAlertTarget(chat: OrchestrationChat): AlertTarget | undefined {
  if (chat.kind === "relay") {
    if (chat.customAgentId) return { kind: "custom-agent", id: chat.customAgentId };
    return { kind: "relay" };
  }
  const id = chatIdentifier(chat);
  return id ? { kind: "conversation", id } : undefined;
}

function chatDisplayLabel(chat: OrchestrationChat): string {
  if (chat.title?.trim()) return chat.title.trim();
  if (chat.kind === "relay" && !chat.customAgentId) return "Relay";
  return "Chat";
}

function workerDisplayLabel(run: DesktopRun, chats: readonly OrchestrationChat[]): string {
  for (const chat of chats) {
    const label = chat.workerLabels?.[run.record.id];
    if (label?.trim()) return label.trim();
  }
  return run.view?.agent || run.record.agent || "Worker";
}

function collectRunsFromSnapshot(snapshot: Snapshot): DesktopRun[] {
  const byId = new Map<string, DesktopRun>();
  for (const project of snapshot.openProjects ?? []) {
    for (const run of project.workerSummaries ?? []) {
      byId.set(run.record.id, run);
    }
  }
  for (const run of snapshot.runs) {
    byId.set(run.record.id, run);
  }
  return [...byId.values()];
}

export function collectApprovalAlerts(snapshot: Snapshot): AlertInput[] {
  const alerts: AlertInput[] = [];
  const seen = new Set<string>();

  for (const chat of snapshot.chats) {
    const run = chat.run;
    const target = chatAlertTarget(chat);
    if (!run || !target || !run.pending.length) continue;
    const label = chatDisplayLabel(chat);
    for (const permission of run.pending) {
      const dedupeKey = `${ALERT_PREFIXES.approval}${run.id}:${permission.id}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      alerts.push({
        dedupeKey,
        source: "approval",
        severity: "warning",
        title: `Approval needed: ${label}`,
        detail: permission.title,
        target,
      });
    }
  }

  for (const worker of collectRunsFromSnapshot(snapshot)) {
    const view = worker.view;
    if (!view?.pending.length) continue;
    const label = workerDisplayLabel(worker, snapshot.chats);
    for (const permission of view.pending) {
      const dedupeKey = `${ALERT_PREFIXES.approval}${view.id}:${permission.id}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      alerts.push({
        dedupeKey,
        source: "approval",
        severity: "warning",
        title: `Approval needed: ${label}`,
        detail: permission.title,
        target: { kind: "conversation", id: worker.record.id },
      });
    }
  }

  return alerts;
}

export function collectDraftPlanAlerts(snapshot: Snapshot): AlertInput[] {
  const alerts: AlertInput[] = [];
  for (const chat of snapshot.chats) {
    const keyId = chat.conversationId ?? chat.run?.id;
    const target = chatAlertTarget(chat);
    if (!keyId || !target || !chat.plans?.length) continue;
    const chatLabel = chatDisplayLabel(chat);
    for (const plan of chat.plans) {
      if (plan.state !== "draft") continue;
      alerts.push({
        dedupeKey: `${ALERT_PREFIXES.planDraft}${keyId}:${plan.id}:${plan.proposalRevision}`,
        source: "plan",
        severity: "info",
        title: `Plan ready for review: ${plan.title}`,
        detail: `${chatLabel} (${plan.total} task${plan.total === 1 ? "" : "s"})`,
        target,
      });
    }
  }
  return alerts;
}

export function collectFailedPlanAlerts(snapshot: Snapshot): AlertInput[] {
  const alerts: AlertInput[] = [];
  for (const chat of snapshot.chats) {
    const keyId = chat.conversationId ?? chat.run?.id;
    const target = chatAlertTarget(chat);
    if (!keyId || !target || !chat.plans?.length) continue;
    const chatLabel = chatDisplayLabel(chat);
    for (const plan of chat.plans) {
      if (plan.state !== "failed") continue;
      alerts.push({
        dedupeKey: `event:plan-failed:${keyId}:${plan.id}:${plan.revision}`,
        source: "plan",
        severity: "error",
        title: `Plan failed: ${plan.title}`,
        detail: `${chatLabel} (${plan.completed}/${plan.total} completed)`,
        target,
      });
    }
  }
  return alerts;
}

export function collectWorkspaceAlerts(snapshot: Snapshot): AlertInput[] {
  const alerts: AlertInput[] = [];
  if (snapshot.databaseError) {
    alerts.push({
      dedupeKey: `${ALERT_PREFIXES.workspace}database-error`,
      source: "workspace",
      severity: "error",
      title: "Database connection error",
      detail: snapshot.databaseError,
      target: { kind: "page", id: "health-check" },
    });
  }
  const relayHistoryUnavailable = snapshot.chats.some(
    (chat) => chat.kind === "relay" && !chat.customAgentId && chat.historySaving === "unavailable",
  );
  if (relayHistoryUnavailable) {
    alerts.push({
      dedupeKey: `${ALERT_PREFIXES.workspace}relay-history-saving`,
      source: "workspace",
      severity: "warning",
      title: "Relay history is not being saved",
      detail: "Recent messages may be unavailable after restart.",
      target: { kind: "relay" },
    });
  }
  return alerts;
}

export function collectMcpAlerts(summary: {
  recoveryPending: number;
  issueCount: number;
}): AlertInput[] {
  const alerts: AlertInput[] = [];
  if (summary.recoveryPending > 0) {
    alerts.push({
      dedupeKey: `${ALERT_PREFIXES.mcp}recovery-pending`,
      source: "mcp",
      severity: "warning",
      title: "MCP configuration recovery pending",
      detail: `${summary.recoveryPending} pending configuration recovery item${summary.recoveryPending === 1 ? "" : "s"}.`,
      target: { kind: "page", id: "mcp-servers" },
    });
  }
  return alerts;
}

export function collectWorkflowLiveAlerts(
  recordId: string,
  name: string,
  snapshot: WorkflowSnapshot,
): AlertInput[] {
  if (snapshot.status !== "needs_input") return [];
  const decisionKey = snapshot.decision?.id ?? String(snapshot.eventCursor);
  return [
    {
      dedupeKey: `${ALERT_PREFIXES.workflowPrefix(recordId)}needs-input:${decisionKey}`,
      source: "workflow",
      severity: "warning",
      title: `Workflow needs input: ${name}`,
      ...(snapshot.decision?.text ? { detail: snapshot.decision.text } : {}),
      target: { kind: "workflow", id: recordId },
    },
  ];
}

export function collectWorkflowFailureAlert(
  recordId: string,
  name: string,
  snapshot: WorkflowSnapshot,
): AlertInput | null {
  if (snapshot.status !== "failed") return null;
  return {
    dedupeKey: `event:workflow-failed:${recordId}:${snapshot.runId}`,
    source: "workflow",
    severity: "error",
    title: `Workflow failed: ${name}`,
    ...(snapshot.reason ? { detail: snapshot.reason } : {}),
    target: { kind: "workflow", id: recordId },
  };
}

export interface SchedulerExecutionNotice {
  id: string;
  automationName: string;
  status: string;
  reason: string | null;
}

export function schedulerExecutionAlertKey(executionId: string): string {
  return `event:automation-exec:${executionId}`;
}

export function collectSchedulerLiveAlerts(schedulerError: string | null): AlertInput[] {
  if (!schedulerError) return [];
  return [
    {
      dedupeKey: `${ALERT_PREFIXES.automation}unavailable`,
      source: "automation",
      severity: "error",
      title: "Scheduled jobs unavailable",
      detail: schedulerError,
      target: { kind: "page", id: "system-manager" },
    },
  ];
}

export function collectSchedulerExecutionAlerts(
  executions: readonly SchedulerExecutionNotice[],
): AlertInput[] {
  const alerts: AlertInput[] = [];
  for (const execution of executions) {
    const isLowDisk = execution.reason === "low_disk";
    const isFailed = execution.status === "failed" || execution.status === "interrupted";
    if (!isLowDisk && !isFailed) continue;
    const title = isLowDisk
      ? `Scheduled job blocked (low disk): ${execution.automationName}`
      : execution.status === "interrupted"
        ? `Scheduled job interrupted: ${execution.automationName}`
        : `Scheduled job failed: ${execution.automationName}`;
    alerts.push({
      dedupeKey: schedulerExecutionAlertKey(execution.id),
      source: "automation",
      severity: "error",
      title,
      ...(execution.reason && !isLowDisk ? { detail: execution.reason } : {}),
      target: { kind: "page", id: "automations" },
    });
  }
  return alerts;
}

function mapHealthDeepLink(deepLink?: HealthDeepLink): AlertTarget {
  if (!deepLink) return { kind: "page", id: "health-check" };
  if (deepLink.kind === "relay") return { kind: "relay" };
  if (deepLink.kind === "settings" && SETTINGS_ID_SET.has(deepLink.id)) {
    return {
      kind: "settings",
      id: deepLink.id as (typeof settingsSections)[number]["id"],
    };
  }
  if (deepLink.kind === "page" && PAGE_ID_SET.has(deepLink.id)) {
    return { kind: "page", id: deepLink.id as (typeof pages)[number]["id"] };
  }
  return { kind: "page", id: "health-check" };
}

/** Checks already emitted directly by dedicated producers to prevent duplicate alerts. */
const DEDICATED_PRODUCER_HEALTH_CHECKS = new Set<string>([
  "database-health",
  "relay-health",
  "mcp-servers",
  "scheduler-status",
]);

export function collectHealthAlerts(snapshot: HealthSnapshot): AlertInput[] {
  const alerts: AlertInput[] = [];
  for (const check of snapshot.checks) {
    if (check.status !== "error" && check.status !== "unavailable") continue;
    if (DEDICATED_PRODUCER_HEALTH_CHECKS.has(check.id)) continue;
    alerts.push({
      dedupeKey: `${ALERT_PREFIXES.health}${check.id}`,
      source: "health",
      severity: "error",
      title: `${check.title}: ${check.summary}`,
      ...(check.detail ? { detail: check.detail } : {}),
      target: mapHealthDeepLink(check.deepLink),
    });
  }
  return alerts;
}
