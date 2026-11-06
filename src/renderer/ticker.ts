import { useEffect, useState } from "react";

export function parseChartTick(value: string | null): number {
  const ms = Number(value);
  return Number.isInteger(ms) && ms >= 1000 && ms <= 60000 ? ms : 5000;
}

/** Local clock only: no data reads, and no timers while the document is hidden. */
export function useTicker(enabled = true, intervalMs = 5000): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const sync = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      if (!enabled || document.hidden) return;
      setNow(Date.now());
      timer = setInterval(() => setNow(Date.now()), intervalMs);
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      if (timer !== undefined) clearInterval(timer);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [enabled, intervalMs]);
  return now;
}
