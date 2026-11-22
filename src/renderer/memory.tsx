import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import type {
  DesktopApi,
  MemoryAction,
  MemoryDetail,
  MemorySettings,
  MemorySnapshot,
} from "../bridge/index.js";
import { InfoTip } from "./overlays.js";
import { SettingsCard, SettingsHeader } from "./settings-layout.js";

type Api = Pick<DesktopApi, "memorySnapshot" | "memoryAction" | "onMemoryChanged">;

export function MemoryPage({
  api,
  active = true,
  onManage,
}: {
  api: Api;
  active?: boolean;
  onManage(): void;
}) {
  const helpId = useId();
  const [snapshot, setSnapshot] = useState<MemorySnapshot>();
  const [optimistic, setOptimistic] = useState<MemorySettings>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const alive = useRef(false);
  const generation = useRef(0);
  const refresh = useRef<() => void>(() => {});
  useEffect(() => {
    if (!active) return;
    generation.current++;
    alive.current = true;
    let disposed = false;
    let running = false;
    let dirty = false;
    const read = async () => {
      if (running) {
        dirty = true;
        return;
      }
      running = true;
      try {
        do {
          dirty = false;
          const next = await api.memorySnapshot();
          if (disposed) return;
          setSnapshot(next);
        } while (dirty);
      } catch {
        if (!disposed) setError("Memory settings are unavailable. Refresh to try again.");
      } finally {
        running = false;
      }
    };
    refresh.current = () => {
      void read();
    };
    const off = api.onMemoryChanged(refresh.current);
    void read();
    return () => {
      disposed = true;
      generation.current++;
      alive.current = false;
      refresh.current = () => {};
      off();
    };
  }, [api, active]);
  async function action(value: MemoryAction) {
    if (inFlight.current) return;
    inFlight.current = true;
    const current = generation.current;
    setBusy(true);
    if (value.type === "configure") setOptimistic(value.settings);
    setError("");
    try {
      const accepted = await api.memoryAction(value);
      if (accepted && value.type === "configure" && alive.current && current === generation.current)
        setSnapshot((old) => (old ? { ...old, settings: value.settings } : old));
    } catch {
      if (alive.current && current === generation.current)
        setError("The change could not be confirmed. Refresh to check the saved settings.");
    } finally {
      inFlight.current = false;
      setOptimistic(undefined);
      setBusy(false);
      if (alive.current) {
        refresh.current();
      }
    }
  }
  const settings = optimistic ?? snapshot?.settings;
  const configure = (change: Partial<MemorySettings>) => {
    if (settings) void action({ type: "configure", settings: { ...settings, ...change } });
  };
  return (
    <section className="settings-section memory-page" aria-label="Memory">
      <SettingsHeader
        page="memory"
        actions={[
          {
            id: "memory-0",
            label: "Refresh",
            run: () => {
              setError("");
              refresh.current();
            },
            disabled: busy,
          },
        ]}
      >
        <span className="sr-only" id={helpId}>
          When on, Code60 learns useful information from conversations and uses relevant saved
          memories across Relay, project chats and workers. Memories, embeddings and search stay
          local. Creating memories sends conversation excerpts to your verified provider and may
          incur usage. Secret filtering is best effort, not a privacy guarantee. Memory never grants
          permissions or task authority. Automatic conversation handoffs are separate and may
          summarize the current conversation even when Memory is off.
        </span>
      </SettingsHeader>
      {error && (
        <div role="alert" className="error-banner">
          {error}
        </div>
      )}
      {snapshot?.warning && <div role="status">{snapshot.warning}</div>}
      {!settings ? (
        <div role="status">Loading memory settings…</div>
      ) : (
        <>
          <SettingsCard title="Memory">
            <label className="settings-row">
              Memory
              <input
                type="checkbox"
                role="switch"
                aria-describedby={helpId}
                checked={settings.enabled}
                aria-checked={settings.enabled}
                disabled={busy}
                onChange={(event) => configure({ enabled: event.target.checked })}
              />
            </label>
            {!settings.enabled && (
              <div className="settings-row" role="status">
                Memory is off. Saved memories and ordinary transcripts are kept. Information already
                supplied to an active conversation cannot be withdrawn.
              </div>
            )}
          </SettingsCard>
          <SettingsCard title="Saved memories">
            <div className="settings-row">
              <span>
                {snapshot?.count ?? 0} memories{" "}
                <InfoTip label="Saved memory scope">
                  Memories stay within their conversation or project unless you explicitly share
                  them across projects. Manage memories to inspect evidence, edit, pin, resolve
                  conflicts, share or delete records. Turning Memory off does not delete them.
                </InfoTip>
              </span>
              <button type="button" onClick={onManage}>
                Manage memories
              </button>
            </div>
            {snapshot?.indexFailed && settings.enabled && (
              <div className="settings-row">
                <span>Semantic search needs repair. Keyword recall remains available.</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void action({ type: "reindex" })}
                >
                  Repair search
                </button>
              </div>
            )}
          </SettingsCard>
          <SettingsCard title="Retention">
            <div className="settings-row">
              <span>
                <label htmlFor="memory-retention">
                  Automatically delete unpinned memories after
                </label>{" "}
                <InfoTip label="Memory retention" id="memory-retention-tip">
                  Deletes unpinned memories based on their creation date, including derived search
                  and revision data. Pinned memories and evidence needed by retained memories are
                  kept. Original transcripts are never deleted. Shortening retention requires
                  confirmation.
                </InfoTip>
              </span>
              <select
                id="memory-retention"
                aria-describedby="memory-retention-tip"
                value={settings.retentionDays}
                disabled={busy}
                onChange={(event) =>
                  configure({
                    retentionDays: Number(event.target.value) as MemorySettings["retentionDays"],
                  })
                }
              >
                <option value={0}>Never</option>
                <option value={30}>30 days</option>
                <option value={90}>90 days</option>
                <option value={365}>1 year</option>
              </select>
            </div>
          </SettingsCard>
        </>
      )}
    </section>
  );
}

