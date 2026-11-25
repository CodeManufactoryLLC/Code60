import { useEffect, useRef, useState } from "react";
import {
  type ApplicationClient,
  DEFAULT_EPISODIC_MEMORY_PROMPT,
  type DesktopRun,
  type MemoryExtractionResult,
} from "../bridge/index.js";
import { randomId } from "./browser-platform.js";
import { Button as AppButton } from "./carbon/button.js";
import { TextInput as CarbonTextInput } from "./carbon/fields.js";
import { Textarea as CarbonTextArea } from "./carbon/textarea.js";
import { pageDefinitions } from "./navigation.js";
import { PageTitle } from "./page-title.js";
import { TranscriptNotice, type Transcripts } from "./transcripts.js";

const promptKey = "code60.episodicMemoryPrompt";
const eventLimitKey = "code60.episodicMemoryMaxEvents";
const defaultEventLimit = 10_000;

export function parseMemoryEventLimit(value: string): number | undefined {
  if (!/^\d+$/.test(value)) return undefined;
  const limit = Number(value);
  return Number.isInteger(limit) && limit >= 1 && limit <= defaultEventLimit ? limit : undefined;
}

/** Retain the existing session/log order, stopping at the requested event count. */
export function limitMemoryEvents(runs: readonly { id: string; count: number }[], limit: number) {
  let remaining = limit;
  return runs.flatMap((run) => {
    const count = Math.min(run.count, remaining);
    remaining -= count;
    return count > 0 ? [{ id: run.id, count }] : [];
  });
}

export function formatExtractionDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 100) / 10);
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const wholeSeconds = Math.round(seconds);
  return `${Math.floor(wholeSeconds / 60)}m ${wholeSeconds % 60}s`;
}

