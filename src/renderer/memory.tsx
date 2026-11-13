import { useEffect, useRef, useState } from "react";
import {
  type DesktopApi,
  MEMORY_TYPES,
  type MemoryAction,
  type MemoryBrowse,
  type MemoryDetail,
  type MemorySettings,
  type MemorySnapshot,
  type MemoryPage as RecordsPage,
} from "../bridge/index.js";
import { InfoTip } from "./overlays.js";
import { SettingsCard, SettingsHeader } from "./settings-layout.js";

type Api = Pick<
  DesktopApi,
  "memorySnapshot" | "browseMemories" | "memoryDetail" | "memoryAction" | "onMemoryChanged"
>;
export function MemoryPage({ api }: { api: Api }) {
  const [snapshot, setSnapshot] = useState<MemorySnapshot>();
  const [draft, setDraft] = useState<MemorySettings>();
  const [query, setQuery] = useState<MemoryBrowse>({});
  const [page, setPage] = useState<RecordsPage>({ records: [], next: null });
  const [previousPages, setPreviousPages] = useState<(string | undefined)[]>([]);
  const [detail, setDetail] = useState<MemoryDetail>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [conversation, setConversation] = useState("");
  const alive = useRef(true);
  const request = useRef(0);
  const refresh = useRef<() => void>(() => {});
  useEffect(() => {
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
          const [next, records] = await Promise.all([
            api.memorySnapshot(),
            api.browseMemories(query),
          ]);
          if (disposed) return;
          setSnapshot(next);
          setPage(records);
        } while (dirty && !disposed);
      } catch {
        if (!disposed) setError("Memory is unavailable. Check storage, then Refresh.");
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
      alive.current = false;
      request.current++;
      off();
    };
  }, [api, query]);
  async function action(value: MemoryAction) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const accepted = await api.memoryAction(value);
      if (!alive.current) return;
      if (accepted) {
        if (value.type === "configure") setDraft(undefined);
        setDetail(undefined);
      }
      refresh.current();
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : "Memory action failed");
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function inspect(id: string) {
    const token = ++request.current;
    try {
      const next = await api.memoryDetail({ id });
      if (alive.current && token === request.current) setDetail(next);
    } catch {
      if (alive.current && token === request.current)
        setError("Memory changed or is unavailable. Refresh and try again.");
    }
  }
  function changeQuery(next: MemoryBrowse) {
    setPreviousPages([]);
    setQuery({ ...next, cursor: undefined });
    setDetail(undefined);
  }
  function more() {
    if (!page.next || busy) return;
    setPreviousPages((old) => [...old, query.cursor]);
    setQuery({ ...query, cursor: page.next });
    setDetail(undefined);
  }
  const settings = draft ?? snapshot?.settings;
  const update = (change: Partial<MemorySettings>) => {
    if (settings) setDraft({ ...settings, ...change });
  };
  return (
    <section className="settings-section memory-page" aria-label="Memory">
      <SettingsHeader
        title="Memory"
        tip="Automatic generation sends source text to your existing verified orchestration provider and may incur normal provider usage. Embeddings and search stay local. Memory is historical evidence, never permissions or task authority. Turning it off or forgetting cannot erase context already received by a running provider. A safe handoff refreshes that context. Original transcripts and manual RAG remain separate."
      >
        <button type="button" onClick={() => refresh.current()}>
          Refresh
        </button>
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
          <SettingsCard title="Enablement and privacy">
            {(
              [
                ["enabled", "Memory on"],
                ["relay", "Relay"],
                ["project", "Project chats"],
                ["worker", "Workers"],
                ["capture", "Capture new evidence"],
                ["generation", "Automatic generation"],
                ["recall", "Recall saved memories"],
                ["continuity", "Automatic checkpoints and handoff"],
              ] as const
            ).map(([key, label]) => (
              <label className="settings-row" key={key}>
                {label}
                <input
                  type="checkbox"
                  role="switch"
                  checked={settings[key]}
                  aria-checked={settings[key]}
                  disabled={busy}
                  onChange={(e) => update({ [key]: e.target.checked })}
                />
              </label>
            ))}
            <div className="settings-row">
              <span>Generation provider</span>
              <span>{snapshot?.provider ?? "No verified provider"}</span>
            </div>
            <div className="settings-row">
              <span>Secret filtering</span>
              <span>On, best effort, not a privacy guarantee</span>
            </div>
          </SettingsCard>
          <SettingsCard title="Context and automation">
            {(
              [
                ["rolloverPercent", "Rollover threshold (%)", 30, 85],
                ["capacity", "Unknown model capacity (estimated tokens)", 1024, 2_000_000],
                ["checkpointTokens", "Checkpoint token cap", 128, 8000],
                ["recallTokens", "Recalled memory token cap", 0, 16000],
                ["cadenceSeconds", "Generation delay (seconds)", 0, 3600],
                ["dailyCalls", "Daily generation call limit", 1, 1000],
              ] as const
            ).map(([key, label, min, max]) => (
              <label className="settings-row" key={key} htmlFor={`memory-${key}`}>
                {label}
                <MemoryNumber
                  id={`memory-${key}`}
                  min={min}
                  max={max}
                  value={settings[key]}
                  disabled={busy}
                  onChange={(value) => update({ [key]: value })}
                />
              </label>
            ))}
            <div className="settings-row">
              <span>Generation calls today</span>
              <span>
                {snapshot?.dailyCalls ?? 0} / {settings.dailyCalls}
              </span>
            </div>
            <div className="settings-row">
              <span>Context estimate</span>
              <InfoTip label="Context estimate">
                Provider-reported usage takes priority. When unavailable, Code60 conservatively
                counts UTF-8 bytes, not the Jina tokenizer. Capacity includes a 15% output reserve.
                Oversized requests are not silently truncated.
              </InfoTip>
            </div>
          </SettingsCard>
          <SettingsCard title="Memory types and retention">
            {MEMORY_TYPES.map((type) => (
              <div className="settings-row" key={type}>
                <span>{type}</span>
                <label>
                  <input
                    type="checkbox"
                    checked={settings.generateTypes[type]}
                    disabled={busy}
                    onChange={(e) =>
                      update({
                        generateTypes: { ...settings.generateTypes, [type]: e.target.checked },
                      })
                    }
                  />{" "}
                  Generate {type}
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={settings.types[type]}
                    disabled={busy}
                    onChange={(e) =>
                      update({ types: { ...settings.types, [type]: e.target.checked } })
                    }
                  />{" "}
                  Recall {type}
                </label>
                <label htmlFor={`memory-retention-${type}`}>
                  Retention days (0 = no expiry){" "}
                  <MemoryNumber
                    id={`memory-retention-${type}`}
                    min={0}
                    max={3650}
                    value={settings.retentionDays[type]}
                    disabled={busy}
                    onChange={(days) =>
                      update({ retentionDays: { ...settings.retentionDays, [type]: days } })
                    }
                  />
                </label>
              </div>
            ))}
            <div className="settings-row">
              <span>Sharing</span>
              <span>Project-local; global promotion requires confirmation</span>
            </div>
            <div className="settings-row">
              <span>Private store</span>
              <span>
                {snapshot?.count ?? 0} memories, {((snapshot?.bytes ?? 0) / 1_048_576).toFixed(1)} /
                512 MiB
              </span>
            </div>
            <div className="settings-row">
              <span>Awaiting semantic indexing</span>
              <span>{snapshot?.indexPending ?? 0}</span>
            </div>
            {(snapshot?.bytes ?? 0) > 450 * 1_048_576 && (
              <div role="status">
                Memory storage is nearly full. Forget unused derived memories.
              </div>
            )}
          </SettingsCard>
          <div className="settings-actions">
            <button
              type="button"
              disabled={!draft || busy}
              onClick={() => void action({ type: "configure", settings })}
            >
              Save memory settings
            </button>
            <button type="button" disabled={!draft || busy} onClick={() => setDraft(undefined)}>
              Discard changes
            </button>
          </div>
        </>
      )}
      <SettingsCard title="Conversation privacy and maintenance">
        <label className="settings-row">
          Conversation
          <select
            aria-label="Conversation"
            value={conversation}
            onChange={(e) => setConversation(e.target.value)}
          >
            <option value="">Select conversation</option>
            {snapshot?.conversations.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        {conversation && (
          <label className="settings-row">
            Do not remember
            <input
              type="checkbox"
              disabled={busy}
              checked={
                snapshot?.conversations.find((c) => c.id === conversation)?.remember === false
              }
              onChange={(e) =>
                void action({
                  type: "remember",
                  conversationId: conversation,
                  enabled: !e.target.checked,
                })
              }
            />
          </label>
        )}
        <div className="settings-row">
          <button
            type="button"
            disabled={busy || !conversation || snapshot?.busy}
            onClick={() => void action({ type: "generate", conversationId: conversation })}
          >
            Generate now
          </button>
          <button type="button" disabled={busy} onClick={() => void action({ type: "reindex" })}>
            Rebuild search index
          </button>
        </div>
      </SettingsCard>
      <SettingsHeader
        title="Memories"
        tip="Filter records and inspect exact source evidence, attribution, revisions and last use. Disputed memories are not recalled. Promotion and forgetting require native confirmation."
      />
      <SettingsCard>
        <div className="memory-filters">
          <label>
            Project{" "}
            <select
              value={query.projectId ?? ""}
              onChange={(e) => {
                setDetail(undefined);
                changeQuery({ ...query, projectId: e.target.value || undefined });
              }}
            >
              <option value="">All projects</option>
              {snapshot?.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Type{" "}
            <select
              value={query.type ?? ""}
              onChange={(e) =>
                changeQuery({
                  ...query,
                  type: (e.target.value as MemoryBrowse["type"]) || undefined,
                })
              }
            >
              <option value="">All types</option>
              {MEMORY_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label>
            Status{" "}
            <select
              value={query.state ?? ""}
              onChange={(e) =>
                changeQuery({
                  ...query,
                  state: (e.target.value as MemoryBrowse["state"]) || undefined,
                })
              }
            >
              <option value="">All statuses</option>
              {["active", "disputed", "stale", "superseded"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => changeQuery({ ...query, state: "disputed" })}>
            Review conflicts
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void action({ type: "forget-scope", projectId: query.projectId ?? null })
            }
          >
            {query.projectId ? "Forget project memories" : "Forget conversation-local memories"}
          </button>
        </div>
        <ul className="memory-list">
          {page.records.map((m) => (
            <li key={m.id}>
              <button type="button" onClick={() => void inspect(m.id)}>
                {m.type} · {m.state} · {m.text}
              </button>
            </li>
          ))}
        </ul>
        {!page.records.length && <div>No memories in this view.</div>}
        {previousPages.length > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setQuery({ ...query, cursor: previousPages.at(-1) });
              setPreviousPages((old) => old.slice(0, -1));
              setDetail(undefined);
            }}
          >
            Previous page
          </button>
        )}
        {page.next && (
          <button type="button" disabled={busy} onClick={more}>
            Load more
          </button>
        )}
      </SettingsCard>
      {detail && (
        <MemoryInspector
          key={`${detail.record.id}:${detail.record.revision}`}
          detail={detail}
          busy={busy}
          onAction={(value) => void action(value)}
        />
      )}
    </section>
  );
}

