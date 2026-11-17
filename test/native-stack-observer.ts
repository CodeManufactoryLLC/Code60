import type { ChildProcessWithoutNullStreams } from "node:child_process";

/** Temporary controller for the approved CI-only, stack-only observer. */
export function controlNativeStackObserver(
  child: ChildProcessWithoutNullStreams,
  emit: (record: Record<string, unknown>) => void,
) {
  const startedAt = performance.now();
  let stage: "preparing" | "ready" | "capturing" = "preparing";
  let finished = false;
  let cancelled = false;
  let buffer = "";
  let readyResolve: (ready: boolean) => void = () => {};
  let doneResolve: () => void = () => {};
  const ready = new Promise<boolean>((resolve) => {
    readyResolve = resolve;
  });
  const done = new Promise<void>((resolve) => {
    doneResolve = resolve;
  });
  let timer: ReturnType<typeof setTimeout>;

  function finish(state: string) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    readyResolve(false);
    emit({
      nativePhase: "launcher.stack-capture",
      state,
      stage,
      elapsed: performance.now() - startedAt,
    });
    doneResolve();
  }

  function armDeadline() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      finish("observer-timeout");
      // Only the diagnostic child, never Electron or its process tree.
      child.kill();
    }, 5000);
    timer.unref();
  }

  function cancel() {
    if (finished || child.stdin.writableEnded) return;
    cancelled = true;
    readyResolve(false);
    // EOF makes a prepared helper release its pinned process handle and exit.
    child.stdin.end();
  }

  child.stdin.on("error", () => {
    if (finished) return;
    finish("observer-input-unavailable");
    child.kill();
  });
  child.stderr.resume(); // Never retain or log raw PowerShell/compiler errors.
  child.stdout.on("data", (chunk: Buffer) => {
    if (finished) return;
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    if (buffer.length > 65536 || lines.some((line) => line.length > 65536)) {
      finish("observer-output-invalid");
      child.kill();
      return;
    }
    for (const line of lines) {
      let record: Record<string, unknown>;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if (!record || typeof record !== "object" || typeof record.observerPhase !== "string")
        continue;
      emit({ nativePhase: "launcher.stack-observation", observation: record });
      if (record.observerPhase === "stack-capture-ready" && stage === "preparing" && !cancelled) {
        stage = "ready";
        armDeadline();
        readyResolve(true);
      }
      // Each completed sample earns a fresh bound for the next one.
      if (record.observerPhase === "stack-capture-result" && stage === "capturing") armDeadline();
    }
  });
  child.on("error", () => finish("observer-unavailable"));
  child.on("close", (code) => finish(code === 0 ? "completed" : "observer-failed"));
  armDeadline();

  return {
    ready,
    done,
    capture() {
      if (finished || stage !== "ready" || child.stdin.writableEnded) return;
      stage = "capturing";
      armDeadline();
      child.stdin.end("capture\n");
    },
    cancel,
  };
}
