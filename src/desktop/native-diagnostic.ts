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
  | "relay.store";

export async function nativeWait<T>(phase: Phase, task: Promise<T>): Promise<T> {
  const report = (state: "started" | "succeeded" | "failed") => {
    if (process.env.CODE60_NATIVE_DIAG === "1")
      process.stderr.write(
        `${JSON.stringify({ nativePhase: phase, state, at: performance.now() })}\n`,
      );
  };
  report("started");
  try {
    const result = await task;
    report("succeeded");
    return result;
  } catch (cause) {
    report("failed");
    throw cause;
  }
}
