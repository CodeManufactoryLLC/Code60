import { useEffect, useMemo, useRef, useState } from "react";
import {
  type ApplicationClient,
  type McpTargetAddress,
  type McpTroubleshootingReport,
  mcpTroubleshootingReportSchema,
} from "../bridge/index.js";
import { copyText, randomId } from "./browser-platform.js";
import { Button } from "./carbon/button.js";
import { Modal } from "./modal.js";

export function McpTroubleshooting({
  api,
  target,
  active,
}: {
  api: ApplicationClient;
  target: McpTargetAddress;
  active: boolean;
}) {
  const [report, setReport] = useState<McpTroubleshootingReport>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [cleanup, setCleanup] = useState(false);
  const epoch = useRef(0);
  const key = JSON.stringify(target);
  const owner = useMemo(() => JSON.parse(key) as McpTargetAddress, [key]);
  const capturedOwner = useRef(owner);
  useEffect(() => {
    capturedOwner.current = owner;
    epoch.current++;
    setReport(undefined);
    setCleanup(false);
    setNotice("");
    setBusy(false);
    return () => {
      epoch.current++;
    };
  }, [owner]);
  useEffect(() => {
    if (!active) {
      setBusy(false);
      epoch.current++;
      setReport(undefined);
      setCleanup(false);
    }
  }, [active]);
  async function run(action: "report" | "verify-cleanup") {
    const token = epoch.current;
    setBusy(true);
    setNotice("");
    try {
      const result = await api.mcpRuntime(
        action === "report" ? { action, target } : { action, target, requestId: randomId() },
      );
      if (token !== epoch.current || capturedOwner.current !== owner) return;
      if (result.report) setReport(mcpTroubleshootingReportSchema.parse(result.report));
      if (action === "verify-cleanup") {
        setCleanup(false);
        setNotice(
          result.completed
            ? "Owned cleanup verified. No connections were started and no work was replayed."
            : "MCP_CLEANUP: Owned cleanup remains unresolved. Retain the Gateway and evidence; review the recovery runbook before trying again. Other tools remain available.",
        );
      }
    } catch {
      if (token === epoch.current)
        setNotice(
          "MCP_TROUBLESHOOTING_UNAVAILABLE: This configuration owner or Gateway is unavailable. Preserve your draft and evidence, then reload. Other application features remain usable.",
        );
    } finally {
      if (token === epoch.current) setBusy(false);
    }
  }
  return (
    <section aria-label="MCP troubleshooting">
      <Button type="button" disabled={busy || !active} onClick={() => void run("report")}>
        Review troubleshooting report
      </Button>
      <Button type="button" disabled={busy || !active} onClick={() => setCleanup(true)}>
        Verify cleanup
      </Button>
      {notice && <p role="status">{notice}</p>}
      {cleanup && (
        <Modal title="Verify owned MCP cleanup?" busy={busy} onClose={() => setCleanup(false)}>
          <p>
            Retry only cleanup handles retained by this Gateway for this configuration. Authority
            stays revoked. This does not reconnect, replay calls, delete locks or stop unrelated
            processes. Remote cleanup may still be unverifiable.
          </p>
          <Button variant="quiet" type="button" disabled={busy} onClick={() => setCleanup(false)}>
            Cancel cleanup verification
          </Button>
          <Button type="button" disabled={busy} onClick={() => void run("verify-cleanup")}>
            Confirm cleanup verification
          </Button>
        </Modal>
      )}
      {report && (
        <Modal
          title="Safe MCP troubleshooting report"
          busy={busy}
          onClose={() => setReport(undefined)}
        >
          <p>
            This optional report contains counts, fixed codes and observed states only.
            Configuration validity, approval, authentication and connection health are separate
            facts. Definition observations and captured session-instance counts are separate,
            including when the saved file is invalid. Review before copying; nothing is uploaded.
            Definitions, names, IDs, paths, endpoints, credential references, secrets and server
            output are excluded.
          </p>
          <pre>{JSON.stringify(report, null, 2)}</pre>
          <Button
            type="button"
            onClick={() => {
              const token = epoch.current;
              void copyText(JSON.stringify(report, null, 2)).then(
                () => {
                  if (token === epoch.current) setNotice("Safe report copied.");
                },
                () => {
                  if (token === epoch.current)
                    setNotice("Copy failed. Select the report text to copy it manually.");
                },
              );
            }}
          >
            Copy safe report
          </Button>
          <Button variant="quiet" type="button" onClick={() => setReport(undefined)}>
            Close report
          </Button>
        </Modal>
      )}
    </section>
  );
}
