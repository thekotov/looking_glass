import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import * as publicApi from "../api/publicStatus";
import PublicLookupForm from "../components/PublicLookupForm";
import { SkeletonCard } from "../components/Skeleton";
import UptimeStrip from "../components/UptimeStrip";
import { useT } from "../i18n";

const WINDOWS: { v: number; label: string }[] = [
  { v: 3600, label: "1h" },
  { v: 24 * 3600, label: "24h" },
  { v: 7 * 86400, label: "7d" },
];

/**
 * Public, no-auth status page. Renders:
 *   * overall "All systems operational / Degraded / Major outage" banner
 *   * per-target card with current per-agent state and 90-day uptime strip
 *   * a public looking-glass form (anonymous ping/traceroute/tcp_connect)
 */
export default function PublicStatus() {
  const { t } = useT();
  const [windowSec, setWindowSec] = useState<number>(24 * 3600);

  const statusQ = useQuery({
    queryKey: ["public-status", windowSec],
    queryFn: () => publicApi.getPublicStatus(windowSec),
    refetchInterval: 30_000,
  });

  const uptimeQ = useQuery({
    queryKey: ["public-status-uptime"],
    queryFn: () => publicApi.getPublicStatusUptime(90),
    refetchInterval: 5 * 60_000,
  });

  const uptimeByTarget = useMemo(() => {
    const m = new Map<string, publicApi.PublicTargetUptime>();
    for (const t of uptimeQ.data?.targets ?? []) m.set(t.target, t);
    return m;
  }, [uptimeQ.data]);

  const overall = useMemo(() => computeOverall(statusQ.data?.targets ?? []), [statusQ.data]);

  return (
    <div className="min-h-screen bg-slate-950">
      <header className="border-b border-slate-800 bg-slate-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-100">{t("publicStatus.title")}</h1>
            <p className="mt-0.5 text-xs text-slate-500">{t("publicStatus.subtitle")}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="inline-flex overflow-hidden rounded border border-slate-700">
              {WINDOWS.map((w) => (
                <button
                  key={w.v}
                  type="button"
                  onClick={() => setWindowSec(w.v)}
                  className={`px-3 py-1.5 text-xs uppercase tracking-wide focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 ${
                    windowSec === w.v
                      ? "bg-slate-100 text-slate-900"
                      : "text-slate-400 hover:bg-slate-800"
                  }`}
                >
                  {w.label}
                </button>
              ))}
            </div>
            {statusQ.data && (
              <span className="text-[10px] uppercase tracking-wide text-slate-600">
                {t("publicStatus.updated")}: {new Date(statusQ.data.generated_at).toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-6 space-y-6">
        {statusQ.data && statusQ.data.targets.length > 0 && (
          <OverallBanner overall={overall} />
        )}

        {statusQ.isLoading && (
          <div className="space-y-4">
            <SkeletonCard className="h-24" />
            <SkeletonCard className="h-24" />
            <SkeletonCard className="h-24" />
          </div>
        )}

        {statusQ.isError && (
          <p role="alert" className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">
            {statusQ.error instanceof Error ? statusQ.error.message : t("common.failedToLoad")}
          </p>
        )}

        {statusQ.data && statusQ.data.targets.length === 0 && (
          <div className="rounded-lg border border-slate-800 bg-slate-900 px-6 py-8 text-center">
            <p className="text-sm text-slate-300">{t("publicStatus.empty")}</p>
            <p className="mt-1 text-xs text-slate-500">{t("publicStatus.emptyHint")}</p>
          </div>
        )}

        {statusQ.data && statusQ.data.targets.length > 0 && (
          <div className="space-y-3">
            {statusQ.data.targets.map((row) => (
              <TargetCard
                key={row.target}
                row={row}
                uptime={uptimeByTarget.get(row.target)}
              />
            ))}
          </div>
        )}

        <PublicLookupForm />

        <p className="mt-6 text-center text-[10px] uppercase tracking-wide text-slate-700">
          Looking Glass · {t("publicStatus.poweredBy")}
        </p>
      </main>
    </div>
  );
}

type OverallVerdict = {
  tone: "ok" | "degraded" | "down" | "empty";
  affected: number;
  totalTargets: number;
};

function computeOverall(targets: publicApi.PublicTargetStatus[]): OverallVerdict {
  if (targets.length === 0) return { tone: "empty", affected: 0, totalTargets: 0 };
  let affected = 0;
  let allDown = true;
  for (const t of targets) {
    if (t.overall_availability_percent >= 99) {
      allDown = false;
    } else {
      affected++;
      if (t.overall_availability_percent > 50) allDown = false;
    }
  }
  if (affected === 0) return { tone: "ok", affected: 0, totalTargets: targets.length };
  if (allDown) return { tone: "down", affected, totalTargets: targets.length };
  return { tone: "degraded", affected, totalTargets: targets.length };
}

function OverallBanner({ overall }: { overall: OverallVerdict }) {
  const { t } = useT();
  const styles = {
    ok: "border-emerald-700 bg-emerald-950/40 text-emerald-200",
    degraded: "border-amber-700 bg-amber-950/40 text-amber-200",
    down: "border-red-800 bg-red-950/40 text-red-200",
    empty: "border-slate-700 bg-slate-900 text-slate-300",
  }[overall.tone];
  const dot = {
    ok: "bg-emerald-400",
    degraded: "bg-amber-400",
    down: "bg-red-400",
    empty: "bg-slate-500",
  }[overall.tone];
  const text =
    overall.tone === "ok"
      ? t("publicStatus.allOperational")
      : overall.tone === "degraded"
      ? t("publicStatus.degraded", { n: overall.affected })
      : overall.tone === "down"
      ? t("publicStatus.outage")
      : t("publicStatus.noTargets");

  return (
    <div className={`flex items-center gap-3 rounded-lg border px-5 py-4 ${styles}`}>
      <span className={`relative inline-flex h-3 w-3`}>
        <span className={`absolute inline-flex h-full w-full motion-safe:animate-ping rounded-full ${dot} opacity-60`} />
        <span className={`relative inline-flex h-3 w-3 rounded-full ${dot}`} />
      </span>
      <p className="text-lg font-semibold">{text}</p>
    </div>
  );
}

function TargetCard({
  row,
  uptime,
}: {
  row: publicApi.PublicTargetStatus;
  uptime: publicApi.PublicTargetUptime | undefined;
}) {
  const { t } = useT();
  const overall = row.overall_availability_percent;
  const tone = overall >= 99 ? "emerald" : overall >= 90 ? "amber" : "red";
  return (
    <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-5 py-3">
        <div>
          <h2 className="font-mono text-base text-slate-100">{row.label ?? row.target}</h2>
          {row.label && row.label !== row.target && (
            <p className="font-mono text-[11px] text-slate-500">{row.target}</p>
          )}
        </div>
        <div
          className={`text-2xl font-semibold tabular-nums ${
            tone === "emerald"
              ? "text-emerald-300"
              : tone === "amber"
              ? "text-amber-300"
              : "text-red-300"
          }`}
        >
          {overall.toFixed(2)}%
        </div>
      </header>

      {uptime && (
        <div className="border-b border-slate-800 px-5 py-3">
          <div className="mb-1.5 flex items-center justify-between text-[10px] uppercase tracking-wide text-slate-500">
            <span>{t("publicStatus.uptime90d")}</span>
            <span className="font-mono text-slate-400">
              {avg90(uptime.days).toFixed(2)}%
            </span>
          </div>
          <UptimeStrip days={uptime.days} totalDays={90} />
          <div className="mt-1 flex justify-between text-[9px] text-slate-600">
            <span>{t("publicStatus.daysAgo", { n: 90 })}</span>
            <span>{t("publicStatus.today")}</span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
        {row.per_agent.length === 0 ? (
          <p className="text-xs text-slate-500">No data in this window.</p>
        ) : (
          row.per_agent.map((a) => <AgentTile key={a.agent_id} a={a} />)
        )}
      </div>
    </section>
  );
}

function avg90(days: publicApi.UptimeDay[]): number {
  if (days.length === 0) return 0;
  const total = days.reduce((s, d) => s + d.availability_percent, 0);
  return total / days.length;
}

function AgentTile({ a }: { a: publicApi.PublicAgentRollup }) {
  const ok = a.availability_percent >= 99;
  const warn = !ok && a.availability_percent >= 90;
  const border = ok
    ? "border-emerald-800"
    : warn
    ? "border-amber-800"
    : "border-red-800";
  const dot = ok ? "bg-emerald-400" : warn ? "bg-amber-400" : "bg-red-400";
  return (
    <div className={`rounded border ${border} bg-slate-950/60 px-3 py-2`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${dot}`} />
          <span className="truncate font-mono text-xs text-slate-200">{a.agent_label}</span>
        </div>
        <span className="tabular-nums text-xs text-slate-300">
          {a.availability_percent.toFixed(1)}%
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500">
        <span className="tabular-nums">
          {a.rtt_avg_ms !== null ? `${a.rtt_avg_ms.toFixed(1)} ms avg` : "—"}
        </span>
        {a.agent_tags.length > 0 && (
          <span className="uppercase tracking-wide">{a.agent_tags.join(",")}</span>
        )}
      </div>
    </div>
  );
}
