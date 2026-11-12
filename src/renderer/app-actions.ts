import { useCallback, useEffect, useRef, useState } from "react";

/** App-level busy/error reporting. Callers supply an owner guard for scoped work. */
export function useAppActions(fail: (message: string) => void) {
  const [pending, setPending] = useState(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const setBusy = useCallback((busy: boolean) => {
    if (alive.current) setPending((count) => Math.max(0, count + (busy ? 1 : -1)));
  }, []);
  const attempt = useCallback(
    async (
      operation: () => Promise<unknown>,
      current: () => boolean = () => true,
    ): Promise<boolean> => {
      if (!alive.current || !current()) return false;
      setBusy(true);
      fail("");
      try {
        await operation();
        return alive.current && current();
      } catch (cause) {
        if (alive.current && current())
          fail(cause instanceof Error ? cause.message : String(cause));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [fail, setBusy],
  );
  return { busy: pending > 0, attempt, setBusy };
}
