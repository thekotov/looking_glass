import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import * as agentsApi from "../api/agents";
import { agentLabel } from "../api/agents";
import * as schedulesApi from "../api/schedules";
import type { Schedule } from "../api/schedules";
import { useConfirm } from "../components/ConfirmDialog";
import { FilterChips, type ChipOption } from "../components/FilterChips";
import NavBar from "../components/NavBar";
import { SavedViews } from "../components/SavedViews";
import { SearchInput } from "../components/SearchInput";
import { SkeletonList } from "../components/Skeleton";
import TagsEditor from "../components/TagsEditor";
import { useToast } from "../components/Toast";
import { useAuth } from "../hooks/useAuth";
import { useUrlState, useUrlStateMulti } from "../hooks/useUrlState";
import { useT } from "../i18n";
import { previewCommand } from "../lib/commandPreview";
import { validateTargetFor } from "../lib/targetValidator";

const TASK_TYPES = [
  "ping",
  "traceroute",
  "mtr",
  "tcp_connect",
  "tcp_scan",
  "dns",
  "http_check",
  "tls_check",
] as const;

const INTERVALS: { v: number; label: string }[] = [
  { v: 60, label: "1m" },
  { v: 5 * 60, label: "5m" },
  { v: 15 * 60, label: "15m" },
  { v: 60 * 60, label: "1h" },
  { v: 6 * 60 * 60, label: "6h" },
  { v: 24 * 60 * 60, label: "24h" },
];

type Mode = "agents" | "tags";
type SchedFilter = "enabled" | "paused" | "failing";

