import { Add } from "@carbon/icons-react";
import {
  Button,
  InlineLoading,
  InlineNotification,
  Tab,
  TabList,
  Table,
  TableBody,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  TableToolbar,
  TableToolbarContent,
  TabPanel,
  TabPanels,
  Tabs,
} from "@carbon/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  ApplicationClient,
  AutomationEditor,
  AutomationHistoryEntry,
  AutomationSummary,
  AutomationUiRequest,
  RendererAutomationDraft,
} from "../bridge/index.js";
import { AutomationForm } from "./automation-form.js";
import { AutomationHistory } from "./automation-history.js";
import { AutomationJob } from "./automation-job.js";
import { AutomationModal } from "./automation-modal.js";
import { AutomationTranscriptModal } from "./automation-transcript.js";
import { useDocumentVisible } from "./use-document-visible.js";

const freshDraft = (agent: string): RendererAutomationDraft => ({
  name: "",
  enabled: false,
  trigger: {
    type: "schedule",
    schedule: {
      type: "daily",
      time: "09:00",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  },
  action: {
    type: "prompt",
    prompt: "",
    agent,
    baseBranch: "main",
    allow: [],
    turnTimeout: "30m",
  },
});

export function AutomationsPage({
  api,
  active,
  agents,
  onOpenWorkflow,
}: {
  api: ApplicationClient;
  active: boolean;
  agents: string[];
  onOpenWorkflow?(workflowId: string): void;
}) {
  const visible = useDocumentVisible() && active;
  const [automations, setAutomations] = useState<AutomationSummary[]>([]);
  const [history, setHistory] = useState<AutomationHistoryEntry[]>([]);
  const [selected, setSelected] = useState<string>();
  const [expanded, setExpanded] = useState<string>();
  const [selectedExecution, setSelectedExecution] = useState<string>();
  const [before, setBefore] = useState<number>();
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const pending = useRef(false);
  const [editor, setEditor] = useState<AutomationEditor>();
  const [evidence, setEvidence] = useState("");
  const [transcriptExecution, setTranscriptExecution] = useState<string>();
  const generation = useRef(0);
  const pageGeneration = useRef(0);
  const actionsTrigger = useRef<HTMLButtonElement>(null);
  const changesTrigger = useRef<HTMLButtonElement>(null);
  const [tab, setTab] = useState(0);
  const focusAfterForm = useRef<string | undefined>(undefined);
  const surfaceVersion = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a visibility or API change invalidates pending actions.
  useLayoutEffect(() => {
    pageGeneration.current++;
    return () => {
      pageGeneration.current++;
    };
  }, [api, visible]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the created row may mount after the form closes.
  useLayoutEffect(() => {
    if (!visible || editor || !focusAfterForm.current) return;
    const target = focusAfterForm.current;
    const trigger =
      target === "create"
        ? actionsTrigger.current
        : target.startsWith("job-row-")
          ? document.getElementById(target)?.querySelector("button")
          : document.getElementById(target);
    if (trigger) {
      trigger.focus({ preventScroll: true });
      focusAfterForm.current = undefined;
    }
  }, [editor, visible, automations]);
  useEffect(() => {
    if (!visible) {
      setEvidence("");
      setTranscriptExecution(undefined);
    }
  }, [visible]);
  const dirty = useRef(false);
  const flight = useRef(false);
  const refreshLatest = useRef<() => Promise<void>>(async () => {});
  const refresh = useCallback(async () => {
    dirty.current = true;
    if (!visible || flight.current) return;
    flight.current = true;
    setLoading(true);
    const owner = generation.current;
    try {
      do {
        dirty.current = false;
        const [list, page] = await Promise.all([
          api.automation({ action: "list" }),
          api.automation({
            action: "history",
            ...(selected ? { id: selected } : {}),
            ...(before ? { before } : {}),
          }),
        ]);
        if (owner !== generation.current) return;
        setAutomations(list as AutomationSummary[]);
        setHistory(page as AutomationHistoryEntry[]);
        setError("");
      } while (dirty.current && owner === generation.current);
    } catch {
      if (owner === generation.current) {
        setError(
          "Scheduler unavailable. Open Apps → System Manager to check the Scheduling Service, then refresh. Existing schedules and evidence are kept.",
        );
      }
    } finally {
      flight.current = false;
      if (owner === generation.current) setLoading(false);
      if (dirty.current) void refreshLatest.current();
    }
  }, [visible, api, before, selected]);
  refreshLatest.current = refresh;
  useEffect(() => {
    generation.current++;
    const off = api.onAutomationChanged(() => {
      void refresh();
    });
    void refresh();
    return () => {
      generation.current++;
      off();
    };
  }, [api, refresh]);
  const act = async (request: AutomationUiRequest) => {
    if (pending.current) return;
    pending.current = true;
    const owner = pageGeneration.current;
    const readOwner = generation.current;
    const evidenceRequest = request.action === "transcript" || request.action === "diff";
    const surface = surfaceVersion.current;
    const current = () =>
      owner === pageGeneration.current &&
      (!evidenceRequest ||
        (readOwner === generation.current && surface === surfaceVersion.current));
    setBusy(true);
    setActionError("");
    try {
      const result = await api.automation(request);
      if (!current()) return;
      if (request.action === "diff") setEvidence(JSON.stringify(result, null, 2));
      await refreshLatest.current();
    } catch (error) {
      if (current()) setActionError((error as Error).message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const execution = history.find((value) => value.id === selectedExecution);
  function clearEvidence() {
    surfaceVersion.current++;
    setSelectedExecution(undefined);
    setTranscriptExecution(undefined);
    setEvidence("");
  }
  function historyScope(id?: string) {
    clearEvidence();
    if (id !== selected || before !== undefined) {
      setHistory([]);
      setLoading(true);
    }
    setSelected(id);
    setBefore(undefined);
    setTab(1);
  }
  async function editJob(job: AutomationSummary) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setActionError("");
    const owner = pageGeneration.current;
    const surface = surfaceVersion.current;
    try {
      const result = await api.automation({ action: "get", id: job.id });
      if (owner === pageGeneration.current && surface === surfaceVersion.current) {
        focusAfterForm.current = `job-actions-${job.id}`;
        setEditor(result as AutomationEditor);
      }
    } catch (cause) {
      if (owner === pageGeneration.current)
        setActionError(cause instanceof Error ? cause.message : "Could not open job.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const isWorkflowExecution = execution?.actionType === "workflow";
  const hasEvidence = isWorkflowExecution
    ? Boolean(execution?.workflowId)
    : Boolean(execution?.runId);
  const evidenceActions = hasEvidence && execution && (
    <section
      className="carbon-job-actions"
      aria-label={`Evidence for ${execution.automationName}, execution ${execution.sequence}`}
    >
      {isWorkflowExecution ? (
        execution.workflowId &&
        onOpenWorkflow && (
          <Button
            kind="ghost"
            size="sm"
            disabled={busy}
            onClick={() => onOpenWorkflow(execution.workflowId as string)}
          >
            Open in Workflows
          </Button>
        )
      ) : (
        <Button
          kind="ghost"
          size="sm"
          disabled={busy}
          onClick={() => setTranscriptExecution(execution.id)}
        >
          Transcript
        </Button>
      )}
      <Button
        kind="ghost"
        size="sm"
        disabled={busy}
        ref={changesTrigger}
        onClick={() => void act({ action: "diff", executionId: execution.id })}
      >
        Changes
      </Button>
    </section>
  );
  return (
    <section className="carbon-scheduled-jobs" data-active={visible}>
      {editor ? (
        <AutomationForm
          key={editor.id}
          api={api}
          editor={editor}
          agents={agents}
          active={visible}
          onClose={() => setEditor(undefined)}
          onSaved={(id) => {
            focusAfterForm.current = id ? `job-row-${id}` : "create";
            setEditor(undefined);
            void refreshLatest.current();
          }}
        />
      ) : (
        <>
          <h1 id="jobs-page-heading" tabIndex={-1}>
            Scheduled Jobs
          </h1>
          {(actionError || error) && (
            <section aria-label="Scheduler feedback">
              <InlineNotification
                kind="error"
                title={error ? "Scheduler unavailable" : "Job action failed"}
                subtitle={actionError || error}
                hideCloseButton
              />
              {error && (
                <Button kind="ghost" onClick={() => void refreshLatest.current()}>
                  Retry
                </Button>
              )}
            </section>
          )}
          <Tabs
            selectedIndex={tab}
            onChange={({ selectedIndex }) => {
              clearEvidence();
              setTab(selectedIndex);
            }}
          >
            <TabList aria-label="Scheduled Jobs views">
              <Tab>Schedules</Tab>
              <Tab>Execution history</Tab>
            </TabList>
            <TabPanels>
              <TabPanel>
                <TableContainer>
                  <TableToolbar aria-label="Scheduled job controls">
                    <TableToolbarContent>
                      <Button
                        kind="ghost"
                        disabled={busy}
                        onClick={() => {
                          setActionError("");
                          void refreshLatest.current();
                        }}
                      >
                        Refresh
                      </Button>
                      <Button
                        ref={actionsTrigger}
                        renderIcon={Add}
                        disabled={busy}
                        onClick={() => {
                          focusAfterForm.current = "create";
                          setEditor({
                            id: "",
                            revision: 0,
                            repositoryLabel: "",
                            draft: freshDraft(agents[0] ?? ""),
                          });
                        }}
                      >
                        New scheduled job
                      </Button>
                    </TableToolbarContent>
                  </TableToolbar>
                  {loading && !automations.length && (
                    <InlineLoading description="Reading scheduled jobs…" />
                  )}
                  <div className="carbon-job-table-scroll">
                    <Table size="lg" aria-label="Schedules">
                      <TableHead>
                        <TableRow>
                          <TableHeader id="schedule-details-heading">
                            <span className="cds--visually-hidden">Details</span>
                          </TableHeader>
                          {[
                            "Job name",
                            "Type",
                            "Schedule status",
                            "Next run",
                            "Run status",
                            "Agent",
                            "Actions",
                          ].map((label) => (
                            <TableHeader key={label} scope="col">
                              {label}
                            </TableHeader>
                          ))}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {[...automations]
                          .sort((a, b) => a.name.localeCompare(b.name))
                          .map((job) => (
                            <AutomationJob
                              key={job.id}
                              job={job}
                              api={api}
                              active={visible && tab === 0}
                              open={expanded === job.id}
                              busy={busy}
                              onToggle={() => setExpanded(expanded === job.id ? undefined : job.id)}
                              onAction={act}
                              onEdit={() => void editJob(job)}
                              onHistory={() => historyScope(job.id)}
                            />
                          ))}
                      </TableBody>
                    </Table>
                  </div>
                  {!automations.length && !error && !loading && (
                    <section className="carbon-job-empty">
                      <h2>No scheduled jobs.</h2>
                      <p>Create a scheduled job to run a saved prompt or workflow on a schedule.</p>
                    </section>
                  )}
                </TableContainer>
              </TabPanel>
              <TabPanel>
                {selected && (
                  <div className="carbon-job-filter">
                    <span>
                      Schedule:{" "}
                      {automations.find((job) => job.id === selected)?.name ??
                        history[0]?.automationName ??
                        "Deleted schedule"}
                    </span>
                    <Button kind="ghost" size="sm" onClick={() => historyScope()}>
                      Show all schedules
                    </Button>
                  </div>
                )}
                {loading && !history.length && <InlineLoading description="Reading executions…" />}
                <AutomationHistory
                  key={selected ?? "all"}
                  rows={history}
                  selected={selectedExecution}
                  filtered={!!selected}
                  showEmpty={!error && !loading}
                  onSelect={(id) => {
                    clearEvidence();
                    setSelectedExecution(id);
                  }}
                  evidence={evidenceActions}
                />
                <div className="carbon-job-actions">
                  {before !== undefined && (
                    <Button
                      kind="ghost"
                      onClick={() => {
                        clearEvidence();
                        setBefore(undefined);
                      }}
                    >
                      Latest
                    </Button>
                  )}
                  {history.length >= 50 && (
                    <Button
                      kind="ghost"
                      onClick={() => {
                        clearEvidence();
                        setBefore(history.at(-1)?.sequence);
                      }}
                    >
                      Older
                    </Button>
                  )}
                </div>
              </TabPanel>
            </TabPanels>
          </Tabs>
        </>
      )}
      {visible && transcriptExecution && (
        <AutomationTranscriptModal
          key={transcriptExecution}
          api={api}
          executionId={transcriptExecution}
          onClose={() => setTranscriptExecution(undefined)}
        />
      )}
      {visible && evidence && (
        <AutomationModal
          returnFocus={changesTrigger.current}
          title="Read-only execution evidence"
          onClose={() => setEvidence("")}
        >
          <pre className="carbon-job-evidence">{evidence}</pre>
        </AutomationModal>
      )}
    </section>
  );
}
