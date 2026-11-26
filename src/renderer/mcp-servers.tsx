import { Accordion, AccordionItem, InlineNotification, Tag } from "@carbon/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ApplicationClient,
  McpConnectorDefinition,
  McpManagementRead,
  McpManagementTarget,
  McpManagementTargets,
  McpMovePreview,
  McpMovePreviewRequest,
  McpTargetAddress,
} from "../bridge/index.js";
import { AnchoredMenu } from "./anchored-menu.js";
import { randomId } from "./browser-platform.js";
import { Button } from "./carbon/button.js";
import { Select } from "./carbon/fields.js";
import { DataTable, type TableOptions } from "./data-table.js";
import { hasMcpAuthentication, McpAuthenticationPanel } from "./mcp-authentication.js";
import { McpForm, type McpFormDraft, mcpFormFields } from "./mcp-form.js";
import { type McpRuntimeActions, McpRuntimePanel } from "./mcp-runtime.js";
import { Modal } from "./modal.js";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const message = (cause: unknown) => {
  const explain = (code: string, detail: string) =>
    `MCP_CONFIG_${code}: ${detail} Other application features and available tools remain usable.`;
  const text = cause instanceof Error ? cause.message : "";
  if (text.includes("conflict"))
    return explain(
      "CONFLICT",
      "Configuration or project changed. Reload before saving. Your draft is retained.",
    );
  if (text.includes("recovery-required"))
    return explain(
      "RECOVERY_REQUIRED",
      "Configuration recovery is required. Your draft is retained.",
    );
  if (text.includes("storage-limit"))
    return explain(
      "STORAGE_LIMIT",
      "Configuration storage limit reached. Inspect retained recovery evidence.",
    );
  if (text.includes("invalid"))
    return explain(
      "INVALID",
      "Configuration is invalid or exceeds its limits. Review the fields and reload if the saved file changed.",
    );
  if (text.includes("unsafe"))
    return explain(
      "UNSAFE",
      "Configuration storage identity or permissions are unsafe. Review the recovery guidance.",
    );
  return explain(
    "UNAVAILABLE",
    "MCP configuration is unavailable. Inspect storage, then reload or retry the same action.",
  );
};
const columns = [
  { key: "label", title: "Label", width: 180, filter: "text" },
  { key: "enabled", title: "Enabled", width: 90, filter: "category" },
  { key: "source", title: "Source", width: 160, filter: "category" },
] as const;
interface Editor {
  base: McpManagementRead;
  target: McpManagementTarget;
  originalId?: string;
  initial?: McpConnectorDefinition | undefined;
  key: string;
  draft?: McpFormDraft | undefined;
}
interface Move {
  source: McpManagementRead;
  target: McpManagementTarget;
  serverId: string;
  request?: McpMovePreviewRequest | undefined;
  preview?: McpMovePreview | undefined;
}
export function McpServersPage({
  api,
  active,
  contextKey,
  configuration,
  onFormDirty,
  readOnly = false,
  ...table
}: Pick<TableOptions, "lines" | "density" | "fit" | "textStyles"> & {
  api: ApplicationClient;
  active: boolean;
  contextKey: string;
  configuration: { scope: string; select(scope: string): void; reload(): void };
  onFormDirty?(dirty: boolean): void;
  readOnly?: boolean | undefined;
}) {
  const [visible, setVisible] = useState(
    typeof document === "undefined" || document.visibilityState !== "hidden",
  );
  const [targets, setTargets] = useState<McpManagementTargets>();
  const { scope, select: setScope } = configuration;
  const [read, setRead] = useState<McpManagementRead>();
  const [selected, setSelected] = useState<string>();
  const [editor, setEditor] = useState<Editor>();
  const [remove, setRemove] = useState<Editor>();
  const [move, setMove] = useState<Move>();
  const [busy, setBusy] = useState(false);
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const [authOpenKey, setAuthOpenKey] = useState(0);
  const [error, setError] = useState("");
  const [menu, setMenu] = useState<{ id: string; x: number; y: number }>();
  const runtimeRef = useRef<McpRuntimeActions>(null);
  const dirtyNotice = useRef(onFormDirty);
  dirtyNotice.current = onFormDirty;
  const formKey = editor?.key;
  useEffect(() => {
    dirtyNotice.current?.(Boolean(formKey));
    return () => dirtyNotice.current?.(false);
  }, [formKey]);
  const editing = useRef(editor?.key);
  editing.current = editor?.key;
  const ownerContext = useRef(contextKey);
  ownerContext.current = contextKey;
  const generation = useRef(0);
  const previewGeneration = useRef(0);
  const pending = useRef(false);
  const request = useRef<{ key: string; id: string } | undefined>(undefined);
  const awake = useRef(active && visible);
  awake.current = active && visible;
  const requestId = (value: unknown) => {
    const key = JSON.stringify(value);
    if (request.current?.key !== key) request.current = { key, id: randomId() };
    return request.current.id;
  };
  const refresh = useCallback(async () => {
    if (!awake.current) return;
    const version = ++generation.current;
    const context = contextKey;
    try {
      const list = await api.mcpTargets();
      if (!awake.current || version !== generation.current || context !== ownerContext.current)
        return;
      setTargets(list);
      const target = list.targets.find((t) =>
        scope === "user" ? t.address.scope === "user" : t.address.targetId === scope,
      );
      if (!target) {
        setRead(undefined);
        setError("This project is no longer open. Select an available configuration.");
        return;
      }
      const value = await api.mcpRead(target.address);
      if (awake.current && version === generation.current && context === ownerContext.current)
        setRead(value);
    } catch (cause) {
      if (awake.current && version === generation.current && context === ownerContext.current) {
        setRead(undefined);
        setError(message(cause));
      }
    }
  }, [api, scope, contextKey]);
  useEffect(() => {
    const listener = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  }, []);
  useEffect(() => {
    if (active && visible) void refresh();
    else setMenu(undefined);
    return () => {
      generation.current++;
      previewGeneration.current++;
    };
  }, [refresh, active, visible]);
  useEffect(
    () =>
      api.onMcpChanged(() => {
        if (awake.current) void refresh();
      }),
    [api, refresh],
  );
  const target = targets?.targets.find((t) => read && same(t.address, read.target));
  const rows = (read?.rows ?? []).map((row) => ({
    id: row.id,
    label: row.label,
    enabled: row.enabled ? "Yes" : "No",
    source: `${row.source.scope === "user" ? "User" : (target?.label ?? "Project")}${row.shadowedSources.length ? " (overrides User)" : ""}`,
  }));
  const selectedId = rows.some((r) => r.id === selected) ? selected : rows[0]?.id;
  const blocked = readOnly || !read?.document || Boolean(read.pendingRecovery.length) || busy;
  const menuDefinition = menu ? read?.document?.servers[menu.id] : undefined;
  const menuLocal = Boolean(menuDefinition);
  const captured = (id?: string): Editor | undefined =>
    read?.document && target
      ? {
          base: structuredClone(read),
          target: structuredClone(target),
          ...(id ? { originalId: id, initial: structuredClone(read.document.servers[id]) } : {}),
          key: randomId(),
        }
      : undefined;
  const stale = (value: Editor) =>
    readOnly ||
    !read ||
    read.revision !== value.base.revision ||
    !same(value.target.address, read.target) ||
    !targets?.targets.some((t) => same(t.address, value.target.address)) ||
    Boolean(read.pendingRecovery.length);
  async function save(value: Editor, document: NonNullable<McpManagementRead["document"]>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    const payload = {
      target: value.target.address,
      expectedRevision: value.base.revision,
      document,
    };
    try {
      const result = await api.mcpSave({ ...payload, requestId: requestId(payload) });
      if (result.status === "recovery-required") {
        setError("Configuration recovery is required. Your draft is retained.");
      } else {
        setSelected(
          value.originalId ??
            Object.keys(document.servers).find(
              (id) => !Object.hasOwn(value.base.document?.servers ?? {}, id),
            ),
        );
        setEditor(undefined);
        setRemove(undefined);
      }
      await refresh();
    } catch (cause) {
      if (cause instanceof Error && cause.message.includes("conflict")) setRead(undefined);
      setError(message(cause));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const openEdit = (id: string) => {
    setSelected(id);
    if (read?.document && Object.hasOwn(read.document.servers, id)) setEditor(captured(id));
  };
  const openMove = (id: string) => {
    if (read && target) {
      setSelected(id);
      setMove({ source: structuredClone(read), target: structuredClone(target), serverId: id });
    }
  };
  const chooseDestination = async (address: McpTargetAddress) => {
    if (!move) return;
    const version = ++previewGeneration.current;
    setMove({ ...move, request: undefined, preview: undefined });
    try {
      const destination = await api.mcpRead(address);
      const payload = {
        source: move.source.target,
        destination: address,
        serverId: move.serverId,
        expectedSourceRevision: move.source.revision,
        expectedDestinationRevision: destination.revision,
      };
      const preview = await api.mcpPreviewMove(payload);
      if (awake.current && version === previewGeneration.current)
        setMove({ ...move, request: payload, preview });
    } catch (cause) {
      if (version === previewGeneration.current) setError(message(cause));
    }
  };
  return (
    <section className="mcp-servers-page">
      {error && !editor && !remove && !move && (
        <InlineNotification
          role="alert"
          kind="error"
          title="Server configuration unavailable"
          subtitle={error}
          hideCloseButton
        />
      )}
      {targets?.unavailableProjects ? (
        <p role="status">
          Some project configurations are unavailable because their storage identity or permissions
          could not be verified.
        </p>
      ) : null}
      {read && (!read.document || read.pendingRecovery.length > 0) && (
        <div>
          <InlineNotification
            role="alert"
            kind="warning"
            hideCloseButton
            title={read.document ? "Recovery required" : "Invalid configuration"}
            subtitle={
              read.document
                ? "Pending configuration recovery blocks writes to this configuration."
                : "Guided changes and new connections are blocked. Repair the file in the JSON view."
            }
          />
          {read.issues.map((issue) => (
            <p key={`${issue.code}:${issue.line}:${issue.column}:${issue.path.join(".")}`}>
              {issue.message} Line {issue.line}, column {issue.column}.
            </p>
          ))}
          <Accordion>
            <AccordionItem title="Recovery guidance">
              <p>
                Preserve configuration files, private backups and transaction evidence. Do not
                delete writer locks or replay uncertain actions. Follow the MCP configuration
                recovery runbook or review the affected transaction under Configuration maintenance.
              </p>
            </AccordionItem>
          </Accordion>
        </div>
      )}
      {read && !read.inheritanceComplete && (
        <p role="status">
          User configuration is invalid. Inherited definitions cannot be shown completely.
        </p>
      )}
      <DataTable
        {...table}
        tableId="mcp-servers"
        emptyMessage={
          read?.document && !blocked
            ? "No servers configured. Choose Add server to create the first one."
            : read
              ? "No server definitions to display."
              : error
                ? "Server list unavailable."
                : "Loading servers…"
        }
        renderCell={(row, key) =>
          key === "enabled" ? (
            <Tag size="sm" type={row.enabled === "Yes" ? "green" : "gray"}>
              {row.enabled}
            </Tag>
          ) : undefined
        }
        workspace={read?.target.targetId ?? "user"}
        rows={rows}
        columns={[...columns]}
        initialSort="label"
        selected={selectedId}
        onSelect={setSelected}
        display={(row, key) => row[key]}
        onAdd={() => {
          setError("");
          setEditor(captured());
        }}
        addLabel="Add server"
        addDisabled={blocked}
        pageActions={[
          {
            id: "mcp-refresh",
            label: "Reload configurations",
            run: () => {
              setError("");
              configuration.reload();
              void refresh();
            },
            disabled: busy,
          },
        ]}
        onActions={(id, bounds) => setMenu({ id, x: bounds.x, y: bounds.y + bounds.height })}
      />
      {read && selectedId && !editor && !remove && !move && (
        <McpAuthenticationPanel
          api={api}
          read={read}
          serverId={selectedId}
          blocked={blocked}
          active={active}
          hideTrigger
          openKey={authOpenKey}
        />
      )}
      {read && !editor && !remove && !move && (
        <McpRuntimePanel
          active={active && visible}
          api={api}
          read={read}
          serverId={selectedId}
          blocked={blocked}
          actionsRef={runtimeRef}
          onBusyChange={setRuntimeBusy}
        />
      )}
      {active && visible && menu && (
        <AnchoredMenu
          x={menu.x}
          y={menu.y}
          label="Server actions"
          onClose={() => setMenu(undefined)}
          items={[
            {
              label: "Edit",
              disabled: blocked || !menuLocal,
              run: () => openEdit(menu.id),
            },
            {
              label: "Move",
              disabled: blocked || !menuLocal || (targets?.targets.length ?? 0) < 2,
              run: () => openMove(menu.id),
            },
            ...(!menuLocal
              ? [
                  {
                    label: "Open user configuration",
                    disabled: false,
                    run: () => {
                      setScope("user");
                      setRead(undefined);
                    },
                  },
                ]
              : []),
            ...(menuLocal && hasMcpAuthentication(menuDefinition)
              ? [
                  {
                    label: "Manage authentication",
                    disabled: blocked,
                    run: () => {
                      setSelected(menu.id);
                      setAuthOpenKey((value) => value + 1);
                    },
                  },
                ]
              : []),
            ...(menuDefinition
              ? [
                  {
                    label: menuDefinition.enabled ? "Disable server" : "Enable server",
                    disabled: blocked || runtimeBusy,
                    run: () => runtimeRef.current?.toggleEnabled(menu.id, !menuDefinition.enabled),
                  },
                  {
                    label: "Test connection",
                    disabled: blocked || runtimeBusy,
                    run: () => runtimeRef.current?.testConnection(menu.id),
                  },
                ]
              : []),
            {
              label: "Remove server",
              danger: true,
              disabled: blocked || !menuLocal,
              run: () => setRemove(captured(menu.id)),
            },
          ]}
        />
      )}
      {active && visible && editor?.base.document && (
        <Modal
          editorFooter
          title={`${editor.originalId ? "Edit" : "Add"} MCP server — ${editor.target.label}`}
          wide
          busy={busy}
          onClose={() => setEditor(undefined)}
        >
          {error && <p role="alert">{error}</p>}
          <McpForm
            key={editor.key}
            initial={mcpFormFields(editor.originalId ?? "", editor.initial)}
            draft={editor.draft}
            onDraft={(draft) =>
              setEditor((value) => (value?.key === editor.key ? { ...value, draft } : value))
            }
            base={editor.base.document}
            originalId={editor.originalId}
            templates={targets?.templates ?? []}
            busy={busy}
            stale={stale(editor)}
            onSave={(document) => void save(editor, document)}
            onCancel={() => setEditor(undefined)}
            onReload={() => {
              const version = ++generation.current;
              void api.mcpRead(editor.target.address).then(
                (value) => {
                  if (
                    !awake.current ||
                    version !== generation.current ||
                    editing.current !== editor.key
                  )
                    return;
                  setRead(value);
                  if (
                    !value.document ||
                    (editor.originalId && !Object.hasOwn(value.document.servers, editor.originalId))
                  ) {
                    setEditor(undefined);
                    setError(
                      value.document
                        ? "The server no longer exists. Use Add server to create a new definition."
                        : "",
                    );
                    return;
                  }
                  setError("");
                  setEditor((current) =>
                    current?.key !== editor.key
                      ? current
                      : {
                          ...editor,
                          base: value,
                          initial: editor.originalId
                            ? value.document?.servers[editor.originalId]
                            : undefined,
                          key: randomId(),
                        },
                  );
                },
                (cause) => setError(message(cause)),
              );
            }}
          />
        </Modal>
      )}
      {active && visible && remove?.base.document && (
        <Modal
          footer={
            <>
              <Button
                variant="secondary"
                type="button"
                disabled={busy}
                onClick={() => setRemove(undefined)}
              >
                Cancel
              </Button>
              <Button
                className="destructive"
                type="button"
                disabled={busy || stale(remove)}
                onClick={() => {
                  const document = structuredClone(remove.base.document);
                  if (document && remove.originalId) {
                    delete document.servers[remove.originalId];
                    void save(remove, document);
                  }
                }}
              >
                Confirm removal
              </Button>
            </>
          }
          title="Remove MCP server?"
          busy={busy}
          onClose={() => setRemove(undefined)}
        >
          <p>
            Remove {remove.initial?.label} from {remove.target.label}?
          </p>
          {remove.base.rows.find((r) => r.id === remove.originalId)?.shadowedSources.length ? (
            <p>The user definition will become effective.</p>
          ) : null}
          {error && <p role="alert">{error}</p>}
        </Modal>
      )}
      {active && visible && move && (
        <Modal
          footer={
            <>
              <Button
                variant="secondary"
                type="button"
                disabled={busy}
                onClick={() => {
                  previewGeneration.current++;
                  setMove(undefined);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                type="button"
                disabled={
                  busy ||
                  !move.preview?.allowed ||
                  !move.request ||
                  !same(read?.target, move.source.target) ||
                  read?.revision !== move.source.revision
                }
                onClick={() => {
                  if (!move.request || pending.current) return;
                  pending.current = true;
                  setBusy(true);
                  setError("");
                  const payload = move.request;
                  void api
                    .mcpMove({ ...payload, requestId: requestId(payload) })
                    .then(
                      async (result) => {
                        if (result.status === "recovery-required")
                          setError("Configuration recovery is required. Your draft is retained.");
                        else setMove(undefined);
                        await refresh();
                      },
                      (cause) => setError(message(cause)),
                    )
                    .finally(() => {
                      pending.current = false;
                      setBusy(false);
                    });
                }}
              >
                Confirm move
              </Button>
            </>
          }
          title="Move MCP server"
          busy={busy}
          onClose={() => {
            previewGeneration.current++;
            setMove(undefined);
          }}
        >
          <p>
            Move {move.source.document?.servers[move.serverId]?.label} from {move.target.label}. The
            server ID is preserved.
          </p>
          <Select
            labelText="Destination"
            aria-label="Destination"
            disabled={busy}
            defaultValue=""
            onChange={(e) => {
              const t = targets?.targets.find((t) => t.address.targetId === e.target.value);
              if (t) void chooseDestination(t.address);
            }}
          >
            <option value="" disabled>
              Choose configuration
            </option>
            {targets?.targets
              .filter((t) => t.address.targetId !== move.target.address.targetId)
              .map((t) => (
                <option key={t.address.targetId} value={t.address.targetId}>
                  {t.label}
                </option>
              ))}
          </Select>
          {move.preview && (
            <div role="status">
              <p>
                {move.preview.label}: {move.preview.sourceLabel} → {move.preview.destinationLabel}
              </p>
              {move.preview.reason && <p>{move.preview.reason}</p>}
              <p>
                Potentially affected open projects:{" "}
                {move.preview.affectedProjects.join(", ") || "None"}.
              </p>
              {move.preview.userScopeAffected && (
                <p>
                  User definitions affect projects without matching overrides. Closed project
                  configurations are not inspected.
                </p>
              )}
              <p>
                {move.preview.credentialReferences} credential references remain unverified. No
                credentials or approvals are moved.
              </p>
            </div>
          )}
          {error && <p role="alert">{error}</p>}
        </Modal>
      )}
    </section>
  );
}