function MemoryNumber({
  id,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  id: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange(value: number): void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const number = text.trim() ? Number(text) : NaN;
  const valid = Number.isInteger(number) && number >= min && number <= max;
  return (
    <input
      id={id}
      type="number"
      min={min}
      max={max}
      value={text}
      disabled={disabled}
      aria-invalid={!valid}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        const parsed = next.trim() ? Number(next) : NaN;
        if (Number.isInteger(parsed) && parsed >= min && parsed <= max) onChange(parsed);
      }}
      onBlur={() => {
        if (!valid) setText(String(value));
      }}
    />
  );
}

function MemoryInspector({
  detail,
  busy,
  onAction,
}: {
  detail: MemoryDetail;
  busy: boolean;
  onAction(action: MemoryAction): void;
}) {
  const m = detail.record;
  const [text, setText] = useState(m.text);
  const [pinned, setPinned] = useState(m.pinned);
  const identity = { id: m.id, revision: m.revision };
  return (
    <SettingsCard title="Memory evidence and revisions">
      <div className="settings-row">
        <span>
          {m.type} · {m.state} · {m.scope} · {m.evidence}
        </span>
        <span>{m.id}</span>
      </div>
      <div className="settings-row">
        <span>Event: {m.eventAt}</span>
        <span>Created: {m.createdAt}</span>
      </div>
      <div className="settings-row">
        <span>
          Generator: {m.provider}, prompt v{m.promptVersion}
        </span>
        <span>Last used: {m.lastUsedAt ?? "Never"}</span>
      </div>
      {m.condition && <div>Applies when: {m.condition}</div>}
      {m.supersedes && <div>Supersedes: {m.supersedes}</div>}
      <label className="memory-edit">
        Memory text
        <textarea maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <label>
        <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />{" "}
        Pinned, protect from automatic replacement
      </label>
      <div className="settings-actions">
        <button
          type="button"
          disabled={busy || !text.trim()}
          onClick={() => onAction({ type: "edit", ...identity, text, pinned })}
        >
          Save edit
        </button>
        <button
          type="button"
          disabled={busy || m.scope === "global"}
          onClick={() => onAction({ type: "promote", ...identity })}
        >
          Promote to global
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onAction({ type: "forget", ...identity })}
        >
          Forget
        </button>
        {m.state === "disputed" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onAction({ type: "resolve", ...identity })}
          >
            Keep and pin this claim
          </button>
        )}
      </div>
      <details>
        <summary>Source evidence ({detail.sources.length})</summary>
        {detail.incomplete && (
          <div role="status">Some source evidence is unavailable or was forgotten.</div>
        )}
        {detail.sources.map((s) => (
          <article key={s.id}>
            <h3>
              {s.role} · {s.at} · turn {s.ordinal}
            </h3>
            <div>
              {s.id}, source offset {s.start}
            </div>
            <pre>{s.text}</pre>
          </article>
        ))}
        {m.citations.map((c) => (
          <blockquote key={`${c.sourceId}:${c.start}:${c.end}`}>
            {c.quote} ({c.sourceId}, {c.start}–{c.end})
          </blockquote>
        ))}
      </details>
      <details>
        <summary>Revisions</summary>
        {detail.revisions.map((r) => (
          <article key={r.revision}>
            <h3>
              Revision {r.revision} · {r.at}
            </h3>
            <pre>{r.text}</pre>
          </article>
        ))}
      </details>
    </SettingsCard>
  );
}
