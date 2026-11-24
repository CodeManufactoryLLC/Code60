import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ApplicationClient,
  McpManagementRead,
  McpRuntimeRequest,
  McpRuntimeResponse,
  McpTargetAddress,
} from "../bridge/index.js";
import { mcpFailureGuidance } from "../bridge/index.js";
import { randomId } from "./browser-platform.js";
import { Modal } from "./modal.js";

/** Controls capture the displayed configuration; selection never retargets a pending decision. */
export function McpRuntimePanel({
  api,
  active,
  read,
  serverId,
  blocked,
}: {
  api: ApplicationClient;
  active: boolean;
  read: McpManagementRead;
  serverId?: string | undefined;
  blocked: boolean;
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
  const definition = serverId ? read.document?.servers[serverId] : undefined;
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
  return (
    <section aria-label="MCP connection controls" className="mcp-details">
      <p>
        Enablement and approval apply to future connections. Existing sessions retain their captured
        configuration until explicitly disconnected or reconnected.
      </p>
      {error && <p role="alert">{error}</p>}
      {retry && (
        <button type="button" disabled={busy} onClick={() => void act(retry)}>
          Retry same operation
        </button>
      )}
      {outcome && <p role="status">{outcome}</p>}
      {[...new Set(status?.failures?.map(mcpFailureGuidance))].map((guidance) => (
        <p key={guidance}>{guidance}</p>
      ))}
      {Boolean(status?.unresolvedCleanup) && (
        <p>MCP_CLEANUP: Cleanup is unresolved. Use Verify cleanup without starting new work.</p>
      )}
      {definition && serverId && (
        <>
          <button
            type="button"
            disabled={blocked || busy}
            onClick={() =>
              void act({
                action: "enable",
                ...captured,
                serverId,
                enabled: !definition.enabled,
                requestId: randomId(),
              })
            }
          >
            {definition.enabled ? "Disable server" : "Enable server"}
          </button>
          <button
            type="button"
            disabled={blocked || busy}
            onClick={() => {
              const requestId = randomId();
              setTest(requestId);
              void act({ action: "test", ...captured, serverId, requestId });
            }}
          >
            Test connection
          </button>
        </>
      )}
      {test && (
        <button
          type="button"
          onClick={() => void api.mcpRuntime({ action: "cancel-test", requestId: test })}
        >
          Cancel connection test
        </button>
      )}
      {read.target.scope === "project" && (
        <>
          <span>
            Project approval: {status?.approved ? "Approved for this revision" : "Required"}.
          </span>
          <button
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
          </button>
        </>
      )}
      {status?.sessions?.map((session) => (
        <fieldset key={session.sessionGeneration} aria-label={`Session ${session.runId}`}>
          <p>
            Session {session.runId.slice(-12)} — {session.idle ? "Idle" : "Active"}
          </p>
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
          <button
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
          </button>
          <button
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
          </button>
        </fieldset>
      ))}
      {decision && (
        <Modal title={decision.title} busy={busy} onClose={() => setDecision(undefined)}>
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
          <button type="button" disabled={busy} onClick={() => setDecision(undefined)}>
            Cancel
          </button>
          <button type="button" disabled={busy} onClick={() => void act(decision.request)}>
            Confirm {decision.title.toLowerCase()}
          </button>
        </Modal>
      )}
    </section>
  );
}
