import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import {
  type ApplicationClient,
  decodeMcpText,
  encodeMcpText,
  MCP_EMPTY_TEXT,
  type McpBackupEntry,
  type McpBackupPreview,
  type McpManagementResult,
  type McpManagementTargets,
  type McpResetPreview,
  type McpTargetAddress,
  type McpTextIssue,
} from "../bridge/index.js";
import { randomId } from "./browser-platform.js";
import type { TableOptions } from "./data-table.js";
import {
  type McpDraft,
  mcpDraftState,
  newMcpDraft,
  observeMcpDraft,
  sameMcpOwner,
} from "./mcp-draft.js";
import type { McpEditorView } from "./mcp-json-editor.js";
import { McpRecoveryPanel } from "./mcp-recovery.js";
import { McpServersPage } from "./mcp-servers.js";
import { McpTroubleshooting } from "./mcp-troubleshooting.js";
import { Modal } from "./modal.js";
import { PageTitle } from "./page-title.js";

const JsonEditor = lazy(() => import("./mcp-json-editor.js"));
const Diff = lazy(() => import("./monaco-diff.js"));
const failure = (cause: unknown) => {
  const explain = (code: string, detail: string) =>
    `MCP_CONFIG_${code}: ${detail} Other application features and available tools remain usable.`;
  const text = cause instanceof Error ? cause.message : "";
  if (text.includes("conflict"))
    return explain(
      "CONFLICT",
      "Configuration, project or backup changed. Your draft is retained. Reload or compare before trying again.",
    );
  if (text.includes("recovery-required"))
    return explain(
      "RECOVERY_REQUIRED",
      "Configuration recovery is required. Your draft is retained; preserve the transaction evidence.",
    );
  if (text.includes("invalid"))
    return explain(
      "INVALID",
      "Configuration or backup is invalid. Review the format and choose a valid, unpinned backup.",
    );
  if (text.includes("storage-limit"))
    return explain(
      "STORAGE_LIMIT",
      "Storage limit reached. Preserve pending evidence and review backups.",
    );
  return explain(
    "UNAVAILABLE",
    "MCP configuration storage is unavailable or unsafe. Your draft is retained. Review storage ownership, permissions and free space, then explicitly reload or compare before saving.",
  );
};
export function McpWorkspace({
  api,
  active,
  contextKey,
  ...table
}: Pick<TableOptions, "lines" | "density" | "fit" | "textStyles"> & {
  api: ApplicationClient;
  active: boolean;
  contextKey: string;
}) {
  const [mode, setMode] = useState<"servers" | "json">("servers");
  const [scope, setScope] = useState("user");
  const [targets, setTargets] = useState<McpManagementTargets>();
  const [draft, setDraft] = useState<McpDraft>();
  const [visible, setVisible] = useState(
    typeof document === "undefined" || document.visibilityState !== "hidden",
  );
  const [formDirty, setFormDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [compare, setCompare] = useState(false);
  const [issueLocation, setIssueLocation] = useState<{ issue: McpTextIssue; key: string }>();
  const [guard, setGuard] = useState<{ title: string; proceed(): void }>();
  const [backups, setBackups] = useState<McpBackupEntry[]>();
  const [backup, setBackup] = useState<
    McpBackupPreview & {
      target: McpTargetAddress;
      expectedRevision: string;
    }
  >();
  const [reset, setReset] = useState<McpResetPreview>();
  const sequence = useRef(0);
  const requests = useRef<{ key: string; id: string } | undefined>(undefined);
  const pending = useRef(false);
  const awake = useRef(active && visible);
  awake.current = active && visible;
  const current = useRef(draft);
  current.current = draft;
  const view = useRef<McpEditorView["current"]>(null);
  const state = draft ? mcpDraftState(draft) : undefined;
  const target = targets?.targets.find((t) =>
    scope === "user" ? t.address.scope === "user" : t.address.targetId === scope,
  );
  const context = useRef(contextKey);
  context.current = contextKey;
  const load = useCallback(async () => {
    if (!awake.current) return;
    const token = ++sequence.current;
    try {
      const list = await api.mcpTargets();
      if (!awake.current || token !== sequence.current || contextKey !== context.current) return;
      setTargets(list);
      const selected = list.targets.find((t) =>
        scope === "user" ? t.address.scope === "user" : t.address.targetId === scope,
      );
      if (!selected) {
        setDraft((v) => (v ? { ...v, ownerLost: true } : v));
        setError(
          "This configuration owner is unavailable. Reopen the project and explicitly reload or select its new configuration.",
        );
        return;
      }
      const value = await api.mcpReadText(selected.address);
      if (!awake.current || token !== sequence.current || contextKey !== context.current) return;
      setDraft((v) => (v ? observeMcpDraft(v, value) : newMcpDraft(value)));
    } catch (cause) {
      if (awake.current && token === sequence.current) {
        setDraft((v) => (v ? { ...v, ownerLost: true } : v));
        setError(failure(cause));
      }
    }
  }, [api, scope, contextKey]);
  useEffect(() => {
    const change = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, []);
  useEffect(() => {
    if (active && visible) void load();
    return () => {
      sequence.current++;
    };
  }, [load, active, visible]);
  useEffect(
    () =>
      api.onMcpChanged(() => {
        if (awake.current) void load();
      }),
    [api, load],
  );
  useEffect(() => {
    if (!state?.dirty && !formDirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state?.dirty, formDirty]);
  const requestId = (value: unknown) => {
    const key = JSON.stringify(value);
    if (requests.current?.key !== key) requests.current = { key, id: randomId() };
    return requests.current.id;
  };
  async function reload() {
    if (!target) throw new Error("MCP configuration conflict");
    const token = ++sequence.current;
    const ownerContext = context.current;
    const value = await api.mcpReadText(target.address);
    if (token !== sequence.current || !awake.current || ownerContext !== context.current)
      throw new Error("MCP configuration conflict");
    setDraft(newMcpDraft(value));
    setError("");
    setCompare(false);
  }
  async function mutate(
    value: unknown,
    action: (requestId: string) => Promise<McpManagementResult>,
  ) {
    if (pending.current || !draft) return false;
    pending.current = true;
    setBusy(true);
    setError("");
    const owner = draft.saved.target;
    const ownerContext = context.current;
    setDraft((v) => (v ? { ...v, hold: true } : v));
    try {
      const result = await action(requestId(value));
      if (result.status === "recovery-required") {
        setError(
          "Configuration recovery is required. Your draft is retained; preserve the transaction evidence.",
        );
        await load();
        return false;
      }
      const saved = await api.mcpReadText(owner);
      if (!sameMcpOwner(current.current?.saved.target, owner) || ownerContext !== context.current)
        throw new Error("MCP configuration conflict");
      setDraft(newMcpDraft(saved));
      setError("");
      setCompare(false);
      return true;
    } catch (cause) {
      setError(failure(cause));
      await load();
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function saveText() {
    if (!draft || !mcpDraftState(draft).canSave) return false;
    const value = {
      target: draft.saved.target,
      expectedRevision: draft.saved.revision,
      contentBase64: encodeMcpText(draft.text),
    };
    return mutate(value, (requestId) => api.mcpSaveText({ ...value, requestId }));
  }
  function navigate(proceed: () => void) {
    if (state?.dirty) setGuard({ title: "Unsaved MCP JSON changes", proceed });
    else proceed();
  }
  function select(next: string) {
    if (next === scope) return;
    navigate(() => {
      sequence.current++;
      setDraft(undefined);
      current.current = undefined;
      setScope(next);
      setError("");
      setBackup(undefined);
      setBackups(undefined);
      setReset(undefined);
      view.current = null;
    });
  }
  async function openBackups() {
    if (!draft) return;
    setError("");
    setBackup(undefined);
    const owner = draft.saved.target;
    const ownerContext = context.current;
    try {
      const list = await api.mcpBackups(owner);
      if (
        awake.current &&
        ownerContext === context.current &&
        sameMcpOwner(current.current?.saved.target, owner)
      )
        setBackups(list);
    } catch (cause) {
      setError(failure(cause));
    }
  }
  async function openReset(includeUser: boolean) {
    if (!draft) return;
    setError("");
    const owner = draft.saved.target;
    const ownerContext = context.current;
    try {
      const preview = await api.mcpPreviewReset({ target: owner, includeUser });
      if (
        awake.current &&
        ownerContext === context.current &&
        sameMcpOwner(current.current?.saved.target, owner)
      )
        setReset(preview);
    } catch (cause) {
      setError(failure(cause));
    }
  }
  return (
    <section className="mcp-workspace">
      <div className="mcp-workspace-controls">
        <fieldset className="segmented">
          <legend className="sr-only">MCP configuration view</legend>
          <button
            type="button"
            aria-pressed={mode === "servers"}
            disabled={busy}
            onClick={() => navigate(() => setMode("servers"))}
          >
            Servers
          </button>
          <button
            type="button"
            aria-pressed={mode === "json"}
            disabled={busy}
            onClick={() => setMode("json")}
          >
            JSON
          </button>
        </fieldset>
        {mode === "json" && (
          <label>
            Configuration
            <select
              aria-label="Configuration"
              value={scope}
              disabled={busy}
              onChange={(e) => select(e.target.value)}
            >
              <option value="user">User</option>
              {targets?.targets
                .filter((t) => t.address.scope === "project")
                .map((t) => (
                  <option key={t.address.targetId} value={t.address.targetId}>
                    {t.label}
                  </option>
                ))}
              {scope !== "user" && !targets?.targets.some((t) => t.address.targetId === scope) && (
                <option value={scope}>Unavailable project</option>
              )}
            </select>
          </label>
        )}
        <button type="button" disabled={busy || !draft} onClick={() => void openBackups()}>
          Restore backup
        </button>
        <button
          type="button"
          disabled={
            busy || !draft || Boolean(draft.latest.pendingRecovery.length) || draft.ownerLost
          }
          onClick={() => void openReset(false)}
        >
          Reset this configuration
        </button>
        {target?.address.scope === "project" && (
          <button
            type="button"
            disabled={
              busy || !draft || Boolean(draft.latest.pendingRecovery.length) || draft.ownerLost
            }
            onClick={() => void openReset(true)}
          >
            Reset User and this project
          </button>
        )}
      </div>
      {target && (
        <McpTroubleshooting api={api} target={target.address} active={active && visible} />
      )}
      {target && (
        <McpRecoveryPanel
          api={api}
          target={target.address}
          active={active && visible}
          dirty={Boolean(state?.dirty || formDirty)}
          onChanged={() => {
            void load();
          }}
        />
      )}
      {error && <p role="alert">{error}</p>}
      {draft?.ownerLost && (
        <button
          type="button"
          disabled={busy}
          onClick={() => setGuard({ title: "Reload MCP configuration?", proceed: () => {} })}
        >
          Reload configuration
        </button>
      )}
      {mode === "servers" ? (
        <McpServersPage
          api={api}
          active={active && visible}
          contextKey={contextKey}
          configuration={{ scope, select }}
          onFormDirty={setFormDirty}
          readOnly={draft?.ownerLost ?? false}
          {...table}
        />
      ) : (
        <>
          <PageTitle page="mcp-servers" />
          <p>
            Save writes this dedicated configuration exactly for future sessions. Existing
            connections keep their captured state. Use credential references; resolved credentials
            are never inserted here.
          </p>
          {draft && state && (
            <>
              <div className="mcp-json-actions">
                <button
                  type="button"
                  disabled={busy || !state.canSave}
                  onClick={() => void saveText()}
                >
                  Save configuration
                </button>
                <button
                  type="button"
                  disabled={busy || !state.editable || !state.validation.valid}
                  onClick={() =>
                    setDraft((v) =>
                      v ? { ...v, text: `${JSON.stringify(JSON.parse(v.text), null, 2)}\n` } : v,
                    )
                  }
                >
                  Format JSON
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setGuard({ title: "Discard MCP changes?", proceed: () => {} })}
                >
                  Discard changes
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setCompare(true);
                    void load();
                  }}
                >
                  Compare saved and draft
                </button>
                <span role="status">{state.dirty ? "Unsaved changes" : "Saved"}</span>
              </div>
              {state.stale && (
                <p role="alert">
                  Configuration or owner changed. Your draft is retained. Compare or explicitly
                  discard/reload before saving.
                </p>
              )}
              {state.blocked && (
                <p role="alert">
                  Pending recovery blocks writes. Preserve private evidence and follow the MCP
                  configuration recovery runbook.
                </p>
              )}
              {!state.editable && (
                <p role="alert">
                  The original file is not valid UTF-8. Use a valid backup or a confirmed reset; the
                  original bytes remain protected.
                </p>
              )}
              {!state.validation.valid && (
                <ul aria-label="Configuration issues">
                  {state.validation.issues.map((issue) => (
                    <li key={`${issue.code}:${issue.line}:${issue.column}:${issue.path.join(".")}`}>
                      <button
                        type="button"
                        onClick={() => setIssueLocation({ issue, key: randomId() })}
                      >
                        {issue.message} Line {issue.line}, column {issue.column}.
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <Suspense fallback={<p role="status">Loading JSON editor…</p>}>
                <JsonEditor
                  text={draft.text}
                  issues={state.validation.issues}
                  reveal={issueLocation}
                  active={active && visible}
                  key={JSON.stringify(draft.saved.target)}
                  editable={state.editable && !busy}
                  canSave={state.canSave && !busy}
                  view={view}
                  onChange={(text) => setDraft((v) => (v ? { ...v, text } : v))}
                  onSave={() => void saveText()}
                />
              </Suspense>
              {compare && (
                <section aria-label="Saved versus draft">
                  <h2>Saved versus Draft</h2>
                  <Suspense fallback={<p>Loading comparison…</p>}>
                    <Diff
                      original={
                        draft.latest.contentBase64 === null
                          ? draft.latest.exists
                            ? ""
                            : MCP_EMPTY_TEXT
                          : decodeMcpText(draft.latest.contentBase64)
                      }
                      modified={draft.text}
                      path="mcp.json"
                      address={`mcp:${draft.latest.revision}`}
                      originalLabel="Saved configuration"
                      modifiedLabel="Your configuration draft"
                    />
                  </Suspense>
                  <button type="button" onClick={() => setCompare(false)}>
                    Close comparison
                  </button>
                </section>
              )}
            </>
          )}
        </>
      )}
      {active && visible && guard && (
        <Modal title={guard.title} busy={busy} onClose={() => setGuard(undefined)}>
          <p>
            Save the JSON draft, discard it and read the latest saved configuration, or cancel.
            Discard never writes the file.
          </p>
          <div className="dialog-actions">
            <button type="button" disabled={busy} onClick={() => setGuard(undefined)}>
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void reload().then(
                  () => {
                    setGuard(undefined);
                    guard.proceed();
                  },
                  (cause) => setError(failure(cause)),
                );
              }}
            >
              Discard
            </button>
            <button
              type="button"
              disabled={busy || !state?.canSave}
              onClick={() => {
                void saveText().then((saved) => {
                  if (saved) {
                    setGuard(undefined);
                    guard.proceed();
                  }
                });
              }}
            >
              Save
            </button>
          </div>
        </Modal>
      )}
      {active && visible && backups && (
        <Modal
          title="Restore MCP backup"
          wide
          busy={busy}
          onClose={() => {
            setBackups(undefined);
            setBackup(undefined);
          }}
        >
          <p>
            Only valid, unpinned backups can be restored. Malformed and pinned preimages remain
            private recovery evidence.
          </p>
          {backups.length ? (
            <label>
              Backup
              <select
                aria-label="Backup"
                defaultValue=""
                disabled={busy}
                onChange={(e) => {
                  const backupId = e.target.value;
                  setBackup(undefined);
                  if (draft) {
                    const token = ++sequence.current;
                    const captured = draft.saved;
                    const ownerContext = context.current;
                    void api.mcpPreviewBackup({ target: draft.saved.target, backupId }).then(
                      (value) => {
                        if (
                          awake.current &&
                          token === sequence.current &&
                          ownerContext === context.current &&
                          sameMcpOwner(current.current?.saved.target, captured.target)
                        )
                          setBackup({
                            ...value,
                            target: captured.target,
                            expectedRevision: captured.revision,
                          });
                      },
                      (cause) => setError(failure(cause)),
                    );
                  }
                }}
              >
                <option value="" disabled>
                  Choose backup
                </option>
                {backups.map((b) => (
                  <option key={b.backupId} value={b.backupId} disabled={!b.valid || b.pinned}>
                    {new Date(b.createdAt).toLocaleString()} —{" "}
                    {b.pinned
                      ? "Pending recovery"
                      : b.valid
                        ? "Valid configuration"
                        : "Malformed recovery evidence"}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p>No backups available.</p>
          )}
          {backup && (
            <>
              <p>
                {backup.missing
                  ? "The configuration file was absent. Restore removes this dedicated file and may reveal inherited user definitions."
                  : "Preview of the configuration that will be restored."}{" "}
                {state?.dirty ? "Your unsaved draft will be discarded only after success." : ""}
              </p>
              <pre className="mcp-backup-preview">
                {backup.contentBase64 === null
                  ? MCP_EMPTY_TEXT
                  : decodeMcpText(backup.contentBase64)}
              </pre>
            </>
          )}
          {error && <p role="alert">{error}</p>}
          <div className="dialog-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBackups(undefined);
                setBackup(undefined);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={
                busy ||
                !backup ||
                !draft ||
                draft.ownerLost ||
                Boolean(draft.latest.pendingRecovery.length)
              }
              onClick={() => {
                if (!draft || !backup) return;
                const value = {
                  target: backup.target,
                  expectedRevision: backup.expectedRevision,
                  backupId: backup.backupId,
                  expectedBackupRevision: backup.backupRevision,
                };
                void mutate(value, (requestId) => api.mcpRestore({ ...value, requestId })).then(
                  (saved) => {
                    if (saved) {
                      setBackups(undefined);
                      setBackup(undefined);
                    }
                  },
                );
              }}
            >
              Confirm restore
            </button>
          </div>
        </Modal>
      )}
      {active && visible && reset && (
        <Modal title="Reset MCP configuration?" busy={busy} onClose={() => setReset(undefined)}>
          <p>Configurations: {reset.configurationLabels.join(", ")}.</p>
          <p>
            {reset.request.includeUser
              ? "Clear User and this project. Clearing User also affects other projects using User definitions."
              : "Clear definitions in the selected configuration."}
          </p>
          <p>
            Definitions removed:{" "}
            {reset.removedLabels.join(", ") ||
              (reset.malformed ? "Unknown — malformed configuration" : "None")}
            .
          </p>
          <p>
            Inherited definitions after reset: {reset.inheritedLabels.join(", ") || "None known"}.
            Enabled: {reset.remainingEnabled ?? "Unknown — invalid user configuration"}.
          </p>
          <p>
            Open projects potentially affected: {reset.affectedProjects.join(", ") || "None"}.
            Closed projects are not inspected.
          </p>
          {reset.malformed && (
            <p>Malformed originals will be preserved as private recovery evidence.</p>
          )}
          {state?.dirty && (
            <p>Your unsaved JSON draft will be discarded only after reset succeeds.</p>
          )}
          <p>
            Credentials, unrelated settings, built-in capabilities and running agents/connections
            are unchanged.
          </p>
          {reset.blocked && <p role="alert">Pending recovery blocks reset.</p>}
          {error && <p role="alert">{error}</p>}
          <div className="dialog-actions">
            <button type="button" disabled={busy} onClick={() => setReset(undefined)}>
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || reset.blocked}
              onClick={() => {
                const value = reset.request;
                void mutate(value, (requestId) => api.mcpReset({ ...value, requestId })).then(
                  (saved) => {
                    if (saved) setReset(undefined);
                  },
                );
              }}
            >
              Confirm reset
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