export function EpisodicMemoryPage({
  api,
  directory,
  runs,
  data,
  provider,
}: {
  api: Pick<ApplicationClient, "extractMemory" | "cancelMemoryExtraction">;
  directory: string | null;
  runs: readonly DesktopRun[];
  data: Transcripts;
  provider: string | null;
}) {
  const [prompt, setPrompt] = useState(
    () => localStorage.getItem(promptKey) ?? DEFAULT_EPISODIC_MEMORY_PROMPT,
  );
  const [eventLimit, setEventLimit] = useState(() => {
    const saved = localStorage.getItem(eventLimitKey) ?? "";
    return String(parseMemoryEventLimit(saved) ?? defaultEventLimit);
  });
  const maxEvents = parseMemoryEventLimit(eventLimit);
  const limitError = maxEvents === undefined ? "Enter a whole number from 1 to 10,000." : "";
  const [editing, setEditing] = useState(false);
  const [result, setResult] = useState<MemoryExtractionResult>();
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef<string | undefined>(undefined);
  const alive = useRef(true);
  const editor = useRef<HTMLTextAreaElement>(null);
  const extractButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    alive.current = true;
    const cancelPending = () => {
      if (request.current) void api.cancelMemoryExtraction(request.current).catch(() => {});
    };
    window.addEventListener("pagehide", cancelPending);
    return () => {
      alive.current = false;
      window.removeEventListener("pagehide", cancelPending);
      cancelPending();
    };
  }, [api]);
  useEffect(() => {
    localStorage.setItem(promptKey, prompt);
  }, [prompt]);
  useEffect(() => {
    if (maxEvents !== undefined) localStorage.setItem(eventLimitKey, String(maxEvents));
  }, [maxEvents]);
  useEffect(() => {
    if (editing) editor.current?.focus();
  }, [editing]);
  const manifest = limitMemoryEvents(
    runs.map(({ record }) => ({ id: record.id, count: data.events[record.id]?.length ?? 0 })),
    maxEvents ?? 0,
  );
  const count = manifest.reduce((sum, run) => sum + run.count, 0);
  const loading =
    data.pending > 0 || runs.some(({ record }) => data.events[record.id] === undefined);
  const unavailable = Object.keys(data.errors).length > 0;
  const problem = !directory
    ? "Open a project to extract events."
    : !provider
      ? "Select an orchestration provider in Settings."
      : "";
  async function extract() {
    if (!directory || busy || !count || loading || unavailable || !prompt.trim() || problem) return;
    const requestId = randomId();
    request.current = requestId;
    setBusy(true);
    setError("");
    setStatus("Extracting…");
    const startedAt = performance.now();
    try {
      const next = await api.extractMemory({ requestId, directory, prompt, runs: manifest });
      if (alive.current && request.current === requestId) {
        setResult(next);
        const duration = formatExtractionDuration(performance.now() - startedAt);
        setStatus(
          next.statements.length
            ? `Extraction complete in ${duration}.`
            : `No important details found. Extraction took ${duration}.`,
        );
      }
    } catch (cause) {
      if (alive.current && request.current === requestId) {
        const message = cause instanceof Error ? cause.message : "Extraction failed";
        if (message.includes("Extraction cancelled")) setStatus("Extraction cancelled.");
        else {
          setError(message);
          setStatus("");
        }
      }
    } finally {
      if (request.current === requestId) {
        request.current = undefined;
        if (alive.current) setBusy(false);
      }
    }
  }
  async function cancel() {
    const id = request.current;
    if (!id) return;
    setStatus("Cancelling…");
    try {
      await api.cancelMemoryExtraction(id);
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : "Cancellation failed");
    }
  }
  return (
    <main className="episodic-memory" aria-label={pageDefinitions["episodic-memory"].label}>
      <header className="memory-heading">
        <PageTitle
          page="episodic-memory"
          as="h2"
          actions={[
            {
              id: "episodic-memory-0",
              label: "Edit prompt",
              checked: editing,
              run: () => setEditing(!editing),
            },
            {
              id: "episodic-memory-1",
              label: "Clear",
              run: () => {
                setResult(undefined);
                setError("");
                setStatus("");
                extractButton.current?.focus();
              },
              disabled: busy || (!result && !error && !status),
            },
          ]}
        />
      </header>
      <section
        id="memory-prompt-editor"
        className="memory-prompt"
        aria-label="Extraction prompt"
        hidden={!editing}
      >
        <label htmlFor="memory-prompt">Extraction prompt</label>
        <CarbonTextArea
          ref={editor}
          className="memory-prompt-input"
          id="memory-prompt"
          value={prompt}
          maxLength={8_000}
          disabled={busy}
          onChange={(event) => setPrompt(event.target.value)}
        />
        <div>
          <AppButton
            type="button"
            disabled={busy || prompt === DEFAULT_EPISODIC_MEMORY_PROMPT}
            onClick={() => setPrompt(DEFAULT_EPISODIC_MEMORY_PROMPT)}
          >
            Reset prompt
          </AppButton>
        </div>
      </section>
      <TranscriptNotice data={data} />
      <div className="memory-content" data-results={!!result}>
        <div className="memory-extract">
          <div className="memory-extraction-controls">
            <div className="memory-event-limit">
              <CarbonTextInput
                labelText={<>Maximum events</>}
                id="memory-event-limit"
                type="number"
                min={1}
                max={defaultEventLimit}
                step={1}
                value={eventLimit}
                disabled={busy}
                aria-invalid={!!limitError}
                aria-describedby={limitError ? "memory-event-limit-error" : undefined}
                onChange={(event) => setEventLimit(event.target.value)}
              />
            </div>
            {busy ? (
              <AppButton
                type="button"
                onClick={() => void cancel()}
                disabled={status === "Cancelling…"}
              >
                Cancel extraction
              </AppButton>
            ) : (
              <AppButton
                ref={extractButton}
                type="button"
                className="primary"
                disabled={!!problem || !count || loading || unavailable || !prompt.trim()}
                onClick={() => void extract()}
              >
                Extract from {count.toLocaleString()} events
              </AppButton>
            )}
          </div>
          {limitError && (
            <p id="memory-event-limit-error" role="alert" className="memory-notice">
              {limitError}
            </p>
          )}
          {problem && <p className="memory-notice muted">{problem}</p>}
          {status && (
            <p role="status" className="memory-notice">
              {status}
            </p>
          )}
          {error && (
            <p role="alert" className="error-banner">
              {error}
            </p>
          )}
        </div>
        {result && result.statements.length > 0 && (
          <ul className="memory-statements" aria-label="Extracted statements">
            {result.statements.map((statement) => (
              <li key={statement}>{statement}</li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
