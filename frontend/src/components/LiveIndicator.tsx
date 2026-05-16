import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { formatRelative } from "../lib/time";
import { snapshot, subscribe, type WSAggregate } from "../lib/wsRegistry";

/**
 * Small live-data status dot. Three states:
 *   - green pulsing: an authenticated query is currently in flight
 *   - green: last fetch succeeded < 30s ago
 *   - amber/red: last successful fetch is stale (>30s/>2m)
 *
 * Drives off react-query's global fetching count and last-updated metadata
 * — no extra plumbing needed in pages.
 */
export function LiveIndicator() {
  const { t } = useT();
  const qc = useQueryClient();
  const fetching = useIsFetching();
  // Re-render every 5s so the staleness clock ticks while idle.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!document.hidden) tick((x) => x + 1);
    }, 5000);
    return () => window.clearInterval(id);
  }, []);

  // Aggregated WS status across all live streams.
  const [ws, setWS] = useState<WSAggregate>(() => snapshot());
  useEffect(() => subscribe(() => setWS(snapshot())), []);

  // Most recent successful dataUpdatedAt across all queries. We only consider
  // queries whose key starts with a known label so a page transition with
  // few queries doesn't artificially mark everything stale.
  let mostRecent = 0;
  let hasError = false;
  for (const q of qc.getQueryCache().getAll()) {
    if (q.state.dataUpdatedAt > mostRecent) mostRecent = q.state.dataUpdatedAt;
    if (q.state.status === "error") hasError = true;
  }
  const ageMs = mostRecent ? Date.now() - mostRecent : Infinity;
  let tone: "live" | "fresh" | "stale" | "dead";
  if (fetching > 0) tone = "live";
  else if (hasError && ageMs > 30_000) tone = "dead";
  else if (ageMs < 30_000) tone = "fresh";
  else if (ageMs < 120_000) tone = "stale";
  else tone = "dead";

  const cfg = {
    live:  { dot: "bg-emerald-400", ring: "ring-emerald-400/30", pulse: true,  label: t("live.fetching") },
    fresh: { dot: "bg-emerald-400", ring: "ring-emerald-400/0",  pulse: false, label: t("live.fresh") },
    stale: { dot: "bg-amber-400",   ring: "ring-amber-400/0",    pulse: false, label: t("live.stale") },
    dead:  { dot: "bg-red-500",     ring: "ring-red-500/30",     pulse: true,  label: t("live.dead") },
  }[tone];

  const sub =
    mostRecent && tone !== "live"
      ? formatRelative(mostRecent)
      : tone === "live"
      ? t("live.now")
      : t("live.never");

  // Pick the WS dot independently. Empty registry → don't render the dot.
  const wsDot = (() => {
    if (ws.total === 0) return null;
    if (ws.reconnecting > 0)
      return {
        dot: "bg-amber-400",
        pulse: true,
        title: t("live.wsReconnecting", { n: ws.reconnecting }),
      };
    if (ws.errored > 0)
      return {
        dot: "bg-red-500",
        pulse: true,
        title: t("live.wsErrored", { n: ws.errored }),
      };
    if (ws.connecting > 0)
      return {
        dot: "bg-amber-300",
        pulse: true,
        title: t("live.wsConnecting", { n: ws.connecting }),
      };
    return {
      dot: "bg-emerald-400",
      pulse: false,
      title: t("live.wsOpen", { n: ws.open }),
    };
  })();

  return (
    <span
      role="status"
      aria-live="polite"
      title={`${cfg.label} · ${sub}`}
      className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-500"
    >
      <span
        className={`inline-block h-2 w-2 rounded-full ring-2 ${cfg.dot} ${cfg.ring} ${
          cfg.pulse ? "motion-safe:animate-pulse" : ""
        }`}
      />
      {wsDot && (
        <span
          aria-label={wsDot.title}
          title={wsDot.title}
          className={`inline-block h-1.5 w-1.5 rounded-full ${wsDot.dot} ${
            wsDot.pulse ? "motion-safe:animate-pulse" : ""
          }`}
        />
      )}
      <span className="hidden sm:inline">{sub}</span>
    </span>
  );
}
