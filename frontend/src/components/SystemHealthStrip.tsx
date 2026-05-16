import { useQuery } from "@tanstack/react-query";
import * as monitoringApi from "../api/monitoring";
import { useT } from "../i18n";

/**
 * Self-monitoring row for the dashboard: DB/Redis health, queue depth,
 * running tasks, agent uptime ratio, 1h error rate, scheduler activity.
 * Polled every 5s; quick visual signal that something's off.
 */
export default function SystemHealthStrip() {
  const { t } = useT();
  const q = useQuery({
    queryKey: ["health-v2"],
    queryFn: monitoringApi.getHealthV2,
    refetchInterval: 5_000,
  });

  if (q.isLoading || !q.data) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-16 motion-safe:animate-pulse rounded-lg border border-slate-800 bg-slate-900"
          />
        ))}
      </div>
    );
  }

  const d = q.data;
  const errRate = (d.tasks.error_rate_1h * 100).toFixed(1);
  const uptimeRatio = (d.agents.uptime_ratio * 100).toFixed(0);
  const dbOk = d.components.postgres?.status === "ok";
  const redisOk = d.components.redis?.status === "ok";
  const dbLat = d.components.postgres?.latency_ms ?? null;
  const redisLat = d.components.redis?.latency_ms ?? null;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <HealthCell
        label={t("health.db")}
        value={dbOk ? "OK" : "DOWN"}
        sub={dbLat !== null ? `${dbLat.toFixed(1)} ms` : undefined}
        tone={dbOk ? "ok" : "bad"}
      />
      <HealthCell
        label={t("health.redis")}
        value={redisOk ? "OK" : "DOWN"}
        sub={redisLat !== null ? `${redisLat.toFixed(1)} ms` : undefined}
        tone={redisOk ? "ok" : "bad"}
      />
      <HealthCell
        label={t("health.queue")}
        value={String(d.tasks.queued)}
        sub={`+${d.tasks.running} ${t("health.running")}`}
        tone={d.tasks.queued > 50 ? "warn" : "neutral"}
      />
      <HealthCell
        label={t("health.errorRate")}
        value={`${errRate}%`}
        sub={`${d.tasks.last_1h_failed}/${d.tasks.last_1h_total} ${t("health.last1h")}`}
        tone={d.tasks.error_rate_1h > 0.2 ? "bad" : d.tasks.error_rate_1h > 0.05 ? "warn" : "ok"}
      />
      <HealthCell
        label={t("health.agentsOnline")}
        value={`${d.agents.online}/${d.agents.active}`}
        sub={d.agents.active > 0 ? `${uptimeRatio}% ${t("health.upRatio")}` : t("health.noActive")}
        tone={
          d.agents.active === 0
            ? "neutral"
            : d.agents.uptime_ratio >= 0.99
            ? "ok"
            : d.agents.uptime_ratio >= 0.5
            ? "warn"
            : "bad"
        }
      />
      <HealthCell
        label={t("health.scheduler")}
        value={String(d.scheduler?.enabled_schedules ?? 0)}
        sub={
          d.scheduler?.last_fire_at
            ? `last: ${new Date(d.scheduler.last_fire_at).toLocaleTimeString()}`
            : t("health.never")
        }
        tone={d.scheduler && d.scheduler.enabled_schedules > 0 ? "ok" : "neutral"}
      />
    </div>
  );
}

type Tone = "ok" | "warn" | "bad" | "neutral";

function HealthCell({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: Tone;
}) {
  const valueColor = {
    ok: "text-emerald-300",
    warn: "text-amber-300",
    bad: "text-red-300",
    neutral: "text-slate-100",
  }[tone];
  const dot = {
    ok: "bg-emerald-400",
    warn: "bg-amber-400",
    bad: "bg-red-400",
    neutral: "bg-slate-500",
  }[tone];
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 px-4 py-3">
      <div className="flex items-center gap-1.5">
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />
        <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      </div>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${valueColor}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[10px] text-slate-500">{sub}</p>}
    </div>
  );
}
