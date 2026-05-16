import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import * as publicApi from "../api/publicStatus";
import type {
  PublicLookupAgent,
  PublicLookupTask,
  PublicLookupType,
} from "../api/publicStatus";
import { useT } from "../i18n";

const TYPES: { v: PublicLookupType; label: string }[] = [
  { v: "ping", label: "ping" },
  { v: "traceroute", label: "traceroute" },
  { v: "tcp_connect", label: "tcp" },
];

const TERMINAL = new Set(["completed", "failed", "timeout", "cancelled"]);

export default function PublicLookupForm() {
  const { t } = useT();

  const agentsQ = useQuery({
    queryKey: ["public-lookup-agents"],
    queryFn: publicApi.getPublicLookupAgents,
  });

  const [type, setType] = useState<PublicLookupType>("ping");
  const [target, setTarget] = useState("1.1.1.1");
  const [agentId, setAgentId] = useState<string>("");
  const [port, setPort] = useState<number>(443);
  const [count, setCount] = useState<number>(5);
  const [active, setActive] = useState<PublicLookupTask | null>(null);

  // Default-pick first agent that can do the chosen type.
  useEffect(() => {
    if (agentId || !agentsQ.data) return;
    const a = agentsQ.data.agents[0];
    if (a) setAgentId(a.id);
  }, [agentsQ.data, agentId]);

  const create = useMutation({
    mutationFn: () =>
      publicApi.createPublicLookup({
        type,
        target: target.trim(),
        agent_id: agentId,
        ...(type === "ping" ? { count } : {}),
        ...(type === "tcp_connect" ? { port } : {}),
      }),
    onSuccess: (task) => setActive(task),
  });

  // Poll active lookup until terminal.
  const liveQ = useQuery({
    queryKey: ["public-lookup", active?.task_id],
    queryFn: () => publicApi.getPublicLookup(active!.task_id),
    enabled: !!active && !TERMINAL.has(active.status),
    refetchInterval: 1000,
  });
  useEffect(() => {
    if (liveQ.data) setActive(liveQ.data);
  }, [liveQ.data]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!agentId || !target.trim()) return;
    create.mutate();
  }

  const agents = agentsQ.data?.agents ?? [];

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900">
      <header className="border-b border-slate-800 px-5 py-3">
        <h2 className="text-sm font-semibold text-slate-100">{t("publicLookup.title")}</h2>
        <p className="mt-0.5 text-xs text-slate-500">{t("publicLookup.subtitle")}</p>
      </header>

      <form onSubmit={onSubmit} className="grid grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-12">
        <div className="sm:col-span-3">
          <span className="text-[10px] uppercase tracking-wide text-slate-500">
            {t("publicLookup.type")}
          </span>
          <div className="mt-1 inline-flex w-full overflow-hidden rounded border border-slate-700">
            {TYPES.map((tp) => (
              <button
                key={tp.v}
                type="button"
                onClick={() => setType(tp.v)}
                className={`flex-1 px-2 py-1.5 text-xs uppercase tracking-wide transition focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 ${
                  type === tp.v
                    ? "bg-slate-100 text-slate-900"
                    : "text-slate-400 hover:bg-slate-800"
                }`}
              >
                {tp.label}
              </button>
            ))}
          </div>
        </div>

        <label className="sm:col-span-5">
          <span className="text-[10px] uppercase tracking-wide text-slate-500">
            {t("publicLookup.target")}
          </span>
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="cloudflare.com or 1.1.1.1"
            maxLength={255}
            required
            className="mt-1 block w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 focus:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
          />
        </label>

        <label className="sm:col-span-4">
          <span className="text-[10px] uppercase tracking-wide text-slate-500">
            {t("publicLookup.fromAgent")}
          </span>
          <select
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            disabled={agents.length === 0}
            className="mt-1 block w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 disabled:opacity-50"
          >
            {agents.length === 0 && <option>{t("publicLookup.noAgents")}</option>}
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {agentDisplay(a)}
              </option>
            ))}
          </select>
        </label>

        {type === "ping" && (
          <label className="sm:col-span-3">
            <span className="text-[10px] uppercase tracking-wide text-slate-500">
              {t("publicLookup.count")}
            </span>
            <input
              type="number"
              min={1}
              max={10}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="mt-1 block w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
            />
          </label>
        )}
        {type === "tcp_connect" && (
          <label className="sm:col-span-3">
            <span className="text-[10px] uppercase tracking-wide text-slate-500">
              {t("publicLookup.port")}
            </span>
            <input
              type="number"
              min={1}
              max={65535}
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
              className="mt-1 block w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
            />
          </label>
        )}

        <div className={`sm:col-span-${type === "traceroute" ? "12" : "9"} flex items-end justify-end`}>
          <button
            type="submit"
            disabled={
              create.isPending ||
              !agentId ||
              !target.trim() ||
              (active !== null && !TERMINAL.has(active.status))
            }
            className="rounded bg-slate-100 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-white disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          >
            {create.isPending
              ? t("publicLookup.running")
              : active && !TERMINAL.has(active.status)
              ? t("publicLookup.running")
              : t("publicLookup.run")}
          </button>
        </div>

        {create.error && (
          <p role="alert" className="sm:col-span-12 rounded bg-red-950/50 px-3 py-2 text-sm text-red-300">
            {create.error instanceof Error ? create.error.message : String(create.error)}
          </p>
        )}
      </form>

      {active && (
        <LookupResult task={active} />
      )}
    </section>
  );
}

