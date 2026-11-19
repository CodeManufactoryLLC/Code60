import type { PendingPermission } from "../core/index.js";

import { Button } from "./neobrutalism/button.js";
import { Card } from "./neobrutalism/card.js";

export function PendingApprovals({
  requests,
  busy,
  onAnswer,
}: {
  requests: readonly PendingPermission[];
  busy: boolean;
  onAnswer(id: string, answer: "allow" | "deny"): void;
}) {
  if (!requests.length) return null;
  return (
    <section className="approvals" aria-label="Pending approvals">
      {requests.map((request) => (
        <Card className="approval" key={request.id}>
          <div>
            <strong>Approval needed / {request.kind}</strong>
            <pre>{request.title}</pre>
          </div>
          <Button type="button" disabled={busy} onClick={() => onAnswer(request.id, "deny")}>
            Deny
          </Button>
          <Button
            type="button"
            variant="primary"
            className="primary"
            disabled={busy}
            onClick={() => onAnswer(request.id, "allow")}
          >
            Allow once
          </Button>
        </Card>
      ))}
    </section>
  );
}
