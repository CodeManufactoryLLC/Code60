import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ApplicationClient, AutomationTranscript } from "../../src/bridge/index.js";
import { AutomationTranscriptModal } from "../../src/renderer/automation-transcript.js";

const listeners = new Set<() => void>();
const pending: {
  id: string;
  resolve(value: AutomationTranscript): void;
  reject(error: Error): void;
}[] = [];
const fixture = {
  subscriptionsAtRead: [] as number[],
  switchExecution: (_id: string) => {},
  listeners: () => listeners.size,
  pending: () => pending.map((read) => read.id),
  changed() {
    for (const listener of listeners) listener();
  },
  reply(text: string, status: AutomationTranscript["status"] = "running") {
    const read = pending.shift();
    if (!read) throw new Error("No pending read");
    read.resolve({
      executionId: read.id,
      runId: read.id,
      status,
      reason: null,
      entries: [{ key: "0", at: "t", type: "message", text }],
      truncated: false,
    });
  },
  fail() {
    pending.shift()?.reject(new Error("Disconnected"));
  },
};
declare global {
  interface Window {
    automationTranscriptFixture: typeof fixture;
  }
}
window.automationTranscriptFixture = fixture;
const api = {
  automation: (request) =>
    new Promise((resolve, reject) => {
      if (request.action !== "transcript") throw new Error("Unexpected request");
      fixture.subscriptionsAtRead.push(listeners.size);
      pending.push({ id: request.executionId, resolve, reject });
    }),
  onAutomationChanged(listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
} satisfies Pick<ApplicationClient, "automation" | "onAutomationChanged">;
function Fixture() {
  const [id, setId] = useState<string>();
  fixture.switchExecution = setId;
  return (
    <>
      <button type="button" onClick={() => setId("A")}>
        Open A
      </button>
      <button type="button" onClick={() => setId("B")}>
        Open B
      </button>
      {id && (
        <AutomationTranscriptModal
          api={api as ApplicationClient}
          executionId={id}
          onClose={() => setId(undefined)}
        />
      )}
    </>
  );
}
createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <Fixture />
  </StrictMode>,
);
