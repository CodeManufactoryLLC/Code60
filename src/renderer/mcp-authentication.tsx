import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ApplicationClient,
  McpAuthenticationRequest,
  McpAuthenticationResponse,
  McpManagementRead,
} from "../bridge/index.js";
import { Modal } from "./modal.js";

/** Secret fields are transient; only backend metadata survives submission or navigation. */
export function McpAuthenticationPanel({
  api,
  read,
  serverId,
  blocked,
  active,
}: {
  api: ApplicationClient;
  read: McpManagementRead;
  serverId: string;
  blocked: boolean;
  active: boolean;
}) {
  const definition = read.document?.servers[serverId];
  const capturedKey = JSON.stringify([read.target, read.revision, serverId]);
  const captured = useMemo(() => {
    const [target, expectedRevision, serverId] = JSON.parse(capturedKey) as [
      McpManagementRead["target"],
      string,
      string,
    ];
    return { target, expectedRevision, serverId };
  }, [capturedKey]);
  const epoch = useRef(0);
  const currentOwner = useRef("");
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState<McpAuthenticationResponse>();
  const [status, setStatus] = useState<McpAuthenticationResponse>();
  const [issuer, setIssuer] = useState("");
  const [allowPrivateIssuer, setAllowPrivateIssuer] = useState(false);
  const [reference, setReference] = useState("");
  const [secret, setSecret] = useState("");
  const [storage, setStorage] = useState<"persistent" | "temporary">("persistent");
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<"sign-out" | "forget">();
  const [authorization, setAuthorization] = useState<McpAuthenticationResponse>();
  useEffect(() => {
    if (!active) {
      setSecret("");
      setOpen(false);
    }
  }, [active]);
  useEffect(() => {
    currentOwner.current = capturedKey;
    epoch.current++;
    setOpen(false);
    setSecret("");
    setReview(undefined);
    setStatus(undefined);
    setAuthorization(undefined);
    setError("");
    setOutcome("");
    setConfirmation(undefined);
    return () => {
      if (currentOwner.current === capturedKey) epoch.current++;
    };
  }, [capturedKey]);
  useEffect(() => {
    if (!open) return;
    let disposed = false;
    const refresh = () => {
      void api.mcpAuthentication({ action: "status", ...captured }).then(
        (value) => {
          if (!disposed) setStatus(value);
        },
        () => {
          if (!disposed)
            setError("Authentication status is unavailable; reload this configuration.");
        },
      );
    };
    refresh();
    const unsubscribe = api.onMcpChanged(refresh);
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [api, captured, open]);
  async function act(request: McpAuthenticationRequest) {
    const owner = epoch.current;
    setBusy(true);
    setError("");
    try {
      const result = await api.mcpAuthentication(request);
      if (owner !== epoch.current) return;
      if (request.action === "preview") {
        setReview(result);
        setReference(result.references?.[0]?.reference ?? "");
        if (result.issuer) setIssuer(result.issuer);
        else if (result.issuers?.length === 1) setIssuer(result.issuers[0]!);
      } else if (request.action === "start") {
        setAuthorization(result);
        setStatus(result);
      } else if (request.action === "credential-write") {
        setOutcome(
          "Credential saved. Existing connections keep their captured credentials until explicitly reconnected.",
        );
        setReview(
          (value) =>
            value && { ...value, ...(result.references ? { references: result.references } : {}) },
        );
      } else if (request.action === "credential-forget")
        setOutcome(
          "Credential forgotten and affected connections disconnected. Configuration is unchanged.",
        );
      else if (request.action === "sign-out") {
        setAuthorization(undefined);
        setStatus(result);
        setOutcome(
          result.status === "deletion-uncertain"
            ? "Signed out locally. Secure deletion or cleanup is incomplete; credentials cannot reactivate automatically."
            : "Signed out. Temporary credentials cleared and owned persistent entries removed.",
        );
      } else if (request.action === "cancel") {
        setAuthorization(undefined);
        setOutcome("Sign-in cancelled. No connector was launched.");
      }
      if (request.action === "sign-out" && result.remoteRevocation === "uncertain")
        setError("Local authority is revoked; remote provider revocation could not be verified.");
      setConfirmation(undefined);
      if (request.action !== "preview") {
        const current = await api.mcpAuthentication({ action: "status", ...captured });
        if (owner === epoch.current) setStatus(current);
      }
      return owner === epoch.current ? result : undefined;
    } catch (cause) {
      if (owner === epoch.current)
        setError(
          cause instanceof Error
            ? `MCP_AUTHENTICATION: ${cause.message} Other tools remain available.`
            : "MCP_AUTHENTICATION: Authentication failed or is uncertain. Review before trying again; no temporary fallback was used. Other tools remain available.",
        );
    } finally {
      if (owner === epoch.current) setBusy(false);
    }
  }
  function close() {
    setSecret("");
    const finish = () => {
      setOpen(false);
      setAuthorization(undefined);
      setReview(undefined);
    };
    const attemptId = status?.attemptId ?? authorization?.attemptId;
    if (attemptId && status?.status === "pending") {
      // A failed cancellation stays visible; dismissal must not imply revocation.
      void act({ action: "cancel", attemptId }).then((result) => {
        if (result?.completed) finish();
      });
    } else finish();
  }
  if (!definition) return null;
  const oauth = definition.type === "http" && definition.auth.type === "oauth";
  const hasReferences =
    Object.values(definition.type === "stdio" ? definition.env : definition.headers).some(
      (binding) => "credentialRef" in binding,
    ) ||
    (oauth && definition.auth.type === "oauth" && Boolean(definition.auth.clientSecretRef));
  if (!oauth && !hasReferences) return null;
  const selected = review?.references?.find((item) => item.reference === reference);
  return (
    <section aria-label="MCP authentication controls" className="mcp-details">
      <button
        type="button"
        disabled={blocked || busy}
        onClick={() => {
          setOpen(true);
          void act({ action: "preview", ...captured, allowPrivateIssuer: false });
        }}
      >
        Manage authentication
      </button>
      {open && (
        <Modal
          title={`Authentication — ${definition.label}`}
          className="mcp-authentication"
          busy={busy}
          onClose={close}
        >
          <p>
            Execution:{" "}
            {definition.type === "stdio"
              ? [definition.command, ...definition.args].join(" ")
              : definition.url}
          </p>
          <p>
            Credentials apply to this source and server ID. Changes to the command, endpoint,
            bindings, registration or scopes require a new review. Labels and enablement do not
            change that binding.
          </p>
          <p>
            Credentials stay in the backend. They are never written to mcp.json or sent to the agent
            provider. Moving a definition transfers neither credentials nor approval.
          </p>
          {error && <p role="alert">{error}</p>}
          {outcome && <p role="status">{outcome}</p>}
          <p>
            Last OS storage result:{" "}
            {(status?.secureStorage ?? review?.secureStorage ?? "not-checked").replaceAll("-", " ")}
            . Temporary storage does not require the OS store.
          </p>
          {status?.status && (
            <p role="status">
              Authentication:{" "}
              {status.status === "authenticated" && !oauth
                ? "credentials recorded; availability checked on use"
                : status.status.replaceAll("-", " ")}
            </p>
          )}
          {oauth && (
            <fieldset disabled={busy || status?.status === "pending"}>
              <legend>Authorization server</legend>
              <label>
                Issuer
                <select
                  aria-label="OAuth issuer"
                  value={issuer}
                  onChange={(event) => {
                    setIssuer(event.target.value);
                    setReview((value) =>
                      value
                        ? {
                            ...(value.issuers ? { issuers: value.issuers } : {}),
                            ...(value.references ? { references: value.references } : {}),
                          }
                        : undefined,
                    );
                  }}
                >
                  <option value="">Select an issuer</option>
                  {(review?.issuers ?? []).map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={allowPrivateIssuer}
                  onChange={(event) => setAllowPrivateIssuer(event.target.checked)}
                />
                Allow this selected local/LAN issuer if it differs from the configured MCP origin
              </label>
              <button
                type="button"
                disabled={!issuer}
                onClick={() =>
                  void act({ action: "preview", ...captured, issuer, allowPrivateIssuer })
                }
              >
                Review issuer and scopes
              </button>
              {review?.issuer && (
                <>
                  <p>Issuer: {review.issuer}</p>
                  <p>Resource: {review.resource}</p>
                  <p>Requested scopes: {review.scopes?.join(", ") || "None"}</p>
                  <p>Registration: {review.registration?.replaceAll("-", " ")}</p>
                  <p>Reviewed endpoints: {review.endpoints?.join(", ")}</p>
                </>
              )}
              {review?.registration === "client-information-required" && (
                <p>
                  Supply your OAuth client ID and optional client-secret reference in this
                  definition, then review again. Code60 supplies no shared registration.
                </p>
              )}
            </fieldset>
          )}
          {(review?.references?.length ?? 0) > 0 && (
            <fieldset disabled={busy || status?.status === "pending"}>
              <legend>Credential references</legend>
              <label>
                Reference
                <select
                  aria-label="Credential reference"
                  value={reference}
                  onChange={(event) => {
                    setReference(event.target.value);
                    setSecret("");
                  }}
                >
                  {review?.references?.map((item) => (
                    <option key={item.reference} value={item.reference}>
                      {item.reference} ({item.purpose})
                    </option>
                  ))}
                </select>
              </label>
              <p>
                Recorded state: {selected?.state.replaceAll("-", " ") ?? "Not checked"}
                {selected?.storage ? ` — ${selected.storage}` : ""}. Secure-store availability is
                checked on use.
              </p>
              <label>
                Secret
                <input
                  aria-label="Credential secret"
                  type="password"
                  autoComplete="new-password"
                  spellCheck={false}
                  value={secret}
                  onChange={(event) => setSecret(event.target.value)}
                  maxLength={8192}
                />
              </label>
              {selected?.purpose === "client-secret" && !review?.issuer && (
                <p>Review the selected issuer before entering its client secret.</p>
              )}
              <button
                type="button"
                disabled={
                  !secret ||
                  !review?.previewId ||
                  !reference ||
                  (selected?.purpose === "client-secret" && !review?.issuer)
                }
                onClick={() => {
                  if (!review?.previewId) return;
                  const value = secret;
                  setSecret("");
                  void act({
                    action: "credential-write",
                    ...captured,
                    previewId: review.previewId,
                    reference,
                    secret: value,
                    storage,
                    requestId: crypto.randomUUID(),
                  });
                }}
              >
                Save credential
              </button>
              <button
                type="button"
                disabled={!review?.previewId || !reference}
                onClick={() => {
                  setSecret("");
                  setConfirmation("forget");
                }}
              >
                Forget credential…
              </button>
            </fieldset>
          )}
          <fieldset disabled={busy || status?.status === "pending"}>
            <legend>Credential storage</legend>
            <label>
              <input
                type="radio"
                name="mcp-credential-storage"
                checked={storage === "persistent"}
                onChange={() => setStorage("persistent")}
              />
              Secure OS storage (macOS Keychain or Linux Secret Service)
            </label>
            <label>
              <input
                type="radio"
                name="mcp-credential-storage"
                checked={storage === "temporary"}
                onChange={() => setStorage("temporary")}
              />
              Temporary backend memory — explicitly keep until backend restart or Sign out
            </label>
            <p>
              Locked or unavailable OS storage never falls back to temporary storage automatically.
            </p>
          </fieldset>
          {oauth && (
            <>
              <button
                type="button"
                disabled={
                  busy ||
                  status?.status === "pending" ||
                  !review?.issuer ||
                  !review.previewId ||
                  review.registration === "client-information-required"
                }
                onClick={() => {
                  if (review?.previewId)
                    void act({
                      action: "start",
                      ...captured,
                      previewId: review.previewId,
                      storage,
                      requestId: crypto.randomUUID(),
                    });
                }}
              >
                Start sign-in
              </button>
              {authorization?.authorizationUrl && status?.status === "pending" && (
                <p>
                  <a
                    href={authorization.authorizationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Continue to authorization server
                  </a>
                </p>
              )}
              {status?.status === "pending" && (status.attemptId ?? authorization?.attemptId) && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void act({
                      action: "cancel",
                      attemptId: (status.attemptId ?? authorization?.attemptId)!,
                    })
                  }
                >
                  Cancel sign-in
                </button>
              )}
            </>
          )}
          {status?.status === "pending" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setSecret("");
                setOpen(false);
              }}
            >
              Continue in background
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setSecret("");
              setConfirmation("sign-out");
            }}
          >
            Sign out…
          </button>
          {confirmation && (
            <fieldset aria-label="Confirm authentication change">
              <p>
                {confirmation === "sign-out"
                  ? `Sign out ${definition.label} in this configuration? This revokes affected connections, clears temporary credentials and attempts removal of owned secure entries. Configured enablement is unchanged.`
                  : `Forget ${reference} for ${definition.label}? Affected connections and OAuth grants are revoked. Other manual references are retained; this reference remains in mcp.json.`}
              </p>
              <button type="button" disabled={busy} onClick={() => setConfirmation(undefined)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (confirmation === "sign-out")
                    void act({ action: "sign-out", ...captured, requestId: crypto.randomUUID() });
                  else if (review?.previewId)
                    void act({
                      action: "credential-forget",
                      ...captured,
                      previewId: review.previewId,
                      reference,
                      requestId: crypto.randomUUID(),
                    });
                }}
              >
                Confirm {confirmation === "sign-out" ? "sign out" : "forget"}
              </button>
            </fieldset>
          )}
        </Modal>
      )}
    </section>
  );
}
