import { useEffect, useState } from "react";

/**
 * Re-renders every `intervalMs` so that derived "X ago" labels age in place
 * between server fetches. The tick is shared across components mounted at
 * the same time via a single setInterval per hook instance — keep the
 * interval coarse (15–30 s) to avoid pointless re-renders.
 *
 * Pauses while the tab is hidden and re-syncs on visibility change so a tab
 * left open overnight doesn't lag behind by ~16 hours of ticks.
 */
export function useNow(intervalMs: number = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!document.hidden) setNow(Date.now());
    }, intervalMs);
    const onVis = () => {
      if (!document.hidden) setNow(Date.now());
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [intervalMs]);
  return now;
}
