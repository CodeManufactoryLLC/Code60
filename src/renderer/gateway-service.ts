import type { SchedulerStatus } from "../bridge/index.js";

export function gatewayServiceState(status: SchedulerStatus | undefined, failed: boolean) {
  if (!status) return failed ? "unavailable" : "checking";
  if (status.service) {
    if (status.installed && status.nativeState !== "running") return "unavailable";
    return "running";
  }
  if (status.nativeState === "unavailable") return "unavailable";
  if (status.nativeState === "running") return "unavailable";
  return status.installed ? "stopped" : "not-installed";
}

export const gatewayServiceLabels = {
  checking: "Checking…",
  unavailable: "Status unavailable",
  running: "Running",
  stopped: "Stopped",
  "not-installed": "Not installed",
} as const;
