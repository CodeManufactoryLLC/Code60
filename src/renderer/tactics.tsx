import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  findTactic,
  searchTactics,
  TACTIC_SHARED_INSTRUCTIONS,
  TACTICS,
  type Tactic,
} from "../bridge/index.js";
import { Icon } from "./icons.js";
import { Modal } from "./modal.js";
import "./tactics.css";

function Workflow({ tactic }: { tactic: Tactic }) {
  const id = useId();
  const position = (nodeId: string) => {
    const node = tactic.nodes.find((node) => node.id === nodeId);
    const siblings = tactic.nodes.filter((other) => other.stage === node?.stage);
    return {
      x: (node?.stage ?? 0) * 200 + 4,
      y: siblings.length > 1 ? 35 + siblings.findIndex((node) => node.id === nodeId) * 50 : 60,
    };
  };
  return (
    <figure className="tactic-workflow">
      <svg viewBox="0 0 568 120" role="img" aria-labelledby={id}>
        <title id={id}>{`${tactic.nodes.map((node) => node.label).join(", then ")}.`}</title>
        {tactic.edges.map((edge) => {
          const a = position(edge.from),
            b = position(edge.to);
          return (
            <path
              key={`${edge.from}-${edge.to}`}
              d={`M${a.x + 164} ${a.y}H${a.x + 182}V${b.y}H${b.x - 2}m-5 -4 5 4-5 4`}
              className="tactic-edge"
            />
          );
        })}
        {tactic.nodes.map((node) => {
          const p = position(node.id);
          return (
            <g key={node.id}>
              <rect x={p.x} y={p.y - 17} width="164" height="34" />
              <text x={p.x + 82} y={p.y} dominantBaseline="central" textAnchor="middle">
                {node.label}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

export function TacticsDialog({
  selected,
  onApply,
  onClose,
}: {
  selected: string | null | undefined;
  onApply(id: string): Promise<boolean>;
  onClose(): void;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [previewId, setPreviewId] = useState(findTactic(selected)?.id ?? TACTICS[0]?.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const matches = useMemo(() => searchTactics(query), [query]);
  const preview = matches.find((tactic) => tactic.id === previewId) ?? matches[0];
  const list = useRef<HTMLFieldSetElement>(null);
  const navigate = (key: string, current: HTMLElement | null) => {
    const choices = [
      ...(list.current?.querySelectorAll<HTMLInputElement>('input[type="radio"]') ?? []),
    ];
    if (!choices.length) return;
    const index = choices.indexOf(current as HTMLInputElement);
    const next =
      key === "Home"
        ? 0
        : key === "End"
          ? choices.length - 1
          : (index + (key === "ArrowUp" ? -1 : 1) + choices.length) % choices.length;
    const choice = choices[next];
    if (choice) {
      setPreviewId(choice.value);
      choice.focus();
    }
  };
  return (
    <Modal title="Tactics" busy={busy} wide className="tactics-dialog" onClose={onClose}>
      <div className="tactics-layout">
        <section className="tactics-browser" aria-label="Available tactics">
          <label className="sr-only" htmlFor={`${id}-search`}>
            Search tactics
          </label>
          <div className="tactics-search">
            <Icon name="search" />
            <input
              id={`${id}-search`}
              type="search"
              value={query}
              placeholder="Search tactics"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  const choice =
                    list.current?.querySelector<HTMLInputElement>("input:checked") ??
                    list.current?.querySelector<HTMLInputElement>("input");
                  choice?.focus();
                }
              }}
            />
          </div>
          <p className="sr-only" role="status">
            {matches.length} {matches.length === 1 ? "tactic found" : "tactics found"}.
          </p>
          <fieldset
            ref={list}
            className="tactics-list"
            onKeyDown={(event) => {
              if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                event.preventDefault();
                navigate(event.key, event.target as HTMLElement);
              }
            }}
          >
            <legend className="sr-only">Preview a tactic, then Apply to chat</legend>
            {matches.map((tactic) => (
              <label
                key={tactic.id}
                className="tactics-option"
                data-preview={preview?.id === tactic.id}
              >
                <input
                  type="radio"
                  name={`${id}-preview`}
                  value={tactic.id}
                  checked={preview?.id === tactic.id}
                  onChange={() => setPreviewId(tactic.id)}
                />
                <span>{tactic.title}</span>
                {selected === tactic.id && (
                  <>
                    <Icon name="checkmark" />
                    <span className="sr-only">Applied to chat</span>
                  </>
                )}
              </label>
            ))}
          </fieldset>
          {!matches.length && <p className="tactics-empty">No matching tactics.</p>}
        </section>
        <section className="tactics-details" aria-label="Tactic details">
          {preview && (
            <>
              <header className="tactic-heading">
                <h3>{preview.title}</h3>
                <button
                  type="button"
                  className="primary"
                  disabled={busy || selected === preview.id}
                  onClick={async () => {
                    if (busy) return;
                    setBusy(true);
                    setError("");
                    try {
                      if (await onApply(preview.id)) onClose();
                      else setError("The tactic could not be saved. Try Apply again.");
                    } catch {
                      setError("The tactic could not be saved. Try Apply again.");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {busy ? "Saving…" : selected === preview.id ? "Applied" : "Apply to chat"}
                </button>
              </header>
              {error && <p role="alert">{error}</p>}
              <div className="tactic-content" key={preview.id}>
                <Workflow tactic={preview} />
                <dl className="tactic-facts">
                  <div>
                    <dt>Workers</dt>
                    <dd>{preview.roles}</dd>
                  </div>
                  <div>
                    <dt>Output</dt>
                    <dd>{preview.output}</dd>
                  </div>
                  {preview.limit && (
                    <div>
                      <dt>Limit</dt>
                      <dd>{preview.limit}</dd>
                    </div>
                  )}
                  {preview.approval && (
                    <div>
                      <dt>Approval</dt>
                      <dd>{preview.approval}</dd>
                    </div>
                  )}
                </dl>
                <details className="tactic-disclosure">
                  <summary>Orchestrator prompt</summary>
                  <p className="tactic-prompt">{preview.prompt}</p>
                  <details>
                    <summary>Shared instructions</summary>
                    <p className="tactic-prompt">{TACTIC_SHARED_INSTRUCTIONS}</p>
                  </details>
                </details>
                <details className="tactic-disclosure">
                  <summary>How this tactic works</summary>
                  <p>{preview.description}</p>
                  <p>{preview.help}</p>
                  <p>
                    Selection applies to the next human request. Applying does not send. Roles and
                    limits guide the orchestrator; they do not add permissions or runtime
                    guarantees.
                  </p>
                </details>
              </div>
            </>
          )}
        </section>
      </div>
    </Modal>
  );
}

export function TacticsControl({
  selection,
  disabled,
  active,
  context,
  onChange,
}: {
  selection: string | null | undefined;
  disabled: boolean;
  active: boolean;
  context: string;
  onChange(id: string | null): Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const selected = findTactic(selection);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Scope changes must dismiss stale modal previews.
  useEffect(() => {
    setOpen(false);
    setNotice("");
  }, [active, context]);
  const change = async (id: string | null) => {
    const ok = await onChange(id);
    if (ok)
      setNotice(
        id
          ? `${findTactic(id)?.title ?? id} applied to this chat.`
          : "Tactic removed from this chat.",
      );
    return ok;
  };
  return (
    <div className="tactics-control">
      <button
        ref={trigger}
        type="button"
        className="tactics-trigger"
        disabled={disabled || busy}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={
          selection
            ? `Change tactic: ${selected?.title ?? `Unavailable (${selection})`}`
            : "Tactics"
        }
        onClick={() => setOpen(true)}
      >
        <Icon name={selected ? "checkmark" : "branch"} />
        <span>{selected?.title ?? (selection ? "Unavailable tactic" : "Tactics")}</span>
        <Icon name="chevron--down" />
      </button>
      {selection && (
        <button
          type="button"
          className="icon-button"
          aria-label="Remove tactic"
          disabled={disabled || busy}
          onClick={async () => {
            setBusy(true);
            try {
              if (await change(null)) trigger.current?.focus();
            } finally {
              setBusy(false);
            }
          }}
        >
          <Icon name="close" />
        </button>
      )}
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {notice}
      </span>
      {selection && !selected && (
        <span className="tactic-unavailable" role="status">
          Replace or clear this unavailable tactic before sending.
        </span>
      )}
      {open && active && (
        <TacticsDialog selected={selection} onApply={change} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}
