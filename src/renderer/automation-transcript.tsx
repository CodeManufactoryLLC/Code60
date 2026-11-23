import { useLayoutEffect, useRef, useState } from "react";
import type { ApplicationClient, AutomationTranscript } from "../bridge/index.js";
import { Modal } from "./modal.js";

export function AutomationTranscriptModal({
  api,
  executionId,
  onClose,
}: {
  api: ApplicationClient;
  executionId: string;
  onClose(): void;
}) {
  const [value, setValue] = useState<AutomationTranscript>();
  const [error, setError] = useState("");
  const refreshLatest = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    setValue(undefined);
    setError("");
    let disposed = false;
    let reading = false;
    let dirty = false;
    const refresh = async () => {
      dirty = true;
      if (disposed || reading) return;
      reading = true;
      try {
        do {
          dirty = false;
          const result = (await api.automation({
            action: "transcript",
            executionId,
          })) as AutomationTranscript;
          if (disposed) return;
          if (result.executionId !== executionId) throw new Error("Execution changed.");
          setValue(result);
          setError("");
        } while (dirty && !disposed);
      } catch {
        if (!disposed)
          setError(
            "Transcript unavailable. Received content is kept; retry or reopen to reconnect.",
          );
      } finally {
        reading = false;
        if (dirty && !disposed) void refresh();
      }
    };
    refreshLatest.current = () => {
      void refresh();
    };
    // Subscribe before the first read; coalesce notices received during each flight.
    const off = api.onAutomationChanged(() => {
      void refresh();
    });
    void refresh();
    return () => {
      disposed = true;
      off();
    };
  }, [api, executionId]);
  const messages = value?.entries.filter((entry) => entry.type === "message") ?? [];
  const details = value?.entries.filter((entry) => entry.type !== "message") ?? [];
  return (
    <Modal title="Execution transcript" busy={false} wide onClose={onClose}>
      {value ? (
        <>
          <p role="status">
            {value.status}
            {value.reason ? ` · ${value.reason.replaceAll("_", " ")}` : ""}
          </p>
          <section aria-label="Transcript content">
            {messages.map((entry) => (
              <pre
                key={entry.key}
                className="automation-evidence"
                data-transcript-type={entry.type}
              >
                {entry.text}
              </pre>
            ))}
          </section>
          {details.length > 0 && (
            <details>
              <summary>Execution details</summary>
              {details.map((entry) => (
                <pre
                  key={entry.key}
                  className="automation-evidence"
                  data-transcript-type={entry.type}
                >
                  {entry.text}
                </pre>
              ))}
            </details>
          )}
          {value.truncated && <p>Showing a partial transcript. Original source remains on disk.</p>}
        </>
      ) : (
        !error && <p role="status">Loading transcript…</p>
      )}
      {error && (
        <div>
          <p role="alert">{error}</p>
          <button type="button" onClick={() => refreshLatest.current()}>
            Retry transcript
          </button>
        </div>
      )}
    </Modal>
  );
}
