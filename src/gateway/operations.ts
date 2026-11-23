import type { ApplicationHost, DesktopAutomations, DesktopLogStore } from "../application/index.js";
import { logProjectId } from "../application/index.js";
import {
  parseAction,
  parseBoolean,
  parseConfigurationId,
  parseDatabaseMode,
  parseDatabaseWrite,
  parseDeleteCommand,
  parseDetailIdentity,
  parseDetailRequest,
  parseDiffIdentity,
  parseDiffRequest,
  parseFileContext,
  parseGitProject,
  parseGitSetupCommit,
  parseGitSetupFile,
  parseGitSetupIdentity,
  parseLogClear,
  parseLogDetail,
  parseLogQuery,
  parseMemoryAction,
  parseMemoryBrowse,
  parseMemoryDetail,
  parseMemoryExtraction,
  parseMemoryRequestId,
  parseModelDefaultAction,
  parseOrchestrationChatAction,
  parseOrchestrationProvider,
  parsePlanAction,
  parsePlanRead,
  parsePollRequest,
  parsePollSettings,
  parsePollVisibility,
  parseProjectAction,
  parseProjectPath,
  parsePromptTemplateId,
  parseProviderAction,
  parseRagCancel,
  parseRagIdentity,
  parseRagQuery,
  parseReviewAction,
  parseReviewFileRead,
  parseReviewRead,
  parseSaveCommand,
  parseSaveConfiguration,
  parseSavePromptTemplate,
  parseSearchSummary,
  parseSearchSummaryRequestId,
  parseSetupAttempt,
  parseSetupBegin,
  parseSetupSession,
  parseStart,
  parseTaskAction,
  parseWebLink,
} from "../bridge/index.js";
import type { Interactions } from "./interactions.js";

