export type SignalName = "SIGINT" | "SIGTERM";

export interface SignalSource {
  on(signal: SignalName, listener: () => void): unknown;
  off(signal: SignalName, listener: () => void): unknown;
}

export interface SignalHandlers {
  /** First signal: cancel every turn and end every run, with grace periods. */
  first(): void;
  /** Second signal: skip the grace periods. */
  second(): void;
}

export interface SignalWatch {
  /** Whether a signal was received. */
  readonly received: boolean;
  /** Handles an interrupt that did not arrive as a process signal, such as Ctrl+C in raw mode. */
  trigger(): void;
  dispose(): void;
}

export function watchSignals(
  source: SignalSource | undefined,
  handlers: SignalHandlers,
): SignalWatch {
  let count = 0;
  const onSignal = () => {
    count += 1;
    if (count === 1) handlers.first();
    else if (count === 2) handlers.second();
  };
  const names: SignalName[] = ["SIGINT", "SIGTERM"];
  for (const name of names) source?.on(name, onSignal);
  return {
    get received() {
      return count > 0;
    },
    trigger: onSignal,
    dispose() {
      for (const name of names) source?.off(name, onSignal);
    },
  };
}
