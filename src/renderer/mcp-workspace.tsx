import { InlineNotification, Tab, TabList, TabPanel, TabPanels, Tabs } from "@carbon/react";
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
  type McpTextRead,
  validateMcpConnectorText,
} from "../bridge/index.js";
import { randomId } from "./browser-platform.js";
import { Button } from "./carbon/button.js";
import { Select } from "./carbon/fields.js";
import type { TableOptions } from "./data-table.js";
import type { McpEditorView } from "./mcp-json-editor.js";
import { McpRecoveryPanel } from "./mcp-recovery.js";
import { McpServersPage } from "./mcp-servers.js";
import { McpTroubleshooting } from "./mcp-troubleshooting.js";
import { Modal } from "./modal.js";
import { PageTitle } from "./page-title.js";

const JsonEditor = lazy(() => import("./mcp-json-editor.js"));
const sameOwner = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const textOf = (value: McpTextRead) =>
  value.contentBase64 === null
    ? value.exists
      ? ""
      : MCP_EMPTY_TEXT
    : decodeMcpText(value.contentBase64);
export const mcpWorkspaceFailure = (cause: unknown) => {
  const explain = (code: string, detail: string) =>
    `MCP_CONFIG_${code}: ${detail} Other application features and available tools remain usable.`;
  const text = cause instanceof Error ? cause.message : "";
  if (text.includes("conflict"))
    return explain(
      "CONFLICT",
      "Configuration, project or backup changed. Reset before trying again.",
    );
  if (text.includes("recovery-required"))
    return explain(
      "RECOVERY_REQUIRED",
      "Configuration recovery is required; preserve the transaction evidence.",
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
  if (text.includes("unsafe"))
    return explain(
      "UNSAFE",
      "MCP configuration storage identity or permissions are unsafe. Review storage ownership and permissions, then explicitly reload before saving.",
    );
  return explain(
    "UNAVAILABLE",
    "MCP configuration storage is unavailable. Review storage availability, locks and free space, then explicitly reload before saving.",
  );
};
const failure = mcpWorkspaceFailure;
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
  const [scope, setScope] = useState("user");
  const [targets, setTargets] = useState<McpManagementTargets>();
  const [saved, setSaved] = useState<McpTextRead>();
  const [ownerLost, setOwnerLost] = useState(false);
  const [visible, setVisible] = useState(
    typeof document === "undefined" || document.visibilityState !== "hidden",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [jsonBase, setJsonBase] = useState<McpTextRead>();
  const [jsonText, setJsonText] = useState("");
  const [issueLocation, setIssueLocation] = useState<{ issue: McpTextIssue; key: string }>();
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
  const currentSaved = useRef(saved);
  currentSaved.current = saved;
  const view = useRef<McpEditorView["current"]>(null);
  const context = useRef(contextKey);
  context.current = contextKey;
  const projectTargets = targets?.targets.filter((t) => t.address.scope === "project") ?? [];
  const activeScope =
    scope === "project" ? (projectTargets[0]?.address.targetId ?? "project") : scope;
  const target = targets?.targets.find((t) =>
    activeScope === "user" ? t.address.scope === "user" : t.address.targetId === activeScope,
  );
  const noProjectOpen = scope === "project" && projectTargets.length === 0;
  const load = useCallback(
    async (clearError = false) => {
      if (!awake.current) return;
      const token = ++sequence.current;
      try {
        const list = await api.mcpTargets();
        if (!awake.current || token !== sequence.current || contextKey !== context.current) return;
        setTargets(list);
        const projects = list.targets.filter((t) => t.address.scope === "project");
        const resolvedScope =
          scope === "project" ? (projects[0]?.address.targetId ?? "project") : scope;
        if (resolvedScope === "project") {
          setSaved(undefined);
          setOwnerLost(false);
          if (clearError) setError("");
          return;
        }
        if (scope === "project" && resolvedScope !== "project") setScope(resolvedScope);
        const selected = list.targets.find((t) =>
          resolvedScope === "user"
            ? t.address.scope === "user"
            : t.address.targetId === resolvedScope,
        );
        if (!selected) {
          setOwnerLost(true);
          setError(
            "This configuration owner is unavailable. Reopen the project and explicitly reload or select its new configuration.",
          );
          return;
        }
        const value = await api.mcpReadText(selected.address);
        if (!awake.current || token !== sequence.current || contextKey !== context.current) return;
        setSaved(value);
        setOwnerLost(false);
        if (clearError) setError("");
      } catch (cause) {
        if (awake.current && token === sequence.current) {
          setOwnerLost(Boolean(currentSaved.current));
          setError(failure(cause));
        }
      }
    },
    [api, scope, contextKey],
  );
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
  const requestId = (value: unknown) => {
    const key = JSON.stringify(value);
    if (requests.current?.key !== key) requests.current = { key, id: randomId() };
    return requests.current.id;
  };
  async function openJson() {
    if (!target) return;
    setError("");
    const token = ++sequence.current;
    const ownerContext = context.current;
    try {
      const value = await api.mcpReadText(target.address);
      if (!awake.current || token !== sequence.current || ownerContext !== context.current) return;
      setSaved(value);
      setOwnerLost(false);
      setJsonBase(value);
      setJsonText(textOf(value));
      setIssueLocation(undefined);
      view.current = null;
      setJsonOpen(true);
    } catch (cause) {
      if (awake.current && token === sequence.current) setError(failure(cause));
    }
  }
  async function resetJson() {
    if (!target) return;
    setError("");
    const token = ++sequence.current;
    const ownerContext = context.current;
    try {
      const value = await api.mcpReadText(target.address);
      if (!awake.current || token !== sequence.current || ownerContext !== context.current) return;
      setSaved(value);
      setOwnerLost(false);
      setJsonBase(value);
      setJsonText(textOf(value));
      setIssueLocation(undefined);
    } catch (cause) {
      if (awake.current && token === sequence.current) setError(failure(cause));
    }
  }
  async function mutate(
    value: unknown,
    action: (requestId: string) => Promise<McpManagementResult>,
  ) {
    if (pending.current || !saved) return false;
    pending.current = true;
    setBusy(true);
    setError("");
    const owner = saved.target;
    const ownerContext = context.current;
    try {
      const result = await action(requestId(value));
      if (result.status === "recovery-required") {
        setError("Configuration recovery is required; preserve the transaction evidence.");
        await load();
        return false;
      }
      const latest = await api.mcpReadText(owner);
      if (!sameOwner(currentSaved.current?.target, owner) || ownerContext !== context.current)
        throw new Error("MCP configuration conflict");
      setSaved(latest);
      setOwnerLost(false);
      setError("");
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
  const jsonValidation = jsonOpen ? validateMcpConnectorText(jsonText) : undefined;
  const jsonEditable = jsonBase ? !jsonBase.exists || jsonBase.contentBase64 !== null : false;
  const jsonBlocked = Boolean(saved?.pendingRecovery.length || jsonBase?.pendingRecovery.length);
  const jsonStale = Boolean(
    jsonBase && (ownerLost || (saved && saved.revision !== jsonBase.revision)),
  );
  const jsonDirty = jsonBase ? jsonText !== textOf(jsonBase) : false;
  const jsonCanSave = Boolean(
    jsonBase && jsonDirty && jsonEditable && jsonValidation?.valid && !jsonStale && !jsonBlocked,
  );
  async function saveJson() {
    if (!jsonBase || !jsonCanSave) return false;
    const value = {
      target: jsonBase.target,
      expectedRevision: jsonBase.revision,
      contentBase64: encodeMcpText(jsonText),
    };
    const ok = await mutate(value, (requestId) => api.mcpSaveText({ ...value, requestId }));
    if (ok) {
      setJsonOpen(false);
      setJsonBase(undefined);
    }
    return ok;
  }
  function select(next: string) {
    if (next === scope) return;
    sequence.current++;
    setSaved(undefined);
    currentSaved.current = undefined;
    setOwnerLost(false);
    setScope(next);
    setError("");
    setJsonOpen(false);
    setJsonBase(undefined);
    setBackup(undefined);
    setBackups(undefined);
    setReset(undefined);
    view.current = null;
  }
  async function openBackups() {
    if (!saved) return;
    setError("");
    setBackup(undefined);
    const owner = saved.target;
    const ownerContext = context.current;
    try {
      const list = await api.mcpBackups(owner);
      if (
        awake.current &&
        ownerContext === context.current &&
        sameOwner(currentSaved.current?.target, owner)
      )
        setBackups(list);
    } catch (cause) {
      setError(failure(cause));
    }
  }
  async function openReset(includeUser: boolean) {
    if (!saved) return;
    setError("");
    const owner = saved.target;
    const ownerContext = context.current;
    try {
      const preview = await api.mcpPreviewReset({ target: owner, includeUser });
      if (
        awake.current &&
        ownerContext === context.current &&
        sameOwner(currentSaved.current?.target, owner)
      )
        setReset(preview);
    } catch (cause) {
      setError(failure(cause));
    }
  }
  const serversView = noProjectOpen ? (
    <section className="mcp-servers-page">
      <PageTitle page="mcp-servers" />
      <p role="status">Open a project to configure project MCP servers.</p>
    </section>
  ) : (
    <>
      {scope !== "user" && projectTargets.length > 1 && (
        <div className="mcp-scope">
          <Select
            labelText="Project"
            aria-label="Project"
            value={activeScope}
            disabled={busy}
            onChange={(e) => select(e.target.value)}
          >
            {projectTargets.map((t) => (
              <option key={t.address.targetId} value={t.address.targetId}>
                {t.label}
              </option>
            ))}
          </Select>
        </div>
      )}
      <McpServersPage
        key={`${activeScope}:${retryKey}`}
        api={api}
        active={active && visible}
        contextKey={contextKey}
        configuration={{ scope: activeScope, select, reload: () => void load(true) }}
        onEditJson={() => void openJson()}
        readOnly={ownerLost}
        {...table}
      />
    </>
  );
  return (
    <section className="mcp-workspace">
      <Tabs
        selectedIndex={scope === "user" ? 0 : 1}
        onChange={({ selectedIndex }) =>
          select(selectedIndex === 0 ? "user" : (projectTargets[0]?.address.targetId ?? "project"))
        }
      >
        <TabList aria-label="MCP configuration scope" activation="manual">
          <Tab disabled={busy}>User</Tab>
          <Tab disabled={busy}>Project</Tab>
        </TabList>
        {error && !jsonOpen && (
          <InlineNotification
            role="alert"
            kind="error"
            title="Configuration error"
            subtitle={error}
            hideCloseButton
          />
        )}
        {(ownerLost || (!saved && error)) && !jsonOpen && (
          <Button
            variant="quiet"
            type="button"
            disabled={busy}
            onClick={() => {
              setRetryKey((n) => n + 1);
              void load(true);
            }}
          >
            Reload configuration
          </Button>
        )}
        <TabPanels>
          <TabPanel>{scope === "user" && serversView}</TabPanel>
          <TabPanel>{scope !== "user" && serversView}</TabPanel>
        </TabPanels>
      </Tabs>
      {!noProjectOpen && (
        <section className="mcp-maintenance" aria-label="Configuration maintenance">
          <h2>Configuration maintenance</h2>
          <div className="mcp-maintenance-row">
            <h3>Backup and recovery</h3>
            <div className="mcp-actions">
              <Button
                variant="quiet"
                type="button"
                disabled={busy || !saved}
                onClick={() => void openBackups()}
              >
                Restore backup
              </Button>
              <Button
                variant="quiet"
                className="destructive"
                type="button"
                disabled={busy || !saved || Boolean(saved.pendingRecovery.length) || ownerLost}
                onClick={() => void openReset(false)}
              >
                Reset this configuration
              </Button>
              {target?.address.scope === "project" && (
                <Button
                  variant="quiet"
                  className="destructive"
                  type="button"
                  disabled={busy || !saved || Boolean(saved.pendingRecovery.length) || ownerLost}
                  onClick={() => void openReset(true)}
                >
                  Reset User and this project
                </Button>
              )}
              {target && (
                <McpRecoveryPanel
                  api={api}
                  target={target.address}
                  active={active && visible}
                  onChanged={() => {
                    void load();
                  }}
                />
              )}
            </div>
          </div>
          {target && (
            <McpTroubleshooting api={api} target={target.address} active={active && visible} />
          )}
        </section>
      )}
      {active && visible && jsonOpen && jsonBase && (
        <Modal
          footer={
            <>
              <Button
                variant="secondary"
                type="button"
                disabled={busy}
                onClick={() => void resetJson()}
              >
                Reset
              </Button>
              <Button
                variant="secondary"
                type="button"
                disabled={busy}
                onClick={() => {
                  setJsonOpen(false);
                  setJsonBase(undefined);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                type="button"
                disabled={busy || !jsonCanSave}
                onClick={() => void saveJson()}
              >
                Save
              </Button>
            </>
          }
          title={`Edit JSON — ${target?.label ?? "User"}`}
          wide
          busy={busy}
          onClose={() => {
            setJsonOpen(false);
            setJsonBase(undefined);
          }}
        >
          <div className="mcp-json-modal">
            <div className="mcp-json-actions">
              <Button
                variant="quiet"
                type="button"
                disabled={busy || !jsonEditable || !jsonValidation?.valid}
                onClick={() => setJsonText(`${JSON.stringify(JSON.parse(jsonText), null, 2)}\n`)}
              >
                Format JSON
              </Button>
              <span role="status">{jsonDirty ? "Unsaved changes" : "Saved"}</span>
            </div>
            {error && (
              <InlineNotification
                role="alert"
                kind="error"
                title="Configuration error"
                subtitle={error}
                hideCloseButton
              />
            )}
            {jsonStale && (
              <InlineNotification
                role="alert"
                kind="warning"
                hideCloseButton
                title="Configuration or owner changed."
                subtitle="Reset to load the latest saved configuration before saving."
              />
            )}
            {jsonBlocked && (
              <InlineNotification
                role="alert"
                kind="warning"
                hideCloseButton
                title="Pending recovery blocks writes."
                subtitle="Preserve private evidence and follow the MCP configuration recovery runbook."
              />
            )}
            {!jsonEditable && (
              <InlineNotification
                role="alert"
                kind="error"
                hideCloseButton
                title="The original file is not valid UTF-8."
                subtitle="Use a valid backup or a confirmed reset. The original bytes remain protected."
              />
            )}
            {jsonValidation && !jsonValidation.valid && (
              <ul className="mcp-issues" aria-label="Configuration issues">
                {jsonValidation.issues.map((issue) => (
                  <li key={`${issue.code}:${issue.line}:${issue.column}:${issue.path.join(".")}`}>
                    <Button
                      variant="quiet"
                      type="button"
                      onClick={() => setIssueLocation({ issue, key: randomId() })}
                    >
                      {issue.message} Line {issue.line}, column {issue.column}.
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <Suspense fallback={<p role="status">Loading JSON editor…</p>}>
              <JsonEditor
                text={jsonText}
                issues={jsonValidation?.issues ?? []}
                reveal={issueLocation}
                active={active && visible && jsonOpen}
                key={`${JSON.stringify(jsonBase.target)}:${jsonBase.revision}`}
                editable={jsonEditable && !busy}
                canSave={jsonCanSave && !busy}
                view={view}
                onChange={setJsonText}
                onSave={() => void saveJson()}
              />
            </Suspense>
          </div>
        </Modal>
      )}
      {active && visible && backups && (
        <Modal
          footer={
            <>
              <Button
                variant="secondary"
                type="button"
                disabled={busy}
                onClick={() => {
                  setBackups(undefined);
                  setBackup(undefined);
                }}
              >
                Cancel
              </Button>
              <Button
                className="destructive"
                type="button"
                disabled={
                  busy || !backup || !saved || ownerLost || Boolean(saved.pendingRecovery.length)
                }
                onClick={() => {
                  if (!saved || !backup) return;
                  const value = {
                    target: backup.target,
                    expectedRevision: backup.expectedRevision,
                    backupId: backup.backupId,
                    expectedBackupRevision: backup.backupRevision,
                  };
                  void mutate(value, (requestId) => api.mcpRestore({ ...value, requestId })).then(
                    (ok) => {
                      if (ok) {
                        setBackups(undefined);
                        setBackup(undefined);
                      }
                    },
                  );
                }}
              >
                Confirm restore
              </Button>
            </>
          }
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
            <Select
              labelText="Backup"
              aria-label="Backup"
              defaultValue=""
              disabled={busy}
              onChange={(e) => {
                const backupId = e.target.value;
                setBackup(undefined);
                if (saved) {
                  const token = ++sequence.current;
                  const captured = saved;
                  const ownerContext = context.current;
                  void api.mcpPreviewBackup({ target: saved.target, backupId }).then(
                    (value) => {
                      if (
                        awake.current &&
                        token === sequence.current &&
                        ownerContext === context.current &&
                        sameOwner(currentSaved.current?.target, captured.target)
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
            </Select>
          ) : (
            <p>No backups available.</p>
          )}
          {backup && (
            <>
              <p>
                {backup.missing
                  ? "The configuration file was absent. Restore removes this dedicated file and may reveal inherited user definitions."
                  : "Preview of the configuration that will be restored."}
              </p>
              <pre className="mcp-backup-preview">
                {backup.contentBase64 === null
                  ? MCP_EMPTY_TEXT
                  : decodeMcpText(backup.contentBase64)}
              </pre>
            </>
          )}
          {error && <p role="alert">{error}</p>}
        </Modal>
      )}
      {active && visible && reset && (
        <Modal
          footer={
            <>
              <Button
                variant="secondary"
                type="button"
                disabled={busy}
                onClick={() => setReset(undefined)}
              >
                Cancel
              </Button>
              <Button
                className="destructive"
                type="button"
                disabled={busy || reset.blocked}
                onClick={() => {
                  const value = reset.request;
                  void mutate(value, (requestId) => api.mcpReset({ ...value, requestId })).then(
                    (ok) => {
                      if (ok) setReset(undefined);
                    },
                  );
                }}
              >
                Confirm reset
              </Button>
            </>
          }
          title="Reset MCP configuration?"
          busy={busy}
          onClose={() => setReset(undefined)}
        >
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
          <p>
            Credentials, unrelated settings, built-in capabilities and running agents/connections
            are unchanged.
          </p>
          {reset.blocked && <p role="alert">Pending recovery blocks reset.</p>}
          {error && <p role="alert">{error}</p>}
        </Modal>
      )}
    </section>
  );
}
