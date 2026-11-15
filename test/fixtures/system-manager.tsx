import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AutomationUiRequest, ServiceStatus } from "../../src/bridge/index.js";
import { SystemManagerPage } from "../../src/renderer/system-manager.js";

const installed: ServiceStatus = {
  version: 1,
  appVersion: "test",
  pid: 123,
  startedAt: "2026-01-01T00:00:00.000Z",
  revision: 1,
  pausedAll: false,
  block: null,
  activeExecutionId: null,
};
let status: ServiceStatus | undefined;
const listeners = new Set<() => void>();
const reads: (() => void)[] = [];
const actions: (() => void)[] = [];
const fixture = {
  requests: [] as AutomationUiRequest[],
  holdReads: false,
  holdActions: false,
  failAction: false,
  publish(next: Partial<ServiceStatus> | null = {}) {
    status = next === null ? undefined : { ...installed, ...next };
    for (const listener of listeners) listener();
  },
  releaseRead() {
    reads.shift()?.();
  },
  releaseAction() {
    actions.shift()?.();
  },
  listeners: () => listeners.size,
};
declare global {
  interface Window {
    systemManagerFixture: typeof fixture;
  }
}
window.systemManagerFixture = fixture;
const api = {
  async automation(request: AutomationUiRequest): Promise<unknown> {
    fixture.requests.push(request);
    if (request.action === "status") {
      const captured = status && structuredClone(status);
      if (fixture.holdReads) await new Promise<void>((resolve) => reads.push(resolve));
      if (!captured) throw new Error("Service unavailable");
      return captured;
    }
    if (fixture.holdActions) await new Promise<void>((resolve) => actions.push(resolve));
    if (fixture.failAction) throw new Error("Service action refused");
    if (request.action === "scheduler")
      status = ["stop", "uninstall"].includes(request.control) ? undefined : { ...installed };
    else if (request.action === "pauseAll")
      status = { ...installed, pausedAll: true, activeExecutionId: null };
    else if (request.action === "resumeAll" || request.action === "resolveBlock")
      status = { ...installed };
    else throw new Error("Unexpected service request");
    return null;
  },
  onAutomationChanged(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
function Fixture() {
  const [active, setActive] = useState(false);
  return (
    <main>
      <button type="button" onClick={() => setActive((value) => !value)}>
        Toggle page
      </button>
      <div hidden={!active}>
        <SystemManagerPage api={api} active={active} />
      </div>
    </main>
  );
}
createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <Fixture />
  </StrictMode>,
);
