import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { Link } from "react-router-dom";
import * as agentsApi from "../api/agents";
import { getStats, getTasksPerHour } from "../api/stats";
import NavBar from "../components/NavBar";
import { SparklineBars } from "../components/Sparkline";
import SystemHealthStrip from "../components/SystemHealthStrip";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useNow } from "../hooks/useNow";
import { useUrlState } from "../hooks/useUrlState";
import { useT } from "../i18n";
import { formatAbsolute, formatRelative } from "../lib/time";

// Lazy-load: react-simple-maps + d3 pull ~150 KB that aren't needed
// for the rest of the dashboard.
const AgentsMap = lazy(() => import("../components/AgentsMap"));

const RANGE_OPTIONS: { value: string; hours: number; key: string }[] = [
  { value: "1h", hours: 1, key: "dashboard.range.1h" },
  { value: "6h", hours: 6, key: "dashboard.range.6h" },
  { value: "24h", hours: 24, key: "dashboard.range.24h" },
  { value: "7d", hours: 168, key: "dashboard.range.7d" },
];

export default function Dashboard() {
  const { t } = useT();
  useDocumentTitle(t("dashboard.title"));
  // Drives re-render of "X minutes ago" labels between fetches.
  useNow(30_000);

  const [range, setRange] = useUrlState("range", "24h");
  const rangeCfg = RANGE_OPTIONS.find((r) => r.value === range) ?? RANGE_OPTIONS[2];
  const hours = rangeCfg.hours;

  const q = useQuery({
    queryKey: ["stats", hours],
    queryFn: () => getStats(hours),
    refetchInterval: 5000,
  });
  const agentsQ = useQuery({
    queryKey: ["agents"],
    queryFn: agentsApi.listAgents,
    refetchInterval: 10_000,
  });
  // Refresh less frequently than counters — hourly buckets only change
  // meaningfully on minute timescales.
  const hourlyQ = useQuery({
    queryKey: ["stats", "tasks-per-hour", hours],
    queryFn: () => getTasksPerHour(hours),
    refetchInterval: 60_000,
  });

  return (
    <div className="min-h-screen bg-slate-950">
      <NavBar />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-slate-100">{t("dashboard.title")}</h1>
          <div
            role="radiogroup"
            aria-label={t("dashboard.range.label")}
            className="inline-flex overflow-hidden rounded border border-slate-700"
          >
            {RANGE_OPTIONS.map((r) => (
              <button
                key={r.value}
                type="button"
                role="radio"
                aria-checked={range === r.value}
                onClick={() => setRange(r.value)}
                className={`px-2.5 py-1 text-xs uppercase tracking-wide focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 ${
                  range === r.value
                    ? "bg-slate-100 text-slate-900"
                    : "text-slate-400 hover:bg-slate-800"
                }`}
              >
                {t(r.key)}
              </button>
            ))}
          </div>
        </div>

        {q.isLoading && <p className="text-slate-500">{t("common.loading")}</p>}
        {q.isError && (
          <p className="text-red-400">
            {q.error instanceof Error ? q.error.message : t("common.failedToLoad")}
          </p>
        )}
        {q.data && (
          <div className="space-y-6">
            {/* Top counters */}
            <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Card
                label={t("dashboard.onlineAgents")}
                value={q.data.agents.online}
                tone="emerald"
                to="/agents"
              />
              <Card
                label={t("dashboard.activeAgents")}
                value={q.data.agents.active}
                to="/agents"
              />
              <Card
                label={t("dashboard.pendingApproval")}
                value={q.data.agents.pending}
                tone="amber"
                to="/agents"
              />
              <Card
                label={t("dashboard.tasksInRange", { range: t(rangeCfg.key) })}
                value={q.data.tasks.last_24h_total}
                to="/tasks"
                sparkline={hourlyQ.data}
              />
            </section>

            {/* System health */}
            <section>
              <h2 className="mb-2 text-xs uppercase tracking-wide text-slate-500">
                {t("dashboard.systemHealth")}
              </h2>
              <SystemHealthStrip />
            </section>

            {/* Agents map */}
            <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
              <header className="border-b border-slate-800 px-6 py-3">
                <h2 className="text-xs uppercase tracking-wide text-slate-500">
                  {t("dashboard.agentsMap")}
                </h2>
              </header>
              <div className="px-2 py-2">
                <Suspense
                  fallback={
                    <div className="flex h-[340px] items-center justify-center text-xs text-slate-500">
                      {t("common.loading")}
                    </div>
                  }
                >
                  <AgentsMap agents={agentsQ.data ?? []} height={340} />
                </Suspense>
              </div>
            </section>

            {/* Bars */}
            <div className="grid gap-4 lg:grid-cols-2">
              <Bars
                title={t("dashboard.byStatusInRange", { range: t(rangeCfg.key) })}
                data={q.data.tasks.last_24h_by_status}
                colorFor={statusColor}
                emptyLabel={t("dashboard.noData")}
              />
              <Bars
                title={t("dashboard.byTypeInRange", { range: t(rangeCfg.key) })}
                data={q.data.tasks.last_24h_by_type}
                emptyLabel={t("dashboard.noData")}
              />
            </div>

            {/* Recent failures */}
            <section className="rounded-lg border border-slate-800 bg-slate-900">
              <header className="border-b border-slate-800 px-6 py-3">
                <h2 className="text-xs uppercase tracking-wide text-slate-500">
                  {t("dashboard.recentFailures")}
                </h2>
              </header>
              {q.data.tasks.recent_failures.length === 0 ? (
                <p className="px-6 py-4 text-sm text-slate-500">{t("dashboard.noFailures")}</p>
              ) : (
                <ul className="divide-y divide-slate-800">
                  {q.data.tasks.recent_failures.map((f) => (
                    <li key={f.id} className="px-6 py-3 text-sm">
                      <div className="flex items-center justify-between">
                        <Link
                          to={`/tasks/${f.id}`}
                          className="font-mono text-slate-100 hover:underline"
                        >
                          {f.type} {f.target}
                        </Link>
                        <span
                          className="text-xs text-slate-500"
                          title={formatAbsolute(f.finished_at)}
                        >
                          {f.finished_at ? formatRelative(f.finished_at) : "—"}
                        </span>
                      </div>
                      {f.error && (
                        <p className="mt-1 font-mono text-xs text-red-300">{f.error}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

function Card({
  label,
  value,
  tone,
  to,
  sparkline,
}: {
  label: string;
  value: number;
  tone?: "emerald" | "amber" | "red";
  to?: string;
  sparkline?: { total: number; failed: number }[];
}) {
  const colors = {
    emerald: "text-emerald-400",
    amber: "text-amber-400",
    red: "text-red-400",
  };
  const body = (
    <>
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-1 flex items-end justify-between gap-2">
        <p className={`text-2xl font-semibold ${tone ? colors[tone] : "text-slate-100"}`}>
          {value}
        </p>
        {sparkline && sparkline.length > 0 && (
          <SparklineBars
            values={sparkline.map((b) => b.total)}
            colorFor={(i, _v) => {
              // Tint hours with failures amber.
              const failed = sparkline[i]?.failed ?? 0;
              if (failed > 0) return "#fbbf24";
              return "#475569";
            }}
            width={88}
            height={20}
            ariaLabel="hourly task counts, last 24h"
          />
        )}
      </div>
    </>
  );
  const cls =
    "block rounded-lg border border-slate-800 bg-slate-900 px-4 py-3 transition-colors";
  if (to) {
    return (
      <Link to={to} className={`${cls} hover:border-slate-700 hover:bg-slate-900/70`}>
        {body}
      </Link>
    );
  }
  return <div className={cls}>{body}</div>;
}

function Bars({
  title,
  data,
  colorFor,
  emptyLabel,
}: {
  title: string;
  data: Record<string, number>;
  colorFor?: (key: string) => string;
  emptyLabel: string;
}) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = entries.reduce((m, [, v]) => Math.max(m, v), 1);
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900">
      <header className="border-b border-slate-800 px-6 py-3">
        <h2 className="text-xs uppercase tracking-wide text-slate-500">{title}</h2>
      </header>
      <div className="space-y-2 px-6 py-4">
        {entries.length === 0 && <p className="text-sm text-slate-500">{emptyLabel}</p>}
        {entries.map(([k, v]) => {
          const pct = (v / max) * 100;
          const color = colorFor?.(k) ?? "bg-slate-600";
          return (
            <div key={k} className="grid grid-cols-[120px_1fr_40px] items-center gap-3 text-xs">
              <span className="font-mono text-slate-400">{k}</span>
              <div className="h-2 overflow-hidden rounded bg-slate-800">
                <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
              </div>
              <span className="text-right text-slate-300">{v}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function statusColor(status: string): string {
  switch (status) {
    case "completed":
      return "bg-emerald-600";
    case "failed":
    case "timeout":
      return "bg-red-600";
    case "running":
    case "claimed":
      return "bg-blue-600";
    case "queued":
      return "bg-slate-600";
    case "cancelled":
      return "bg-amber-600";
  }
  return "bg-slate-600";
}
