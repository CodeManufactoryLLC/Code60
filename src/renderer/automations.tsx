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
import { AutomationJob } from "./automation-job.js";
import { AutomationTranscriptModal } from "./automation-transcript.js";
import { DataTable, type TableOptions } from "./data-table.js";
import { Modal } from "./modal.js";
import { Accordion } from "./neobrutalism/accordion.js";
import { PageTitle } from "./page-title.js";
import { useDocumentVisible } from "./use-document-visible.js";

const historyColumns = [
  { key: "automationName", title: "Scheduled job", width: 160, filter: "text" },
  { key: "status", title: "Turn outcome", width: 120, filter: "category" },
  { key: "reason", title: "Reason", width: 180, filter: "category" },
  { key: "scheduledFor", title: "Scheduled", width: 190, filter: "date" },
  { key: "startedAt", title: "Started", width: 190, filter: "date" },
  { key: "endedAt", title: "Ended", width: 190, filter: "date" },
  { key: "denials", title: "Denied requests", width: 120, filter: "number" },
] satisfies {
  key: keyof AutomationHistoryEntry;
  title: string;
  width: number;
  filter: "text" | "date" | "category" | "number";
}[];
const freshDraft = (agent: string): RendererAutomationDraft => ({
  name: "",
  prompt: "",
  agent,
  baseBranch: "main",
  allow: [],
  turnTimeout: "30m",
  enabled: false,
  schedule: {
    type: "daily",
    time: "09:00",
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  },
});

export function AutomationsPage({
  api,
  active,
  agents,
  ...table
}: {
  api: ApplicationClient;
  active: boolean;
  agents: string[];
} & Pick<TableOptions, "lines" | "density" | "fit" | "textStyles">) {
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
  const pending = useRef(false);
  const [editor, setEditor] = useState<AutomationEditor>();
  const [evidence, setEvidence] = useState("");
  const [transcriptExecution, setTranscriptExecution] = useState<string>();
  const generation = useRef(0);
  const pageGeneration = useRef(0);
  const actionsTrigger = useRef<HTMLButtonElement>(null);
  const hadEditor = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: API/visibility changes invalidate page-owned actions; history filters do not.
  useLayoutEffect(() => {
    pageGeneration.current++;
    return () => {
      pageGeneration.current++;
    };
  }, [api, visible]);
  useLayoutEffect(() => {
    const closed = hadEditor.current && !editor;
    hadEditor.current = !!editor;
    if (closed && visible) actionsTrigger.current?.focus({ preventScroll: true });
  }, [editor, visible]);
  const dirty = useRef(false);
  const flight = useRef(false);
  const refreshLatest = useRef<() => Promise<void>>(async () => {});
  const refresh = useCallback(async () => {
    dirty.current = true;
    if (!visible || flight.current) return;
    flight.current = true;
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
    const current = () =>
      owner === pageGeneration.current && (!evidenceRequest || readOwner === generation.current);
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
  return (
    <section className="automations-page" data-active={visible}>
      <PageTitle
        page="automations"
        className="table-title"
        actionsTrigger={actionsTrigger}
        actions={[
          {
            id: "new-schedule",
            label: "New scheduled job",
            disabled: busy || !!editor,
            run: () =>
              setEditor({
                id: "",
                revision: 0,
                repositoryLabel: "",
                draft: freshDraft(agents[0] ?? ""),
              }),
          },
          {
            id: "refresh-schedules",
            label: "Refresh",
            disabled: busy || !!editor,
            run: () => {
              setActionError("");
              void refreshLatest.current();
            },
          },
        ]}
      />

      {(actionError || error) && <p role="alert">{actionError || error}</p>}
      {editor && (
        <AutomationForm
          api={api}
          editor={editor}
          active={visible}
          agents={agents}
          onClose={() => setEditor(undefined)}
          onSaved={() => {
            setEditor(undefined);
            void refreshLatest.current();
          }}
        />
      )}
      <section className="automation-schedules" aria-label="Schedules">
        <Accordion>
          {[...automations]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((job) => (
              <AutomationJob
                key={job.id}
                job={job}
                api={api}
                agents={agents}
                active={visible}
                open={expanded === job.id}
                busy={busy}
                onToggle={() => {
                  const next = expanded === job.id ? undefined : job.id;
                  setExpanded(next);
                  setSelected(next);
                  setBefore(undefined);
                }}
                onAction={act}
                onSaved={() => void refreshLatest.current()}
              />
            ))}
        </Accordion>
        {!automations.length && !error && <p className="automation-empty">No scheduled jobs.</p>}
      </section>

      <section
        className="automation-grid automation-history-grid automation-table-card"
        aria-label="Execution history"
      >
        <DataTable
          {...table}
          tableId="automation-history"
          workspace="application"
          rows={history}
          selected={selectedExecution}
          onSelect={setSelectedExecution}
          columns={historyColumns}
          initialSort="startedAt"
          initialDescending
          display={(row, key) => String(row[key] ?? "Not started")}
        />
      </section>
      <div className="automation-history-footer">
        <div className="automation-action-group">
          {selected && (
            <button
              type="button"
              className="small"
              onClick={() => {
                setSelected(undefined);
                setBefore(undefined);
              }}
            >
              Show all schedules
            </button>
          )}
          {before !== undefined && (
            <button type="button" className="small" onClick={() => setBefore(undefined)}>
              Latest
            </button>
          )}
          {history.length >= 50 && (
            <button
              type="button"
              className="small"
              onClick={() => setBefore(history.at(-1)?.sequence)}
            >
              Older
            </button>
          )}
        </div>
      </div>
      {execution?.runId && (
        <section className="automation-evidence-actions" aria-label="Selected run evidence">
          <span>
            Selected run: {execution.automationName} · {execution.status}
          </span>
          <div className="automation-action-group">
            <button
              type="button"
              className="small"
              disabled={busy}
              onClick={() => setTranscriptExecution(execution.id)}
            >
              Transcript
            </button>
            <button
              type="button"
              className="small"
              disabled={busy}
              onClick={() => void act({ action: "diff", executionId: execution.id })}
            >
              Changes
            </button>
          </div>
        </section>
      )}
      {visible && transcriptExecution && (
        <AutomationTranscriptModal
          key={transcriptExecution}
          api={api}
          executionId={transcriptExecution}
          onClose={() => setTranscriptExecution(undefined)}
        />
      )}
      {evidence && (
        <Modal
          title="Read-only execution evidence"
          busy={false}
          wide
          onClose={() => setEvidence("")}
        >
          <pre className="automation-evidence">{evidence}</pre>
        </Modal>
      )}
    </section>
  );
}
