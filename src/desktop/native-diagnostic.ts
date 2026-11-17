// Temporary native-validation instrumentation. Fixed phase labels only, never source data.
type Phase =
  | "quit.status"
  | "quit.shutdown"
  | "desktop.controller"
  | "desktop.logs"
  | "controller.memory"
  | "controller.rag"
  | "controller.agents"
  | "owners.queue"
  | "owners.relay"
  | "owners.diff"
  | "relay.chat"
  | "relay.execution"
  | "relay.writer"
  | "relay.store"
  | "app.quit-call"
  | "app.before-quit"
  | "app.will-quit"
  | "app.quit-event"
  | "process.exit"
  | "window.close"
  | "window.closed"
  | "renderer.destroyed"
  | "capture.settled"
  | "capture.load"
  | "capture.worker-done"
  | "capture.request"
  | "capture.target"
  | "capture.sources"
  | "capture.snapshot"
  | "capture.review"
  | "capture.persist"
  | "capture.integrate"
  | "capture.mode-changing"
  | "capture.missing-checkout"
  | "associate.pinned"
  | "associate.unpinned"
  | "associate.saved-pinned"
  | "associate.saved-unpinned";

export function nativeEvent(phase: Phase, state: "started" | "succeeded" | "failed" = "succeeded") {
  if (process.env.CODE60_NATIVE_DIAG === "1")
    process.stderr.write(
      `${JSON.stringify({ nativePhase: phase, state, at: performance.now() })}\n`,
    );
}

export async function nativeWait<T>(phase: Phase, task: Promise<T>): Promise<T> {
  nativeEvent(phase, "started");
  try {
    const result = await task;
    nativeEvent(phase);
    return result;
  } catch (cause) {
    nativeEvent(phase, "failed");
    throw cause;
  }
}
