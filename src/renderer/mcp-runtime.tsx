import { type Ref, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type {
  ApplicationClient,
  McpManagementRead,
  McpRuntimeRequest,
  McpRuntimeResponse,
  McpTargetAddress,
} from "../bridge/index.js";
import { mcpFailureGuidance } from "../bridge/index.js";
import { randomId } from "./browser-platform.js";
import { Button } from "./carbon/button.js";
import { Modal } from "./modal.js";

export interface McpRuntimeActions {
  toggleEnabled(serverId: string, enabled: boolean): void;
  testConnection(serverId: string): void;
}

/** Controls capture the displayed configuration; selection never retargets a pending decision. */
export function McpRuntimePanel({
  api,
  active,
  read,
  serverId,
  blocked,
  actionsRef,
  onBusyChange,
}: {
  api: ApplicationClient;
  active: boolean;
  read: McpManagementRead;
  serverId?: string | undefined;
  blocked: boolean;
  actionsRef?: Ref<McpRuntimeActions>;
  onBusyChange?(busy: boolean): void;
}) {
  const [status, setStatus] = useState<McpRuntimeResponse>();
  const [decision, setDecision] = useState<{
    request: McpRuntimeRequest;
    title: string;
    details: string[];
  }>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<string>();
  const [outcome, setOutcome] = useState("");
  const [retry, setRetry] = useState<McpRuntimeRequest>();
  const epoch = useRef(0);
  const addressKey = JSON.stringify(read.target);
  const address = useMemo(() => JSON.parse(addressKey) as McpTargetAddress, [addressKey]);
  const capturedOwner = useRef<McpTargetAddress | undefined>(undefined);
  useEffect(() => {
    capturedOwner.current = address;
    epoch.current++;
    setStatus(undefined);
    setDecision(undefined);
    setRetry(undefined);
    return () => {
      if (capturedOwner.current === address) capturedOwner.current = undefined;
      epoch.current++;
    };
  }, [address]);
  useEffect(() => {
    const current = epoch.current;
    if (!active) return;
    let disposed = false;
    let sequence = 0;
    const refresh = () => {
      const request = ++sequence;
      void api.mcpRuntime({ action: "status", target: address }).then(
        (result) => {
          if (!disposed && current === epoch.current && request === sequence) setStatus(result);
        },
        () => {
          if (!disposed) setError("Runtime status is unavailable. Reload this configuration.");
        },
      );
    };
    refresh();
    const unsubscribe = api.onMcpChanged(refresh);
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [api, address, active]);
  const captured = { target: address, expectedRevision: read.revision };
  const busyNotice = useRef(onBusyChange);
  busyNotice.current = onBusyChange;
  useEffect(() => {
    busyNotice.current?.(busy);
    return () => busyNotice.current?.(false);
  }, [busy]);
  const act = async (request: McpRuntimeRequest) => {
    const current = epoch.current;
    setBusy(true);
    setError("");
    try {
      const result = await api.mcpRuntime(request);
      if (epoch.current !== current) return;
      if (result.failure) setOutcome(mcpFailureGuidance(result.failure));
      else if (result.connection)
        setOutcome(
          `${result.connection === "authentication-required" ? "Authentication required" : result.connection}. ${result.tools ?? 0} tools discovered. No tools were called.`,
        );
      setDecision(undefined);
      setRetry(undefined);
      setStatus(await api.mcpRuntime({ action: "status", target: address }));
    } catch (cause) {
      if (epoch.current === current) setRetry(request);
      if (epoch.current === current)
        setError(
          cause instanceof Error
            ? `MCP_RUNTIME: ${cause.message} Review the captured scope and revision, then reload status. Other tools remain available; uncertain calls must not be replayed.`
            : "MCP_RUNTIME: MCP operation failed. Reload before retrying uncertain work. Other tools remain available.",
        );
    } finally {
      if (epoch.current === current) {
        setBusy(false);
        setTest(undefined);
      }
    }
  };
  const preview = async (
    request: McpRuntimeRequest,
    commit: Omit<Extract<McpRuntimeRequest, { action: "disconnect" | "reconnect" }>, "previewId">,
    title: string,
  ) => {
    try {
      const current = epoch.current;
      const result = await api.mcpRuntime(request);
      if (!result.previewId) throw new Error("MCP decision expired; review again");
      if (current === epoch.current)
        setDecision({
          request: {
            ...commit,
            previewId: result.previewId,
          },
          title,
          details: (result.connectors ?? []).map(
            (connector) => `${connector.id} — captured revision ${connector.revision.slice(0, 12)}`,
          ),
        });
    } catch (cause) {
      setError(
        `MCP_RUNTIME: ${cause instanceof Error ? cause.message : "Connection changed; reload status."} Review the captured session and reload status before another decision. Other tools remain available.`,
      );
    }
  };
  useImperativeHandle(actionsRef, () => ({
    toggleEnabled(targetServerId: string, enabled: boolean) {
      if (blocked || busy) return;
      void act({
        action: "enable",
        ...captured,
        serverId: targetServerId,
        enabled,
        requestId: randomId(),
      });
    },
    testConnection(targetServerId: string) {
      if (blocked || busy) return;
      const requestId = randomId();
      setTest(requestId);
      void act({ action: "test", ...captured, serverId: targetServerId, requestId });
    },
  }));
  const hasContent = Boolean(
    error ||
      retry ||
      outcome ||
      status?.failures?.length ||
      status?.unresolvedCleanup ||
      test ||
      read.target.scope === "project" ||
      status?.sessions?.length ||
      decision,
  );
  if (!hasContent) return null;
  return (
    <section aria-label="MCP connection controls" className="mcp-details mcp-connections">
      <h2>Connections</h2>
      {error && <p role="alert">{error}</p>}
      {retry && (
        <Button type="button" disabled={busy} onClick={() => void act(retry)}>
          Retry same operation
        </Button>
      )}
      {outcome && <p role="status">{outcome}</p>}
      {[...new Set(status?.failures?.map(mcpFailureGuidance))].map((guidance) => (
        <p key={guidance}>{guidance}</p>
      ))}
      {Boolean(status?.unresolvedCleanup) && (
        <p>MCP_CLEANUP: Cleanup is unresolved. Use Verify cleanup without starting new work.</p>
      )}
      <div className="mcp-actions">
        {test && (
          <Button
            variant="quiet"
            type="button"
            onClick={() => void api.mcpRuntime({ action: "cancel-test", requestId: test })}
          >
            Cancel connection test
          </Button>
        )}
        {read.target.scope === "project" && (
          <>
            <span>
              Project approval: {status?.approved ? "Approved for this revision" : "Required"}.
            </span>
            <Button
              type="button"
              disabled={blocked || busy}
              onClick={() =>
                setDecision({
                  request: {
                    action: status?.approved ? "revoke-approval" : "approve",
                    ...captured,
                    requestId: randomId(),
                  },
                  title: status?.approved
                    ? "Revoke project approval"
                    : "Approve project configuration",
                  details: [
                    "Approval trusts this canonical project and this exact saved revision for new connections. Review commands, endpoints and bindings in Servers or JSON first. Existing connections continue until disconnected.",
                    ...Object.entries(read.document?.servers ?? {}).map(
                      ([id, value]) =>
                        `${id}: ${value.type === "stdio" ? value.command : value.url} (${value.enabled ? "enabled" : "disabled"})`,
                    ),
                  ],
                })
              }
            >
              {status?.approved ? "Revoke approval" : "Review project approval"}
            </Button>
          </>
        )}
      </div>
      {status?.sessions?.map((session) => (
        <fieldset
          className="mcp-session"
          key={session.sessionGeneration}
          aria-label={`Session ${session.runId}`}
        >
          <legend>
            Session {session.runId.slice(-12)} — {session.idle ? "Idle" : "Active"}
          </legend>
          {!session.canReconnect && (
            <p>
              MCP_PROVIDER: This provider cannot load/resume the session. Start a new session to use
              a changed configuration. Other available tools remain usable.
            </p>
          )}
          {!session.idle && (
            <p>
              Reconnect waits for an idle turn. Finish or stop the current turn before reviewing
              replacement.
            </p>
          )}
          {session.connectors.map((connector) => (
            <p key={`${connector.targetId}:${connector.id}`}>
              {connector.id}: {connector.connection}
              {connector.revision !== read.revision
                ? " (captured configuration differs from this saved revision)"
                : ""}
            </p>
          ))}
          <div className="mcp-actions">
            <Button
              type="button"
              disabled={
                busy ||
                !session.connectors.some(
                  (connector) =>
                    (!serverId || connector.id === serverId) &&
                    connector.connection !== "disconnected",
                )
              }
              onClick={() => {
                const connection = {
                  ...captured,
                  sessionGeneration: session.sessionGeneration,
                  serverIds: serverId
                    ? [serverId]
                    : session.connectors
                        .filter((connector) => connector.connection !== "disconnected")
                        .slice(0, 64)
                        .map((connector) => connector.id),
                };
                void preview(
                  { action: "preview-disconnect", ...connection },
                  { action: "disconnect", ...connection, requestId: randomId() },
                  "Disconnect server",
                );
              }}
            >
              Disconnect server
            </Button>
            <Button
              type="button"
              disabled={busy}
              onClick={() => {
                const connection = {
                  ...captured,
                  sessionGeneration: session.sessionGeneration,
                  serverIds: serverId
                    ? [serverId]
                    : session.connectors
                        .filter((connector) => connector.connection !== "disconnected")
                        .slice(0, 64)
                        .map((connector) => connector.id),
                };
                void preview(
                  { action: "preview-reconnect", ...connection },
                  { action: "reconnect", ...connection, requestId: randomId() },
                  "Reconnect session servers",
                );
              }}
            >
              Reconnect session servers
            </Button>
          </div>
        </fieldset>
      ))}
      {decision && (
        <Modal
          footer={
            <>
              <Button
                variant="secondary"
                type="button"
                disabled={busy}
                onClick={() => setDecision(undefined)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                className={
                  decision.request.action === "revoke-approval" ||
                  decision.request.action === "disconnect"
                    ? "destructive"
                    : ""
                }
                type="button"
                disabled={busy}
                onClick={() => void act(decision.request)}
              >
                Confirm {decision.title.toLowerCase()}
              </Button>
            </>
          }
          title={decision.title}
          busy={busy}
          onClose={() => setDecision(undefined)}
        >
          {decision.details.map((detail) => (
            <p key={detail}>{detail}</p>
          ))}
          <p>
            {decision.title.startsWith("Reconnect")
              ? "This replaces the owning ACP session and all its connectors with fresh capabilities. It requires an idle turn and provider load/resume support. No work is replayed."
              : decision.title.startsWith("Disconnect")
                ? "Calls are cancelled and this instance loses authority immediately. Configured enablement is unchanged."
                : "Approval does not grant permission to invoke tools. Existing ACP permission decisions still apply."}
          </p>
        </Modal>
      )}
    </section>
  );
}