function agentDisplay(a: PublicLookupAgent): string {
  const loc = [a.city, a.country_code].filter(Boolean).join(", ");
  const tags = a.tags.length > 0 ? ` [${a.tags.join(",")}]` : "";
  return `${a.label}${loc ? ` — ${loc}` : ""}${tags}`;
}

function LookupResult({ task }: { task: PublicLookupTask }) {
  const { t } = useT();
  const done = TERMINAL.has(task.status);
  const ok = task.status === "completed";
  const tone = !done
    ? "border-blue-900 bg-blue-950/40"
    : ok
    ? "border-emerald-900 bg-emerald-950/30"
    : "border-red-900 bg-red-950/30";

  return (
    <div className={`border-t border-slate-800 px-5 py-4`}>
      <div className={`rounded border ${tone} px-4 py-3`}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="font-mono text-xs text-slate-200">
            <span className="uppercase tracking-wide text-slate-500">
              {task.type}
            </span>{" "}
            {task.target}
          </p>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide">
            <span className="text-slate-400">{task.agent.label}</span>
            {!done && (
              <span className="inline-flex items-center gap-1 text-blue-300">
                <span className="inline-block h-1.5 w-1.5 motion-safe:animate-pulse rounded-full bg-blue-400" />
                {task.status}
              </span>
            )}
            {done && ok && (
              <span className="text-emerald-300">✓ {t("publicLookup.done")}</span>
            )}
            {done && !ok && (
              <span className="text-red-300">✕ {task.status}</span>
            )}
            {task.duration_ms !== null && (
              <span className="text-slate-500 tabular-nums">{task.duration_ms} ms</span>
            )}
          </div>
        </div>

        {task.error && (
          <p className="mt-1 font-mono text-xs text-red-300">{task.error}</p>
        )}

        {task.parsed_json && (
          <ParsedSummary type={task.type} parsed={task.parsed_json} />
        )}

        {task.stdout && (
          <pre className="mt-2 max-h-60 overflow-y-auto rounded bg-slate-950 px-3 py-2 font-mono text-[11px] leading-relaxed text-slate-300">
            {task.stdout}
          </pre>
        )}
      </div>
    </div>
  );
}

function ParsedSummary({ type, parsed }: { type: string; parsed: Record<string, unknown> }) {
  if (type === "ping") {
    const received = numOr(parsed.received);
    const transmitted = numOr(parsed.transmitted);
    const loss = numOr(parsed.loss_percent);
    const avg = numOr(parsed.rtt_avg_ms);
    const min = numOr(parsed.rtt_min_ms);
    const max = numOr(parsed.rtt_max_ms);
    return (
      <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-300 sm:grid-cols-4">
        <Stat label="received" value={`${received ?? "—"}/${transmitted ?? "—"}`} />
        <Stat label="loss" value={loss !== null ? `${loss}%` : "—"} />
        <Stat label="avg" value={avg !== null ? `${avg.toFixed(2)} ms` : "—"} />
        <Stat label="min / max" value={min !== null && max !== null ? `${min.toFixed(1)} / ${max.toFixed(1)} ms` : "—"} />
      </div>
    );
  }
  if (type === "tcp_connect") {
    const open = parsed.open === true;
    const rtt = numOr(parsed.rtt_ms);
    return (
      <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-300 sm:grid-cols-3">
        <Stat label="port" value={String(parsed.port ?? "—")} />
        <Stat label="state" value={open ? "open" : "closed"} />
        <Stat label="rtt" value={rtt !== null ? `${rtt.toFixed(2)} ms` : "—"} />
      </div>
    );
  }
  return null;
}

function numOr(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-wide text-slate-600">{label}</p>
      <p className="font-mono tabular-nums">{value}</p>
    </div>
  );
}
