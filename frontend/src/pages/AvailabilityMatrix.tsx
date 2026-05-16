import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import type { SkippedPair } from "../api/availability";
import * as agentsApi from "../api/agents";
import { agentLabel, type Agent } from "../api/agents";
import * as tasksApi from "../api/tasks";
import type { TaskGroupTask, TaskStatus } from "../api/tasks";
import { Breadcrumbs } from "../components/Breadcrumbs";
import NavBar from "../components/NavBar";
import { useToast } from "../components/Toast";
import { useT } from "../i18n";

type MatrixTaskType = "ping" | "tcp_connect";

type PingParsed = {
  received?: number;
  transmitted?: number;
  loss_percent?: number;
  rtt_avg_ms?: number;
};

type TcpConnectParsed = {
  open?: boolean;
  rtt_ms?: number;
};

function isTerminal(s: TaskStatus): boolean {
  return tasksApi.isTerminal(s);
}

function relevantTypes(tasks: TaskGroupTask[]): MatrixTaskType[] {
  const set = new Set<MatrixTaskType>();
  for (const t of tasks) {
    if (t.type === "ping" || t.type === "tcp_connect") {
      set.add(t.type);
    }
  }
  return (["ping", "tcp_connect"] as MatrixTaskType[]).filter((t) => set.has(t));
}

function labelForType(t: MatrixTaskType, port?: number): string {
  if (t === "ping") return "ICMP";
  return port ? `TCP:${port}` : "TCP";
}