export default function Schedules() {
  const { t } = useT();
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const canEdit = user && (user.role === "operator" || user.role === "admin");

  const [search, setSearch] = useUrlState("q", "");
  const [filters, setFilters] = useUrlStateMulti("filter");

  const q = useQuery({
    queryKey: ["schedules"],
    queryFn: schedulesApi.listSchedules,
    refetchInterval: 5_000,
  });

  const agentsQ = useQuery({
    queryKey: ["agents"],
    queryFn: agentsApi.listAgents,
  });

  const activeAgents = useMemo(
    () => (agentsQ.data ?? []).filter((a) => a.status === "active"),
    [agentsQ.data],
  );

  const knownTags = useMemo(() => {
    const set = new Set<string>();
    for (const a of activeAgents) for (const tag of a.tags) set.add(tag);
    return Array.from(set).sort();
  }, [activeAgents]);

  const all = q.data ?? [];
  const counts = useMemo(() => {
    let enabled = 0;
    let paused = 0;
    let failing = 0;
    for (const s of all) {
      if (s.enabled) enabled++;
      else paused++;
      if (s.runs_total >= 4 && s.runs_failed / s.runs_total > 0.25) failing++;
    }
    return { enabled, paused, failing };
  }, [all]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return all.filter((s) => {
      if (term) {
        const hay = [s.name, s.type, s.target, s.tags.join(" ")]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(term)) return false;
      }
      if (filters.length === 0) return true;
      const isFailing =
        s.runs_total >= 4 && s.runs_failed / s.runs_total > 0.25;
      const stateMatches =
        (filters.includes("enabled") && s.enabled) ||
        (filters.includes("paused") && !s.enabled);
      const failingMatches = filters.includes("failing") && isFailing;
      // "failing" is additive: if user picks "enabled + failing", show
      // enabled schedules that are also failing.
      const hasStateFilter = filters.includes("enabled") || filters.includes("paused");
      const hasFailing = filters.includes("failing");
      if (hasStateFilter && !stateMatches) return false;
      if (hasFailing && !failingMatches) return false;
      return true;
    });
  }, [all, search, filters]);

  // Optimistic helpers. The ScheduleRow currently uses inline async handlers;
  // we lift them into useMutation so onMutate can patch the cache.
  async function patchOne(id: string, updater: (s: Schedule) => Schedule) {
    await qc.cancelQueries({ queryKey: ["schedules"] });
    const prev = qc.getQueryData<Schedule[]>(["schedules"]);
    qc.setQueryData<Schedule[]>(["schedules"], (curr) =>
      (curr ?? []).map((x) => (x.id === id ? updater(x) : x)),
    );
    return { prev };
  }
  async function removeOne(id: string) {
    await qc.cancelQueries({ queryKey: ["schedules"] });
    const prev = qc.getQueryData<Schedule[]>(["schedules"]);
    qc.setQueryData<Schedule[]>(["schedules"], (curr) =>
      (curr ?? []).filter((x) => x.id !== id),
    );
    return { prev };
  }
  function rollback(ctx: { prev: Schedule[] | undefined } | undefined) {
    if (ctx?.prev) qc.setQueryData(["schedules"], ctx.prev);
  }

  const toggleMut = useMutation({
    mutationFn: (v: { id: string; enabled: boolean }) =>
      schedulesApi.updateSchedule(v.id, { enabled: v.enabled }),
    onMutate: (v) => patchOne(v.id, (s) => ({ ...s, enabled: v.enabled })),
    onSuccess: (_r, v) => {
      const name = all.find((s) => s.id === v.id)?.name ?? "";
      toast.info(v.enabled ? t("schedules.enabled") : t("schedules.disabled"), name);
    },
    onError: (e, _v, ctx) => {
      rollback(ctx);
      toast.error(e instanceof Error ? e.message : String(e));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["schedules"] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => schedulesApi.deleteSchedule(id),
    onMutate: (id) => removeOne(id),
    onSuccess: (_r, id) => {
      const name = all.find((s) => s.id === id)?.name ?? "";
      toast.info(t("common.delete"), name);
    },
    onError: (e, _v, ctx) => {
      rollback(ctx);
      toast.error(e instanceof Error ? e.message : String(e));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["schedules"] }),
  });

  const triggerMut = useMutation({
    mutationFn: (id: string) => schedulesApi.triggerSchedule(id),
    onSuccess: (r) => toast.success(t("schedules.triggered"), `${r.task_count} tasks`),
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
    onSettled: () => qc.invalidateQueries({ queryKey: ["schedules"] }),
  });

  const chipOptions: ChipOption<SchedFilter>[] = [
    { value: "enabled", label: t("schedules.filter.enabled"), count: counts.enabled, tone: "emerald" },
    { value: "paused", label: t("schedules.filter.paused"), count: counts.paused },
    { value: "failing", label: t("schedules.filter.failing"), count: counts.failing, tone: "red" },
  ];

  return (
    <div className="min-h-screen bg-slate-950">
      <NavBar />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <h1 className="mb-1 text-2xl font-semibold text-slate-100">{t("schedules.title")}</h1>
        <p className="mb-4 text-xs text-slate-500">{t("schedules.subtitle")}</p>

        {canEdit && (
          <CreateScheduleForm
            activeAgents={activeAgents}
            knownTags={knownTags}
            onCreated={() => qc.invalidateQueries({ queryKey: ["schedules"] })}
          />
        )}

        {all.length > 0 && (
          <div className="mt-4">
            <SavedViews
              scope="schedules"
              presets={[
                { name: t("schedules.preset.failing"), query: "filter=failing" },
                { name: t("schedules.preset.paused"), query: "filter=paused" },
              ]}
            />
          </div>
        )}

        {all.length > 0 && (
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder={t("schedules.searchPlaceholder")}
              ariaLabel={t("schedules.searchAria")}
              className="sm:max-w-sm"
            />
            <FilterChips
              options={chipOptions}
              value={filters as SchedFilter[]}
              onChange={(v) => setFilters(v)}
              ariaLabel={t("schedules.filterAria")}
            />
          </div>
        )}

        <section className="mt-3 rounded-lg border border-slate-800 bg-slate-900">
          {q.isLoading && <SkeletonList rows={3} />}
          {q.isError && (
            <p role="alert" className="px-6 py-4 text-sm text-red-400">
              {q.error instanceof Error ? q.error.message : t("common.failedToLoad")}
            </p>
          )}
          {q.data && q.data.length === 0 && (
            <p className="px-6 py-6 text-sm text-slate-500">{t("schedules.empty")}</p>
          )}
          {all.length > 0 && filtered.length === 0 && (
            <p className="px-6 py-6 text-center text-sm text-slate-500">
              {t("schedules.noMatches")}{" "}
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setFilters([]);
                }}
                className="text-slate-300 underline-offset-2 hover:underline"
              >
                {t("common.clearFilters")}
              </button>
            </p>
          )}
          {filtered.length > 0 && (
            <ul className="divide-y divide-slate-800">
              {filtered.map((s) => (
                <ScheduleRow
                  key={s.id}
                  sched={s}
                  canEdit={!!canEdit}
                  onToggle={(enabled) => toggleMut.mutate({ id: s.id, enabled })}
                  onTrigger={() => triggerMut.mutate(s.id)}
                  onDelete={async () => {
                    const ok = await confirm({
                      title: t("schedules.confirmDelete", { name: s.name }),
                      danger: true,
                      confirmLabel: t("common.delete"),
                    });
                    if (ok) deleteMut.mutate(s.id);
                  }}
                />
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

function CreateScheduleForm({
  activeAgents,
  knownTags,
  onCreated,
}: {
  activeAgents: agentsApi.Agent[];
  knownTags: string[];
  onCreated: () => void;
}) {
  const { t } = useT();
  const toast = useToast();
  const [name, setName] = useState("");
  const [type, setType] = useState<(typeof TASK_TYPES)[number]>("ping");
  const [target, setTarget] = useState("1.1.1.1");
  const [intervalSeconds, setIntervalSeconds] = useState(5 * 60);
  const [mode, setMode] = useState<Mode>("tags");
  const [tags, setTags] = useState<string[]>([]);
  const [agentsPerTag, setAgentsPerTag] = useState(1);
  const [agentIds, setAgentIds] = useState<string[]>([]);

  const create = useMutation({
    mutationFn: () => {
      const payload: schedulesApi.ScheduleCreatePayload = {
        name: name.trim() || `${type} ${target}`,
        type,
        target: target.trim(),
        options: {},
        interval_seconds: intervalSeconds,
        ...(mode === "tags"
          ? { tags, agents_per_tag: agentsPerTag }
          : { agent_ids: agentIds }),
      };
      return schedulesApi.createSchedule(payload);
    },
    onSuccess: () => {
      toast.success(t("schedules.created"));
      setName("");
      setTags([]);
      setAgentIds([]);
      onCreated();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const targetValidation = validateTargetFor(type, target);
  const canSubmit =
    targetValidation.ok &&
    target.trim().length > 0 &&
    (mode === "tags" ? tags.length > 0 : agentIds.length > 0);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    create.mutate();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid grid-cols-1 gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4 sm:grid-cols-12"
    >
      <label className="sm:col-span-3">
        <span className="text-[10px] uppercase tracking-wide text-slate-500">
          {t("schedules.name")}
        </span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="cloudflare ping eu"
          className="mt-1 block w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
        />
      </label>

      <label className="sm:col-span-2">
        <span className="text-[10px] uppercase tracking-wide text-slate-500">
          {t("schedules.type")}
        </span>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as (typeof TASK_TYPES)[number])}
          className="mt-1 block w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
        >
          {TASK_TYPES.map((tp) => (
            <option key={tp} value={tp}>
              {tp}
            </option>
          ))}
        </select>
      </label>

      <label className="sm:col-span-4">
        <span className="text-[10px] uppercase tracking-wide text-slate-500">
          {t("schedules.target")}
        </span>
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className={`mt-1 block w-full rounded border bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 focus:outline-none focus-visible:ring-2 ${
            !targetValidation.ok && target.length > 0
              ? "border-red-700 focus-visible:ring-red-500"
              : "border-slate-700 focus:border-slate-500 focus-visible:ring-slate-500"
          }`}
          required
        />
      </label>

      <label className="sm:col-span-3">
        <span className="text-[10px] uppercase tracking-wide text-slate-500">
          {t("schedules.interval")}
        </span>
        <div className="mt-1 flex flex-wrap gap-1">
          {INTERVALS.map((iv) => (
            <button
              key={iv.v}
              type="button"
              onClick={() => setIntervalSeconds(iv.v)}
              className={`rounded border px-2 py-1 text-xs uppercase focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 ${
                intervalSeconds === iv.v
                  ? "border-slate-100 bg-slate-100 text-slate-900"
                  : "border-slate-700 text-slate-300 hover:bg-slate-800"
              }`}
            >
              {iv.label}
            </button>
          ))}
        </div>
      </label>

      <div className="sm:col-span-12">
        <div className="mb-1 inline-flex overflow-hidden rounded border border-slate-700">
          <button
            type="button"
            onClick={() => setMode("tags")}
            className={`px-3 py-1 text-xs uppercase tracking-wide focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 ${
              mode === "tags"
                ? "bg-slate-100 text-slate-900"
                : "text-slate-400 hover:bg-slate-800"
            }`}
          >
            {t("create.byTags")}
          </button>
          <button
            type="button"
            onClick={() => setMode("agents")}
            className={`px-3 py-1 text-xs uppercase tracking-wide focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 ${
              mode === "agents"
                ? "bg-slate-100 text-slate-900"
                : "text-slate-400 hover:bg-slate-800"
            }`}
          >
            {t("create.pickAgents")}
          </button>
        </div>
        {mode === "tags" ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
            <div className="sm:col-span-9">
              <TagsEditor value={tags} onChange={setTags} suggestions={knownTags} />
            </div>
            <label className="sm:col-span-3">
              <span className="text-[10px] uppercase tracking-wide text-slate-500">
                {t("create.agentsPerTag")}
              </span>
              <input
                type="number"
                min={1}
                max={20}
                value={agentsPerTag}
                onChange={(e) => setAgentsPerTag(Number(e.target.value))}
                className="mt-1 block w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
              />
            </label>
          </div>
        ) : (
          <div className="max-h-40 space-y-1 overflow-y-auto rounded border border-slate-800 bg-slate-950 p-2">
            {activeAgents.length === 0 && (
              <p className="text-xs text-amber-400">{t("create.noActiveAgents")}</p>
            )}
            {activeAgents.map((a) => (
              <label key={a.id} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-slate-900">
                <input
                  type="checkbox"
                  checked={agentIds.includes(a.id)}
                  onChange={(e) =>
                    setAgentIds((prev) =>
                      e.target.checked ? [...prev, a.id] : prev.filter((x) => x !== a.id),
                    )
                  }
                  className="h-4 w-4 rounded border-slate-700 bg-slate-950"
                />
                <span className="text-sm text-slate-200">{agentLabel(a)}</span>
                {a.tags.length > 0 && (
                  <span className="text-[10px] uppercase text-slate-500">{a.tags.join(",")}</span>
                )}
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="sm:col-span-12 rounded border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs">
        <span className="text-[10px] uppercase tracking-wide text-slate-500">
          {t("create.preview")}:
        </span>{" "}
        <span className="font-mono text-emerald-300">
          $ {previewCommand(type, target, {})}
        </span>
      </div>

      <div className="sm:col-span-12 flex items-center justify-end gap-2">
        {create.error && (
          <p role="alert" className="flex-1 rounded bg-red-950/50 px-3 py-2 text-xs text-red-300">
            {create.error instanceof Error ? create.error.message : String(create.error)}
          </p>
        )}
        <button
          type="submit"
          disabled={!canSubmit || create.isPending}
          className="rounded bg-slate-100 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-white disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
        >
          {create.isPending ? t("common.creating") : t("schedules.create")}
        </button>
      </div>
    </form>
  );
}

function ScheduleRow({
  sched,
  canEdit,
  onToggle,
  onTrigger,
  onDelete,
}: {
  sched: Schedule;
  canEdit: boolean;
  onToggle: (enabled: boolean) => void;
  onTrigger: () => void;
  onDelete: () => void;
}) {
  const { t } = useT();
  const nextRunSec = Math.max(0, Math.floor((new Date(sched.next_run_at).getTime() - Date.now()) / 1000));
  const interval = humanInterval(sched.interval_seconds);
  const failureRate =
    sched.runs_total > 0 ? (sched.runs_failed / sched.runs_total) * 100 : 0;

  return (
    <li className="px-6 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-mono text-sm text-slate-100">{sched.name}</h3>
            <span
              className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
                sched.enabled
                  ? "border-emerald-900 bg-emerald-950 text-emerald-300"
                  : "border-slate-700 bg-slate-800 text-slate-400"
              }`}
            >
              {sched.enabled ? "enabled" : "paused"}
            </span>
            <span className="text-[10px] uppercase tracking-wide text-slate-500">
              every {interval}
            </span>
          </div>
          <p className="mt-1 font-mono text-xs text-slate-400">
            {sched.type} {sched.target}
          </p>
          <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-400 sm:grid-cols-4">
            <Meta
              label={t("schedules.next")}
              value={sched.enabled ? `${nextRunSec}s` : "—"}
            />
            <Meta
              label={t("schedules.last")}
              value={sched.last_run_at ? new Date(sched.last_run_at).toLocaleString() : "—"}
            />
            <Meta label={t("schedules.runs")} value={`${sched.runs_total} (${sched.runs_failed} failed)`} />
            <Meta
              label={t("schedules.routing")}
              value={
                sched.tags.length > 0
                  ? `tags: ${sched.tags.join(", ")} ×${sched.agents_per_tag}`
                  : `${sched.agent_ids.length} agents`
              }
            />
          </dl>
          {sched.last_run_error && (
            <p className="mt-1 font-mono text-xs text-red-300">
              ⚠ {sched.last_run_error}
            </p>
          )}
          {sched.last_run_group_id && (
            <p className="mt-1 text-[10px] text-slate-500">
              <Link
                to={`/groups/${sched.last_run_group_id}`}
                className="underline-offset-2 hover:underline"
              >
                {t("schedules.lastGroupLink")} →
              </Link>
            </p>
          )}
          {failureRate > 25 && sched.runs_total >= 4 && (
            <p className="mt-1 text-[10px] uppercase tracking-wide text-amber-300">
              failure rate: {failureRate.toFixed(0)}%
            </p>
          )}
        </div>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onToggle(!sched.enabled)}
              className={`rounded border px-3 py-1 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 ${
                sched.enabled
                  ? "border-amber-900 text-amber-300 hover:bg-amber-950"
                  : "border-emerald-900 text-emerald-300 hover:bg-emerald-950"
              }`}
            >
              {sched.enabled ? t("schedules.pause") : t("schedules.resume")}
            </button>
            <button
              type="button"
              onClick={onTrigger}
              className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
            >
              {t("schedules.runNow")}
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="rounded border border-red-900 px-3 py-1 text-xs text-red-300 hover:bg-red-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
            >
              {t("common.delete")}
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-slate-600">{label}</dt>
      <dd className="truncate">{value}</dd>
    </div>
  );
}

function humanInterval(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h`;
  return `${Math.round(sec / 86400)}d`;
}
