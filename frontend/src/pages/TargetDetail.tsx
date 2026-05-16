import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router-dom";
import * as targetsApi from "../api/targets";
import type { MatrixTaskType } from "../api/targets";
import { Breadcrumbs } from "../components/Breadcrumbs";
import LatencyTrendChart from "../components/LatencyTrendChart";
import NavBar from "../components/NavBar";
import { SkeletonCard } from "../components/Skeleton";
import TargetAbout from "../components/TargetAbout";
import { useT } from "../i18n";

const WINDOWS: { v: string; label: string }[] = [
  { v: "1h", label: "1h" },
  { v: "24h", label: "24h" },
  { v: "7d", label: "7d" },
  { v: "30d", label: "30d" },
];

const TYPES: { v: MatrixTaskType; label: string }[] = [
  { v: "ping", label: "ICMP" },
  { v: "tcp_connect", label: "TCP" },
];

export default function TargetDetail() {
  const { t } = useT();
  const { target: rawTarget } = useParams<{ target: string }>();
  const target = rawTarget ? decodeURIComponent(rawTarget) : "";

  const [since, setSince] = useState("24h");
  const [type, setType] = useState<MatrixTaskType>("ping");

  const summaryQ = useQuery({
    queryKey: ["target-summary", target, since, type],
    queryFn: () => targetsApi.getTargetSummary(target, { since, type }),
    enabled: !!target,
    refetchInterval: 30_000,
  });

  const seriesQ = useQuery({
    queryKey: ["target-series", target, since, type],
    queryFn: () => targetsApi.getTargetSeries(target, { since, type }),
    enabled: !!target,
    refetchInterval: 30_000,
  });

  return (
    <div className="min-h-screen bg-slate-950">
      <NavBar />
      <main className="mx-auto max-w-6xl px-6 py-6">
        <Breadcrumbs
          items={[
            { to: "/targets", label: t("nav.targets") },
            { label: target, mono: true },
          ]}
        />

        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h1 className="font-mono text-xl text-slate-100">{target}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex overflow-hidden rounded border border-slate-700">
              {TYPES.map((tp) => (
                <button
                  key={tp.v}
                  type="button"
                  onClick={() => setType(tp.v)}
                  className={`px-3 py-1.5 text-xs uppercase tracking-wide focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 ${
                    type === tp.v
                      ? "bg-slate-100 text-slate-900"
                      : "text-slate-400 hover:bg-slate-800"
                  }`}
                >
                  {tp.label}
                </button>
              ))}
            </div>
            <div className="inline-flex overflow-hidden rounded border border-slate-700">
              {WINDOWS.map((w) => (
                <button
                  key={w.v}
                  type="button"
                  onClick={() => setSince(w.v)}
                  className={`px-3 py-1.5 text-xs uppercase tracking-wide focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 ${
                    since === w.v
                      ? "bg-slate-100 text-slate-900"
                      : "text-slate-400 hover:bg-slate-800"
                  }`}
                >
                  {w.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {summaryQ.isLoading && (
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        )}

        {summaryQ.data && (
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard
              label={t("targets.statAvail")}
              value={`${summaryQ.data.overall_availability_percent.toFixed(2)}%`}
              tone={availTone(summaryQ.data.overall_availability_percent)}
              hint={t("targets.statAvailHint", { n: summaryQ.data.total_samples })}
            />
            <StatCard
              label={t("targets.statAgents")}
              value={String(summaryQ.data.per_agent.length)}
              hint={t("targets.statAgentsHint")}
            />
            <StatCard
              label={t("targets.statBest")}
              value={bestAvgFormatted(summaryQ.data.per_agent)}
              hint={t("targets.statBestHint")}
            />
          </div>
        )}

        <div className="mb-4">
          <TargetAbout target={target} />
        </div>

        <section className="mb-4 rounded-lg border border-slate-800 bg-slate-900">
          <header className="border-b border-slate-800 px-6 py-3">
            <h2 className="text-xs uppercase tracking-wide text-slate-500">
              {t("targets.chartTitle")}
            </h2>
          </header>
          <div className="px-6 py-4">
            {seriesQ.isLoading && <SkeletonCard className="h-64" />}
            {seriesQ.isError && (
              <p role="alert" className="text-sm text-red-400">
                {seriesQ.error instanceof Error
                  ? seriesQ.error.message
                  : t("common.failedToLoad")}
              </p>
            )}
            {seriesQ.data && <LatencyTrendChart series={seriesQ.data} height={300} />}
          </div>
        </section>

        <section className="rounded-lg border border-slate-800 bg-slate-900">
          <header className="border-b border-slate-800 px-6 py-3">
            <h2 className="text-xs uppercase tracking-wide text-slate-500">
              {t("targets.tableTitle")}
            </h2>
          </header>
          {summaryQ.data && summaryQ.data.per_agent.length > 0 ? (
            <table className="w-full text-sm">
              <thead className="text-left text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-6 py-2 font-medium">{t("targets.thAgent")}</th>
                  <th className="px-6 py-2 font-medium">{t("targets.thAvail")}</th>
                  <th className="px-6 py-2 font-medium">{t("targets.thSamples")}</th>
                  <th className="px-6 py-2 font-medium">{t("targets.thAvgRtt")}</th>
                  <th className="px-6 py-2 font-medium">{t("targets.thMinRtt")}</th>
                  <th className="px-6 py-2 font-medium">{t("targets.thMaxRtt")}</th>
                  <th className="px-6 py-2 font-medium">{t("targets.thLastSample")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {summaryQ.data.per_agent.map((a) => (
                  <tr key={a.agent_id} className="hover:bg-slate-900/50">
                    <td className="px-6 py-2 font-mono text-slate-200">
                      {a.agent_label}
                      {a.agent_tags.length > 0 && (
                        <span className="ml-2 text-[10px] uppercase text-slate-500">
                          {a.agent_tags.join(",")}
                        </span>
                      )}
                    </td>
                    <td className={`px-6 py-2 tabular-nums ${availTextTone(a.availability_percent)}`}>
                      {a.availability_percent.toFixed(2)}%
                    </td>
                    <td className="px-6 py-2 tabular-nums text-slate-400">
                      {a.success_count}/{a.samples}
                    </td>
                    <td className="px-6 py-2 tabular-nums text-slate-300">
                      {a.rtt_avg_ms !== null ? `${a.rtt_avg_ms.toFixed(1)} ms` : "—"}
                    </td>
                    <td className="px-6 py-2 tabular-nums text-slate-400">
                      {a.rtt_min_ms !== null ? `${a.rtt_min_ms.toFixed(1)} ms` : "—"}
                    </td>
                    <td className="px-6 py-2 tabular-nums text-slate-400">
                      {a.rtt_max_ms !== null ? `${a.rtt_max_ms.toFixed(1)} ms` : "—"}
                    </td>
                    <td className="px-6 py-2 text-xs text-slate-500">
                      {a.last_sample_at ? new Date(a.last_sample_at).toLocaleString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="px-6 py-6 text-sm text-slate-500">{t("targets.noSamples")}</p>
          )}
        </section>
      </main>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "emerald" | "amber" | "red" | "slate";
}) {
  const valueColor = {
    emerald: "text-emerald-300",
    amber: "text-amber-300",
    red: "text-red-300",
    slate: "text-slate-100",
  }[tone ?? "slate"];
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 px-5 py-4">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${valueColor}`}>{value}</p>
      {hint && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

function availTone(pct: number): "emerald" | "amber" | "red" {
  if (pct >= 99) return "emerald";
  if (pct >= 90) return "amber";
  return "red";
}

function availTextTone(pct: number): string {
  if (pct >= 99) return "text-emerald-300";
  if (pct >= 90) return "text-amber-300";
  return "text-red-300";
}

function bestAvgFormatted(per_agent: targetsApi.TargetAgentStats[]): string {
  const candidates = per_agent
    .filter((a) => a.rtt_avg_ms !== null)
    .sort((a, b) => (a.rtt_avg_ms ?? 0) - (b.rtt_avg_ms ?? 0));
  if (candidates.length === 0) return "—";
  const top = candidates[0];
  return `${top.rtt_avg_ms!.toFixed(1)} ms · ${top.agent_label}`;
}