export default function AvailabilityMatrix() {
  const { groupId } = useParams<{ groupId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useT();
  const toast = useToast();
  const navState = location.state as { skipped?: SkippedPair[]; taskCount?: number } | null;

  const groupQ = useQuery({
    queryKey: ["task-group", groupId],
    queryFn: () => tasksApi.getTaskGroup(groupId!),
    enabled: !!groupId,
    refetchInterval: (q) => {
      const g = q.state.data;
      if (!g) return 1500;
      const done = g.tasks.every((t) => isTerminal(t.status));
      return done ? false : 1000;
    },
  });

  const agentsQ = useQuery({
    queryKey: ["agents"],
    queryFn: agentsApi.listAgents,
  });
  const agentsById = useMemo(
    () => new Map((agentsQ.data ?? []).map((a) => [a.id, a])),
    [agentsQ.data],
  );

  const types = useMemo(
    () => (groupQ.data ? relevantTypes(groupQ.data.tasks) : []),
    [groupQ.data],
  );
  const [selectedType, setSelectedTypeRaw] = useState<MatrixTaskType | null>(null);
  const activeType: MatrixTaskType | null =
    selectedType && types.includes(selectedType) ? selectedType : types[0] ?? null;

  const [filterTargets, setFilterTargets] = useState("");
  const [filterAgents, setFilterAgents] = useState("");

  const agentOrder = useMemo(() => {
    if (!groupQ.data) return [] as string[];
    const seen = new Set<string>();
    const order: string[] = [];
    for (const t of groupQ.data.tasks) {
      if (seen.has(t.agent_id)) continue;
      seen.add(t.agent_id);
      order.push(t.agent_id);
    }
    return order.sort((a, b) => {
      const ag = agentsById.get(a);
      const bg = agentsById.get(b);
      const ha = ag ? agentLabel(ag) : a;
      const hb = bg ? agentLabel(bg) : b;
      return ha.localeCompare(hb);
    });
  }, [groupQ.data, agentsById]);

  const targetOrder = useMemo(() => {
    if (!groupQ.data) return [] as string[];
    const seen = new Set<string>();
    const order: string[] = [];
    for (const t of groupQ.data.tasks) {
      if (seen.has(t.target)) continue;
      seen.add(t.target);
      order.push(t.target);
    }
    return order;
  }, [groupQ.data]);

  const filteredTargets = useMemo(() => {
    const q = filterTargets.trim().toLowerCase();
    if (!q) return targetOrder;
    return targetOrder.filter((t) => t.toLowerCase().includes(q));
  }, [targetOrder, filterTargets]);

  const filteredAgents = useMemo(() => {
    const q = filterAgents.trim().toLowerCase();
    if (!q) return agentOrder;
    return agentOrder.filter((id) => {
      const a = agentsById.get(id);
      const hay = `${a?.display_name ?? ""} ${a?.hostname ?? ""} ${a?.tags?.join(",") ?? ""} ${id}`.toLowerCase();
      return hay.includes(q);
    });
  }, [agentOrder, agentsById, filterAgents]);

  const matrix = useMemo(() => {
    const map = new Map<string, Map<string, TaskGroupTask>>();
    if (!groupQ.data || !activeType) return map;
    for (const t of groupQ.data.tasks) {
      if (t.type !== activeType) continue;
      let row = map.get(t.target);
      if (!row) {
        row = new Map();
        map.set(t.target, row);
      }
      row.set(t.agent_id, t);
    }
    return map;
  }, [groupQ.data, activeType]);

  const tcpPort = useMemo(() => {
    if (!groupQ.data) return undefined;
    const tcpTask = groupQ.data.tasks.find((t) => t.type === "tcp_connect");
    const p = tcpTask?.options?.port;
    return typeof p === "number" ? p : undefined;
  }, [groupQ.data]);

  const totals = useMemo(() => {
    if (!groupQ.data) return { done: 0, total: 0 };
    const total = groupQ.data.tasks.length;
    const done = groupQ.data.tasks.filter((t) => isTerminal(t.status)).length;
    return { done, total };
  }, [groupQ.data]);

  function exportCsv() {
    if (!activeType) return;
    const headers = ["target", ...filteredAgents.map((id) => {
      const a = agentsById.get(id);
      return a ? agentLabel(a) : id;
    })];
    const lines: string[] = [headers.map(csvCell).join(",")];
    for (const target of filteredTargets) {
      const row = [target];
      for (const aid of filteredAgents) {
        const task = matrix.get(target)?.get(aid);
        row.push(csvForCell(activeType, task));
      }
      lines.push(row.map(csvCell).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `availability-${groupId?.slice(0, 8) ?? "matrix"}-${activeType}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success(t("avail.exportCopied"));
  }

  return (
    <div className="min-h-screen bg-slate-950">
      <NavBar />
      <main className="mx-auto max-w-7xl px-6 py-6">
        <Breadcrumbs
          items={[
            { to: "/availability", label: t("nav.availability") },
            { label: groupId?.slice(0, 8) ?? "", mono: true },
          ]}
        />

        {groupQ.isLoading && <p className="text-slate-500">{t("common.loading")}</p>}
        {groupQ.isError && (
          <p className="text-red-400">
            {groupQ.error instanceof Error ? groupQ.error.message : t("common.failedToLoad")}
          </p>
        )}

        {groupQ.data && (
          <>
            <header className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900 px-6 py-4">
              <div>
                <h1 className="text-lg font-semibold text-slate-100">
                  {t("avail.matrix")}
                </h1>
                <p className="mt-1 text-xs text-slate-500">
                  {t("avail.summary", { targets: targetOrder.length, agents: agentOrder.length })}{" "}
                  <span className="text-slate-300">
                    {totals.done}/{totals.total}
                  </span>
                  {navState?.taskCount !== undefined &&
                    navState.taskCount !== totals.total && (
                      <span className="ml-2 text-slate-700">
                        ({t("avail.created", { n: navState.taskCount })})
                      </span>
                    )}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {types.length > 1 && (
                  <div className="inline-flex overflow-hidden rounded border border-slate-700">
                    {types.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setSelectedTypeRaw(t)}
                        className={`px-3 py-1.5 text-xs uppercase focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 ${
                          activeType === t
                            ? "bg-slate-100 text-slate-900"
                            : "text-slate-400 hover:bg-slate-800"
                        }`}
                      >
                        {labelForType(t, tcpPort)}
                      </button>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  onClick={exportCsv}
                  disabled={!activeType}
                  className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
                >
                  ↓ {t("avail.exportCsv")}
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/availability?repeat=1")}
                  className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
                >
                  {t("avail.refresh")}
                </button>
              </div>
            </header>

            <div className="mb-3 flex flex-wrap items-center gap-2">
              <input
                type="search"
                value={filterTargets}
                onChange={(e) => setFilterTargets(e.target.value)}
                placeholder={t("avail.searchTargets")}
                aria-label={t("avail.searchTargets")}
                className="min-w-[12rem] flex-1 rounded border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 focus:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
              />
              <input
                type="search"
                value={filterAgents}
                onChange={(e) => setFilterAgents(e.target.value)}
                placeholder={t("avail.searchAgents")}
                aria-label={t("avail.searchAgents")}
                className="min-w-[12rem] flex-1 rounded border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 focus:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
              />
              <span className="text-[11px] text-slate-500">
                {filteredTargets.length}/{targetOrder.length} · {filteredAgents.length}/
                {agentOrder.length}
              </span>
            </div>

            <Legend />

            {navState?.skipped && navState.skipped.length > 0 && (
              <div className="mb-4 rounded border border-amber-900 bg-amber-950/40 px-4 py-2 text-sm text-amber-300">
                {t("avail.skipped", { n: navState.skipped.length })}
              </div>
            )}

            {activeType && filteredTargets.length === 0 && (
              <p className="rounded border border-slate-800 bg-slate-900 px-4 py-6 text-center text-sm text-slate-400">
                {t("avail.noMatch")}
              </p>
            )}

            {activeType && filteredTargets.length > 0 && (
              <MatrixTable
                activeType={activeType}
                targetOrder={filteredTargets}
                agentOrder={filteredAgents}
                agentsById={agentsById}
                matrix={matrix}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Legend() {
  const { t } = useT();
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 text-[10px] uppercase tracking-wide text-slate-500">
      <LegendChip className="border-emerald-700 bg-emerald-950/40 text-emerald-300" label={t("avail.legendOk")} />
      <LegendChip className="border-amber-700 bg-amber-950/40 text-amber-300" label={t("avail.legendWarn")} />
      <LegendChip className="border-red-800 bg-red-950/40 text-red-300" label={t("avail.legendFail")} />
      <LegendChip className="border-slate-700 bg-slate-950 text-slate-400" label={t("avail.legendPending")} />
      <span className="text-slate-700">— · {t("avail.legendSkipped")}</span>
    </div>
  );
}

function LegendChip({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-3 w-6 rounded border ${className}`} />
      <span>{label}</span>
    </span>
  );
}

type MatrixTableProps = {
  activeType: MatrixTaskType;
  targetOrder: string[];
  agentOrder: string[];
  agentsById: Map<string, Agent>;
  matrix: Map<string, Map<string, TaskGroupTask>>;
};

function MatrixTable({
  activeType,
  targetOrder,
  agentOrder,
  agentsById,
  matrix,
}: MatrixTableProps) {
  const { t } = useT();
  return (
    <div className="max-h-[70vh] overflow-auto rounded-lg border border-slate-800 bg-slate-900">
      <table className="min-w-full border-collapse text-sm">
        <thead className="sticky top-0 z-20">
          <tr className="border-b border-slate-800">
            <th className="sticky left-0 top-0 z-30 border-b border-r border-slate-800 bg-slate-900 px-4 py-2 text-left text-xs uppercase tracking-wide text-slate-500">
              {t("avail.cellTarget")}
            </th>
            {agentOrder.map((aid) => {
              const a = agentsById.get(aid);
              return (
                <th
                  key={aid}
                  className="border-b border-slate-800 bg-slate-900 px-3 py-2 text-center text-xs uppercase tracking-wide text-slate-400"
                  title={
                    a?.display_name
                      ? `${a.display_name} (host: ${a.hostname})`
                      : a?.hostname ?? aid
                  }
                >
                  {a ? agentLabel(a) : aid.slice(0, 8)}
                  {a?.tags && a.tags.length > 0 && (
                    <div className="text-[9px] normal-case text-slate-600">
                      {a.tags.join(",")}
                    </div>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {targetOrder.map((target) => (
            <tr key={target} className="border-b border-slate-800 last:border-b-0">
              <td className="sticky left-0 z-10 border-r border-slate-800 bg-slate-900 px-4 py-2 font-mono text-xs text-slate-200">
                {target}
              </td>
              {agentOrder.map((aid) => {
                const task = matrix.get(target)?.get(aid);
                return (
                  <td key={aid} className="px-1 py-1 text-center">
                    <MatrixCell type={activeType} task={task} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MatrixCell({
  type,
  task,
}: {
  type: MatrixTaskType;
  task: TaskGroupTask | undefined;
}) {
  if (!task) {
    return <span className="text-slate-700">—</span>;
  }
  if (!isTerminal(task.status)) {
    return (
      <Link
        to={`/tasks/${task.id}`}
        className="inline-flex flex-col items-center rounded bg-slate-950 px-2 py-1 text-[11px] text-slate-400 hover:bg-slate-800"
        title={`Status: ${task.status}`}
      >
        <span className="uppercase">…</span>
        <span className="text-[9px] text-slate-600">{task.status}</span>
      </Link>
    );
  }

  const verdict = analyseTask(type, task);
  const tone =
    verdict.ok === true
      ? "border-emerald-700 bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/40"
      : verdict.ok === false
      ? "border-red-800 bg-red-950/40 text-red-300 hover:bg-red-900/40"
      : "border-slate-700 bg-slate-950 text-slate-400 hover:bg-slate-800";

  const icon =
    verdict.ok === true ? "✓" : verdict.ok === false ? "✕" : "?";

  return (
    <Link
      to={`/tasks/${task.id}`}
      className={`inline-flex min-w-[64px] flex-col items-center rounded border px-2 py-1 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 ${tone}`}
      title={verdict.tooltip}
    >
      <span className="text-[11px] font-semibold uppercase">
        <span className="mr-0.5">{icon}</span>
        {verdict.label}
      </span>
      <span className="text-[9px] tabular-nums opacity-80">{verdict.detail}</span>
    </Link>
  );
}

type Verdict = {
  ok: boolean | null;
  label: string;
  detail: string;
  tooltip: string;
};

function analyseTask(type: MatrixTaskType, task: TaskGroupTask): Verdict {
  if (
    task.status === "failed" ||
    task.status === "timeout" ||
    task.status === "cancelled"
  ) {
    return {
      ok: false,
      label: "FAIL",
      detail: task.status === "timeout" ? "timeout" : "—",
      tooltip: task.error ?? `task ${task.status}`,
    };
  }
  const parsed = task.result?.parsed_json;
  if (type === "ping") {
    const p = (parsed ?? {}) as PingParsed;
    const received = typeof p.received === "number" ? p.received : 0;
    const transmitted = typeof p.transmitted === "number" ? p.transmitted : 0;
    const loss = typeof p.loss_percent === "number" ? p.loss_percent : null;
    const avg = typeof p.rtt_avg_ms === "number" ? p.rtt_avg_ms : null;
    if (received === 0) {
      return {
        ok: false,
        label: "FAIL",
        detail: transmitted > 0 ? "100% loss" : "—",
        tooltip: `received 0/${transmitted}`,
      };
    }
    const ok = loss === null || loss < 50;
    return {
      ok,
      label: ok ? "OK" : "WARN",
      detail: avg !== null ? `${avg.toFixed(1)} ms` : "—",
      tooltip:
        `received ${received}/${transmitted}` +
        (loss !== null ? ` · loss ${loss.toFixed(1)}%` : "") +
        (avg !== null ? ` · avg ${avg.toFixed(2)} ms` : ""),
    };
  }
  const tParsed = (parsed ?? {}) as TcpConnectParsed;
  const open = tParsed.open === true;
  const rtt = typeof tParsed.rtt_ms === "number" ? tParsed.rtt_ms : null;
  if (!open) {
    return {
      ok: false,
      label: "FAIL",
      detail: "closed",
      tooltip: task.error ?? "tcp connect failed",
    };
  }
  return {
    ok: true,
    label: "OK",
    detail: rtt !== null ? `${rtt.toFixed(1)} ms` : "—",
    tooltip: rtt !== null ? `connect ${rtt.toFixed(2)} ms` : "connected",
  };
}

function csvCell(v: string): string {
  if (/[",\n]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

function csvForCell(type: MatrixTaskType, task: TaskGroupTask | undefined): string {
  if (!task) return "";
  if (!isTerminal(task.status)) return task.status;
  const v = analyseTask(type, task);
  return `${v.label}${v.detail && v.detail !== "—" ? ` (${v.detail})` : ""}`;
}
