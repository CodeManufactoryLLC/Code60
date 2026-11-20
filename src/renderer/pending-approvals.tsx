import { useState } from "react";
import type { Action } from "../bridge/index.js";
import type { PendingPermission } from "../core/index.js";

import { Button } from "./neobrutalism/button.js";
import { Card } from "./neobrutalism/card.js";

export function PendingApprovals({
  requests,
  onAnswer,
}: {
  requests: readonly PendingPermission[];
  onAnswer(id: string, answer: Extract<Action, { type: "permission" }>["answer"]): Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const answer = async (...args: Parameters<typeof onAnswer>) => {
    setBusy(true);
    setError("");
    try {
      await onAnswer(...args);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  if (!requests.length) return null;
  return (
    <section className="approvals" aria-label="Pending approvals">
      {requests.map((request) => (
        <Card className="approval" key={request.id}>
          <div>
            <strong>Approval needed / {request.kind}</strong>
            <pre>{request.title}</pre>
          </div>
          <Button type="button" disabled={busy} onClick={() => void answer(request.id, "deny")}>
            Deny
          </Button>
          <Button
            type="button"
            variant="primary"
            className="primary"
            disabled={busy}
            onClick={() => void answer(request.id, "allow")}
          >
            Allow once
          </Button>
        </Card>
      ))}
      {error && <span role="alert">{error}</span>}
    </section>
  );
}