/** Fixed human application operations; agent MCP gateways never receive this surface. */
export function applicationOperations(
  controller: ApplicationHost,
  logs: DesktopLogStore,
  automations: DesktopAutomations,
  interactions: Interactions,
  emit: (event: string, value?: unknown) => void,
) {
  const operations = new Map<string, (value: unknown) => unknown>();
  const handle = (name: string, action: (value: unknown) => unknown) => {
    operations.set(name, action);
  };
  handle("automation", (value) => automations.request(value));
  handle("model-default", (value) => controller.modelDefault(parseModelDefaultAction(value)));
  handle("logs-query", (value) => {
    const query = parseLogQuery(value);
    const directory = controller.snapshot().directory;
    return logs.query(
      query.scope === "current"
        ? {
            ...query,
            projectId: directory ? logProjectId(directory) : "0000000000000000",
          }
        : query,
    );
  });
  handle("logs-detail", (value) => logs.detail(parseLogDetail(value).id));
  handle("logs-clear", async (value) => {
    parseLogClear(value);
    if (
      !(await interactions.confirm(
        "Clear logs?",
        "Only diagnostic logs will be cleared. Transcripts, run records, databases and worktrees are kept.",
      ))
    )
      return false;
    await logs.clear();
    return true;
  });
  handle("snapshot", () => controller.snapshot());
  handle("snapshot-summary", () => controller.snapshot(true, true));
  handle("detail-subscribe", (value) => {
    controller.subscribeDetails(parseDetailRequest(value), (frame) => emit("detail", frame));
  });
  handle("detail-read", (value) => controller.readDetails(parseDetailRequest(value)));
  handle("custom-agent", (value) => controller.customAgent(value));
  handle("relay-files", (value) => controller.setRelayFileContext(value));
  handle("knowledge-renderer", () => controller.knowledge.rendererIdentity());
  handle("knowledge-report", (value) => controller.knowledge.report(value));
  handle("detail-unsubscribe", (value) =>
    controller.unsubscribeDetails(parseDetailIdentity(value)),
  );
  handle("database", async (value) => {
    const { request, databaseEpoch } = parseDatabaseWrite(value);
    const mode = parseDatabaseMode(request);
    const epoch = controller.assertDatabaseRequest(databaseEpoch);
    const path = await interactions.pick(mode === "create" ? "database-create" : "database-open");
    controller.assertDatabaseRequest(epoch);
    if (!path) return false;
    await controller.connect(path, mode === "create", epoch);
    return true;
  });
  handle("folder", async (value) => {
    const { request, databaseEpoch } = parseDatabaseWrite(value);
    if (request !== undefined) throw new Error("Invalid request");
    const epoch = controller.assertDatabaseRequest(databaseEpoch);
    if (!controller.connected) throw new Error("Connect to a database first");
    const path = await interactions.pick("folder");
    controller.assertDatabaseRequest(epoch);
    if (!path || !(await interactions.confirm("Open project?", path))) return false;
    controller.assertDatabaseRequest(epoch);
    await controller.open(path, epoch);
    return true;
  });
  handle("project", (value) => {
    const { request, databaseEpoch } = parseDatabaseWrite(value);
    return controller.openProject(parseProjectPath(request), databaseEpoch);
  });
  handle("project-action", (value) => controller.projectAction(parseProjectAction(value)));
  handle("project-remove", (value) => {
    const { request, databaseEpoch } = parseDatabaseWrite(value);
    return controller.removeProject(parseProjectPath(request), databaseEpoch);
  });
  handle("project-clear", (value) => {
    const { request, databaseEpoch } = parseDatabaseWrite(value);
    if (request !== undefined) throw new Error("Invalid request");
    return controller.clearProjects(databaseEpoch);
  });
  handle("files", (value) => controller.setFileContext(parseFileContext(value)));
  handle("poll", (value) => {
    const { keys, ...identity } = parsePollRequest(value);
    return controller.poll(keys, identity);
  });
  handle("poll-settings", (value) => controller.setPollSettings(parsePollSettings(value)));
  handle("poll-paused", (value) => controller.setPollingPaused(parseBoolean(value)));
  handle("visibility", (value) => controller.setVisibility(parsePollVisibility(value)));
  handle("orchestration-chat", (value) =>
    controller.orchestrationChatAction(parseOrchestrationChatAction(value)),
  );
  handle("provider-action", (value) => controller.providerAction(parseProviderAction(value)));
  handle("setup-begin", (value) => controller.beginAgentSetup(parseSetupBegin(value)));
  handle("setup-attempt", (value) => controller.attemptAgentSetup(parseSetupAttempt(value)));
  handle("setup-cancel", (value) => controller.cancelAgentSetup(parseSetupSession(value)));
  handle("setup-finish", (value) => controller.finishAgentSetup(parseSetupSession(value)));
  handle("setup-abandon", (value) => controller.abandonAgentSetup(parseSetupSession(value)));
  handle("orchestration-auto-approval", (value) =>
    controller.setOrchestrationAutoApproval(parseBoolean(value)),
  );
  handle("orchestration-provider", (value) =>
    controller.setOrchestrationProvider(parseOrchestrationProvider(value)),
  );
  handle("orchestration-test", (value) => {
    if (value !== undefined) throw new Error("Invalid request");
    return controller.testOrchestrationProvider();
  });
  handle("orchestration-test-cancel", (value) => {
    if (value !== undefined) throw new Error("Invalid request");
    return controller.cancelOrchestrationTest();
  });
  handle("memory-extract", (value) => controller.extractMemory(parseMemoryExtraction(value)));
  handle("rag-status", (value) => {
    if (value !== undefined) throw new Error("Invalid request");
    return controller.rag.status();
  });
  handle("memory-snapshot", (value) => {
    if (value !== undefined) throw new Error("Invalid request");
    return controller.memory.snapshot();
  });
  handle("memory-browse", (value) => controller.memory.browse(parseMemoryBrowse(value)));
  handle("memory-detail", (value) => controller.memory.detail(parseMemoryDetail(value).id));
  handle("memory-action", (value) =>
    controller.memory.action(parseMemoryAction(value), (title, detail) =>
      interactions.confirm(title, detail),
    ),
  );
  handle("rag-rebuild", (value) => controller.rebuildRag(parseRagIdentity(value)));
  handle("rag-retrieve", (value) => controller.retrieveRag(parseRagQuery(value)));
  handle("rag-cancel", (value) => controller.cancelRag(parseRagCancel(value)));
  handle("rag-clear", (value) => controller.clearRag(parseRagIdentity(value)));
  handle("project-search", (value) => controller.searchProjects(value));
  handle("project-search-page", (value) => controller.searchProjectsPage(value));
  handle("project-search-cancel", (value) => controller.cancelProjectSearch(value));
  handle("project-search-open", (value) =>
    controller.openSearchSource(value, (path) => interactions.confirm("Open project?", path)),
  );
  handle("search-summary", (value) => controller.summarizeSearch(parseSearchSummary(value)));
  handle("search-summary-cancel", (value) =>
    controller.cancelSearchSummary(parseSearchSummaryRequestId(value)),
  );
  handle("memory-cancel", (value) =>
    controller.cancelMemoryExtraction(parseMemoryRequestId(value)),
  );
  handle("start", (value) => controller.start(parseStart(value)));
  handle("configuration-save", (value) => {
    const { request, databaseEpoch } = parseDatabaseWrite(value);
    return controller.saveConfiguration(parseSaveConfiguration(request), databaseEpoch);
  });
  handle("configuration-delete", (value) => {
    const { request, databaseEpoch } = parseDatabaseWrite(value);
    return controller.deleteConfiguration(parseConfigurationId(request), databaseEpoch);
  });
  handle("prompt-save", (value) => {
    const { request, databaseEpoch } = parseDatabaseWrite(value);
    return controller.savePromptTemplate(parseSavePromptTemplate(request), databaseEpoch);
  });
  handle("command-save", (value) => {
    const { request, databaseEpoch } = parseDatabaseWrite(value);
    return controller.saveCommand(parseSaveCommand(request), databaseEpoch);
  });
  handle("command-delete", (value) => {
    const { request, databaseEpoch } = parseDatabaseWrite(value);
    return controller.deleteCommand(parseDeleteCommand(request), databaseEpoch);
  });
  handle("prompt-reset", (value) => {
    const { request, databaseEpoch } = parseDatabaseWrite(value);
    return controller.resetPromptTemplate(parsePromptTemplateId(request), databaseEpoch);
  });
  handle("git-check", (value) => controller.checkGit(parseGitProject(value)));
  handle("git-begin", (value) => controller.beginGitSetup(parseGitProject(value)));
  handle("git-file", (value) => controller.previewGitSetupFile(parseGitSetupFile(value)));
  handle("git-initialize", (value) => controller.initializeGit(parseGitSetupIdentity(value)));
  handle("git-commit", (value) => controller.commitGitSetup(parseGitSetupCommit(value)));
  handle("git-cancel", (value) => controller.cancelGitSetup(parseGitProject(value)));
  handle("diff-read", (value) => controller.readDiff(parseDiffRequest(value)));
  handle("plan-read", (value) => controller.readPlan(parsePlanRead(value)));
  handle("relay-message", (value) => controller.readRelayMessage(value));
  handle("relay-review", (value) => controller.relayReview(value));
  handle("plan-action", (value) => controller.planAction(parsePlanAction(value)));
  handle("task-action", (value) => controller.taskAction(parseTaskAction(value)));
  handle("review-action", (value) => controller.reviewAction(parseReviewAction(value)));
  handle("review-read", (value) => controller.readReview(parseReviewRead(value)));
  handle("review-capture", (value) => controller.captureReview(parseReviewRead(value)));
  handle("review-file", (value) => controller.readReviewFile(parseReviewFileRead(value)));
  handle("diff-cancel", (value) => controller.cancelDiff(parseDiffIdentity(value)));
  handle("action", (value) => controller.action(parseAction(value)));
  handle("stop-all", async (value) => {
    if (value !== undefined) throw new Error("Invalid request");
    if (
      await interactions.confirm(
        "Stop all runs?",
        "Active interactive work will be cancelled. Scheduled jobs and worktrees are kept.",
      )
    )
      await controller.stopAll();
  });
  handle("web-link", async (value) =>
    interactions.confirm("Open web link?", parseWebLink(value).url),
  );
  return operations;
}
