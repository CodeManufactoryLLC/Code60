import { type Ref, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type {
  ApplicationClient,
  McpRecoveryRequest,
  McpRecoveryResponse,
  McpRecoveryReview,
  McpTargetAddress,
} from "../bridge/index.js";
import { randomId } from "./browser-platform.js";
import { Button } from "./carbon/button.js";
import { Modal } from "./modal.js";

export interface McpRecoveryActions {
  open(): void;
}

/** Reviewing recovery never grants connector authority. */
export function McpRecoveryPanel({
  api,
  target,
  active,
  onChanged,
  actionsRef,
  onBusyChange,
}: {
  api: ApplicationClient;
  target: McpTargetAddress;
  active: boolean;
  onChanged(): void;
  actionsRef?: Ref<McpRecoveryActions>;
  onBusyChange?(busy: boolean): void;
}) {
  const [opened, setOpened] = useState(false);
  const [pending, setPending] = useState<McpRecoveryResponse["pending"]>();
  const [review, setReview] = useState<McpRecoveryReview>();
  const [decision, setDecision] = useState<"complete" | "rollback">();
  const [retry, setRetry] = useState<McpRecoveryRequest>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const epoch = useRef(0);
  const pendingAction = useRef(false);
  const key = JSON.stringify(target);
  const owner = useMemo(() => JSON.parse(key) as McpTargetAddress, [key]);
  const capturedOwner = useRef(owner);
  useEffect(() => {
    capturedOwner.current = owner;
    epoch.current++;
    setOpened(false);
    setReview(undefined);
    setPending(undefined);
    setDecision(undefined);
    setRetry(undefined);
    setNotice("");
    return () => {
      epoch.current++;
    };
  }, [owner]);
  useEffect(() => {
    if (!active) {
      setBusy(false);
      setOpened(false);
      epoch.current++;
    }
  }, [active]);
  const act = async (request: McpRecoveryRequest) => {
    if (pendingAction.current) return;
    pendingAction.current = true;
    setBusy(true);
    const token = epoch.current;
    setNotice("");
    try {
      const value = await api.mcpRecovery(request);
      if (token !== epoch.current || capturedOwner.current !== owner) return;
      if (value.pending) {
        setPending(value.pending);
        setReview(undefined);
        setDecision(undefined);
      }
      if (value.review) {
        setReview(value.review);
        setDecision(undefined);
      }
      if (value.result) {
        setNotice(
          value.result.status === "recovery-required"
            ? "MCP_RECOVERY_REQUIRED: Recovery remains uncertain. Evidence is retained. Review again before another decision."
            : "Recovery verified. Existing sessions and credentials are unchanged.",
        );
        setReview(undefined);
        setDecision(undefined);
        setPending(undefined);
        onChanged();
      }
      setRetry(undefined);
    } catch {
      if (token !== epoch.current || capturedOwner.current !== owner) return;
      setNotice(
        "MCP_RECOVERY_BLOCKED: Evidence, configuration or project ownership changed or is unavailable. No recovery is claimed. Reopen affected projects and review again. Other available tools remain usable.",
      );
      if (request.action === "recover") {
        setRetry(request);
        setDecision(undefined);
        setReview(undefined);
      }
    } finally {
      pendingAction.current = false;
      if (token === epoch.current) setBusy(false);
    }
  };
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  useImperativeHandle(actionsRef, () => ({
    open() {
      if (busy || !active) return;
      setOpened(true);
      void act({ action: "list", target });
    },
  }));
  return (
    <>
      {opened && (
        <Modal
          footer={
            <>
              {decision && review ? (
                <>
                  <Button
                    variant="secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => setDecision(undefined)}
                  >
                    Cancel recovery
                  </Button>
                  <Button
                    className="destructive"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void act({
                        action: "recover",
                        direction: decision,
                        transactionId: review.transactionId,
                        reviewRevision: review.reviewRevision,
                        targets: review.targets.map(({ target, expectedRevision }) => ({
                          target,
                          expectedRevision,
                        })),
                        requestId: randomId(),
                      })
                    }
                  >
                    Confirm {decision === "complete" ? "complete" : "roll back"}
                  </Button>
                </>
              ) : (
                <Button
                  variant="primary"
                  type="button"
                  disabled={busy}
                  onClick={() => setOpened(false)}
                >
                  Close recovery
                </Button>
              )}
            </>
          }
          initialFocus={decision ? ".cds--btn--secondary" : undefined}
          title="MCP configuration recovery"
          busy={busy}
          onClose={() => setOpened(false)}
        >
          <p>
            Only recorded configuration writes can be completed or rolled back. Startup never
            replays them. Backups and transaction evidence stay private. Recovery affects only
            recorded configurations. Other available tools remain usable.
          </p>
          {notice && <p role="status">{notice}</p>}
          {pending?.length === 0 && <p>No pending configuration transactions.</p>}
          {pending?.map((entry) => (
            <div key={entry.transactionId}>
              <p>
                Transaction {entry.transactionId}
                {!entry.available &&
                  " — Reopen all affected projects to review. Evidence is retained."}
              </p>
              <Button
                type="button"
                disabled={busy || !entry.available}
                onClick={() =>
                  void act({ action: "review", target, transactionId: entry.transactionId })
                }
              >
                Review transaction
              </Button>
            </div>
          ))}
          {review && (
            <>
              <p>
                Recorded operation: {review.kind}. Changes are ordered as published; rollback
                reverses that order.
              </p>
              {review.targets.map((entry) => (
                <div key={entry.target.targetId}>
                  <p>
                    {entry.label}:{" "}
                    {entry.writes ? "Configuration write" : "Unchanged inheritance guard"}. Current
                    state: {entry.state}.
                  </p>
                  {entry.changedServerIds.length > 0 && (
                    <p>Changed server IDs: {entry.changedServerIds.join(", ")}.</p>
                  )}
                  <p>
                    Before:{" "}
                    {!entry.before.exists
                      ? "File absent"
                      : !entry.before.valid
                        ? "Malformed file (rollback restores its exact original bytes)"
                        : `${entry.before.servers} definitions`}
                    . After:{" "}
                    {!entry.after.exists ? "File absent" : `${entry.after.servers} definitions`}.
                  </p>
                </div>
              ))}
              {!review.allowed && (
                <p role="alert">
                  MCP_RECOVERY_CONFLICT: A newer edit differs from both recorded states. Recovery is
                  blocked. Preserve the evidence and use the recovery runbook; no force or lock
                  deletion is offered.
                </p>
              )}
              {review.targets.some((t) => t.target.scope === "user") && (
                <p>
                  Changing User configuration affects other projects inheriting its definitions.
                  Closed repositories are not scanned.
                </p>
              )}
              <Button
                type="button"
                disabled={busy || !review.allowed}
                onClick={() => setDecision("complete")}
              >
                Complete transaction
              </Button>
              <Button
                type="button"
                disabled={busy || !review.allowed}
                onClick={() => setDecision("rollback")}
              >
                Roll back transaction
              </Button>
              {decision && (
                <fieldset aria-label="Confirm recovery">
                  <p>
                    {decision === "complete"
                      ? "Publish the recorded final configuration states?"
                      : "Restore the recorded original configuration states?"}{" "}
                    Every reviewed revision and project identity is rechecked. Credentials and
                    approvals are not transferred; running work is not replayed.
                  </p>
                </fieldset>
              )}
            </>
          )}
          {retry && (
            <Button type="button" disabled={busy} onClick={() => void act(retry)}>
              Check same recovery request
            </Button>
          )}
          <Button
            type="button"
            disabled={busy}
            onClick={() => void act({ action: "list", target })}
          >
            Refresh recovery evidence
          </Button>
        </Modal>
      )}
    </>
  );
}