const titleCase = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1).replaceAll("-", " ");
const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
function formatTime(value: string | null, empty = "Never"): string {
  if (!value) return empty;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? "Unknown" : when.format(at);
}
const speaker = (role: "human" | "assistant") => (role === "human" ? "You" : "Agent");

/** Source text with each cited quote marked, rendered as React text only. */
function CitedText({
  text,
  citations,
}: {
  text: string;
  citations: MemoryDetail["record"]["citations"];
}) {
  const ranges = citations
    .filter((c) => c.start >= 0 && c.end > c.start && text.slice(c.start, c.end) === c.quote)
    .sort((a, b) => a.start - b.start);
  const parts: ReactNode[] = [];
  let at = 0;
  for (const { start, end } of ranges) {
    if (end <= at) continue;
    if (start > at) parts.push(text.slice(at, start));
    parts.push(<mark key={`${start}:${end}`}>{text.slice(Math.max(at, start), end)}</mark>);
    at = end;
  }
  parts.push(text.slice(at));
  return <pre className="memory-source-text">{parts}</pre>;
}

export function MemoryInspector({
  detail,
  busy,
  names,
  onAction,
}: {
  detail: MemoryDetail;
  busy: boolean;
  names?: Pick<MemorySnapshot, "projects" | "conversations"> | undefined;
  onAction(action: MemoryAction): void;
}) {
  const m = detail.record;
  const [text, setText] = useState(m.text);
  const [pinned, setPinned] = useState(m.pinned);
  const identity = { id: m.id, revision: m.revision };
  const changed = text !== m.text || pinned !== m.pinned;
  const project = m.projectId
    ? (names?.projects.find((p) => p.id === m.projectId)?.label ?? "Unknown project")
    : "None";
  const conversation =
    names?.conversations.find((c) => c.id === m.conversationId)?.label ?? "Unknown conversation";
  const sources = new Map(detail.sources.map((source) => [source.id, source]));
  const facts: [string, ReactNode][] = [
    ["Subject", m.subject],
    [
      "Project",
      <span key="project" title={project}>
        {project.split(/[\\/]/).filter(Boolean).pop() ?? project}
      </span>,
    ],
    ["Conversation", conversation],
    ["Happened", formatTime(m.eventAt, "Unknown")],
    ["Created", formatTime(m.createdAt)],
    ...(m.updatedAt !== m.createdAt
      ? ([["Updated", formatTime(m.updatedAt)]] as [string, ReactNode][])
      : []),
    ["Last recalled", formatTime(m.lastUsedAt)],
    ["Generated by", m.provider || "Unknown"],
    ["Revision", String(m.revision)],
  ];
  return (
    <div className="memory-inspector">
      <ul className="memory-tags" aria-label="Memory attributes">
        <li className="memory-tag" data-state={m.state}>
          {titleCase(m.state)}
        </li>
        <li className="memory-tag">{titleCase(m.type)}</li>
        <li className="memory-tag">{titleCase(m.scope)}</li>
        <li className="memory-tag">{titleCase(m.evidence)}</li>
        {m.correction && <li className="memory-tag">Correction</li>}
        {m.pinned && <li className="memory-tag">Pinned</li>}
      </ul>
      <label className="memory-edit">
        <span className="field-label">Memory text</span>
        <textarea
          aria-label="Memory text"
          maxLength={2000}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      {m.condition && (
        <p className="memory-condition">
          <span className="field-label">Applies when</span>
          {m.condition}
        </p>
      )}
      <dl className="memory-facts">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <section className="memory-section" aria-label="Evidence">
        <h3>Evidence</h3>
        {detail.incomplete && (
          <p className="memory-muted" role="status">
            Some source messages are unavailable or were forgotten.
          </p>
        )}
        {m.citations.map((c) => {
          const source = sources.get(c.sourceId);
          return (
            <figure className="memory-citation" key={`${c.sourceId}:${c.start}:${c.end}`}>
              <blockquote>{c.quote}</blockquote>
              <figcaption>
                {source
                  ? `${speaker(source.role)} · ${formatTime(source.at, "Unknown")}`
                  : "Source unavailable"}
              </figcaption>
            </figure>
          );
        })}
        {detail.sources.length > 0 && (
          <details className="memory-disclosure">
            <summary>Source messages ({detail.sources.length})</summary>
            {detail.sources.map((s) => (
              <article className="memory-source" key={s.id}>
                <h4>
                  {speaker(s.role)} · {formatTime(s.at, "Unknown")}
                </h4>
                <CitedText
                  text={s.text}
                  citations={m.citations.filter((c) => c.sourceId === s.id)}
                />
              </article>
            ))}
          </details>
        )}
      </section>
      {detail.revisions.length > 0 && (
        <details className="memory-disclosure">
          <summary>Revision history ({detail.revisions.length})</summary>
          <ol className="memory-revisions" reversed>
            {[...detail.revisions]
              .sort((a, b) => b.revision - a.revision)
              .map((r) => (
                <li key={r.revision}>
                  <h4>
                    Revision {r.revision}
                    {r.revision === m.revision ? " (current)" : ""} · {formatTime(r.at, "Unknown")}
                  </h4>
                  <p>{r.text}</p>
                </li>
              ))}
          </ol>
        </details>
      )}
      <div className="memory-actions">
        <button
          type="button"
          className="danger-text"
          disabled={busy}
          onClick={() => onAction({ type: "forget", ...identity })}
        >
          Forget
        </button>
        <span className="memory-actions-end">
          <span className="memory-pin">
            <label>
              <input
                type="checkbox"
                checked={pinned}
                onChange={(e) => setPinned(e.target.checked)}
              />
              Pinned
            </label>
            <InfoTip label="Pinned">Pinned memories are never replaced automatically.</InfoTip>
          </span>
          {m.state === "disputed" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onAction({ type: "resolve", ...identity })}
            >
              Keep and pin this claim
            </button>
          )}
          <button
            type="button"
            disabled={busy || m.scope === "global"}
            onClick={() => onAction({ type: "promote", ...identity })}
          >
            Promote to global
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy || !changed || !text.trim()}
            onClick={() => onAction({ type: "edit", ...identity, text, pinned })}
          >
            Save changes
          </button>
        </span>
      </div>
    </div>
  );
}
